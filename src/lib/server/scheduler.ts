/**
 * Scheduler module for background jobs.
 *
 * Uses Croner for cron-based scheduling with:
 * - `protect: true` to prevent overlapping executions
 * - Error handling that logs but doesn't crash the server
 *
 * Jobs:
 * - throttle-window-reset: Every minute - resets expired throttle and API key rate limit windows
 * - prowlarr-health-check: Every 5 minutes - checks Prowlarr indexer health
 * - connector-health-check: Every 5 minutes - checks *arr connector health
 * - connector-reconnect: Every 30 seconds - attempts reconnection to offline/unhealthy connectors
 * - incremental-sync-sweep: Every 15 minutes - syncs content, discovers gaps/upgrades, enqueues items
 * - full-reconciliation: Daily at 3 AM - complete sync with deletion of removed items
 * - completion-snapshot: Daily at 4 AM - captures library completion stats for trend sparklines
 * - db-maintenance: Daily at 4:30 AM - runs VACUUM and ANALYZE for database optimization
 * - queue-processor: Every minute - re-enqueues cooldown items, dispatches searches
 * - queue-depth-sampler: Every 5 minutes - samples queue depth for analytics
 * - analytics-hourly-aggregation: 5 min past each hour - aggregates raw events to hourly stats
 * - analytics-daily-aggregation: Daily at 1 AM - aggregates hourly to daily stats, cleans old events
 * - scheduled-backup: Configurable cron - creates database backups with retention cleanup
 */

import { Cron } from 'croner';
import {
	AuthenticationError,
	NetworkError,
	TimeoutError
} from '$lib/server/connectors/common/errors';
import { createConnectorClient } from '$lib/server/connectors/factory';
import { generateCorrelationId, type RequestContext, runWithContext } from '$lib/server/context';
import { captureConnectorSnapshotAfterSync } from '$lib/server/db/queries/completion';
import {
	getConnector,
	getDecryptedApiKey,
	getEnabledConnectors,
	getHealthyConnectors,
	updateConnectorHealth
} from '$lib/server/db/queries/connectors';
import { getEnabledSchedules, updateNextRunAt } from '$lib/server/db/queries/schedules';
import { getBackupSettings, getSettingWithDefault } from '$lib/server/db/queries/settings';
import type { Connector } from '$lib/server/db/schema';
import { createLogger } from '$lib/server/logger';
import {
	aggregateDailyStats,
	aggregateHourlyStats,
	analyticsCollector,
	cleanupOldEvents
} from '$lib/server/services/analytics';
import { apiKeyRateLimiter } from '$lib/server/services/api-rate-limit';
import { cleanupOldScheduledBackups, createBackup } from '$lib/server/services/backup';
import { discoverGaps, discoverUpgrades } from '$lib/server/services/discovery';
import {
	enableLogPersistence,
	shutdown as shutdownLogPersistence
} from '$lib/server/services/log-persistence';
import {
	cleanupOrphanedSearchState,
	pruneApplicationLogs,
	pruneSearchHistory,
	runDatabaseMaintenance
} from '$lib/server/services/maintenance';
import { prowlarrHealthMonitor } from '$lib/server/services/prowlarr';
import {
	cleanupOrphanedSearchingItems,
	dequeuePriorityItems,
	dispatchSearch,
	enqueuePendingItems,
	type FailureCategory,
	markSearchDispatched,
	markSearchFailed,
	reenqueueEligibleCooldownItems,
	revertToQueued,
	setSearching
} from '$lib/server/services/queue';
import {
	initializeReconnectForOfflineConnector,
	processReconnections
} from '$lib/server/services/reconnect';
import { runFullReconciliation, runIncrementalSync } from '$lib/server/services/sync';
import {
	determineHealthFromChecks,
	type HealthStatus
} from '$lib/server/services/sync/health-utils';
import { throttleEnforcer } from '$lib/server/services/throttle';

const logger = createLogger('job-scheduler');

interface ConnectorProcessResult {
	connectorId: number;
	connectorName: string;
	dispatched: number;
	succeeded: number;
	failed: number;
	rateLimited: number;
}

interface ScheduledJob {
	name: string;
	cron: Cron;
}

interface SchedulerState {
	initialized: boolean;
	jobs: Map<string, ScheduledJob>;
	dynamicJobs: Map<number, Cron>;
	scheduledBackupJob: Cron | null;
}

declare global {
	var __schedulerState: SchedulerState | undefined;
}

function getSchedulerState(): SchedulerState {
	if (!globalThis.__schedulerState) {
		globalThis.__schedulerState = {
			initialized: false,
			jobs: new Map(),
			dynamicJobs: new Map(),
			scheduledBackupJob: null
		};
	}
	return globalThis.__schedulerState;
}

async function logSkippedUnhealthyConnectors(healthyConnectors: Connector[]): Promise<void> {
	const allEnabled = await getEnabledConnectors();
	const skipped = allEnabled.filter((c) => !healthyConnectors.some((hc) => hc.id === c.id));

	if (skipped.length > 0) {
		logger.info('Skipping unhealthy connectors', {
			connectors: skipped.map((c) => ({ id: c.id, name: c.name, healthStatus: c.healthStatus }))
		});
	}
}

/** Wraps job callback in a request context with correlation ID propagation */
function withJobContext(jobName: string, callback: () => Promise<void>): () => Promise<void> {
	return async () => {
		const context: RequestContext = {
			correlationId: generateCorrelationId(),
			source: 'scheduler',
			jobName
		};

		return runWithContext(context, callback);
	};
}

async function processConnectorQueue(connector: {
	id: number;
	name: string;
}): Promise<ConnectorProcessResult> {
	const result: ConnectorProcessResult = {
		connectorId: connector.id,
		connectorName: connector.name,
		dispatched: 0,
		succeeded: 0,
		failed: 0,
		rateLimited: 0
	};

	const dequeueResult = await dequeuePriorityItems(connector.id, { limit: 5 });

	if (!dequeueResult.success || dequeueResult.items.length === 0) {
		return result;
	}

	let rateLimitedAtIndex = -1;

	for (let i = 0; i < dequeueResult.items.length; i++) {
		const item = dequeueResult.items[i]!;

		const searchingResult = await setSearching(item.searchRegistryId);
		if (!searchingResult.success) {
			await revertToQueued([item.searchRegistryId]);
			continue;
		}

		result.dispatched++;

		const dispatchOptions =
			item.contentType === 'movie'
				? { movieIds: [item.contentId] }
				: { episodeIds: [item.contentId] };

		const dispatchStartTime = Date.now();
		const dispatchResult = await dispatchSearch(
			item.connectorId,
			item.searchRegistryId,
			item.contentType,
			item.searchType,
			dispatchOptions
		);
		const responseTimeMs = Date.now() - dispatchStartTime;

		if (dispatchResult.success) {
			result.succeeded++;
			await markSearchDispatched(item.searchRegistryId);
			await analyticsCollector.recordSearchDispatched(
				item.connectorId,
				item.searchRegistryId,
				item.contentType,
				item.searchType,
				dispatchResult.commandId!,
				responseTimeMs
			);
		} else {
			result.failed++;

			const failureCategory: FailureCategory = dispatchResult.rateLimited
				? 'rate_limited'
				: dispatchResult.error?.includes('timeout')
					? 'timeout'
					: dispatchResult.error?.includes('network')
						? 'network_error'
						: 'server_error';

			await analyticsCollector.recordSearchFailed(
				item.connectorId,
				item.searchRegistryId,
				item.contentType,
				item.searchType,
				failureCategory,
				dispatchResult.error,
				responseTimeMs
			);

			if (dispatchResult.rateLimited) {
				result.rateLimited++;
				if (dispatchResult.connectorPaused) {
					await markSearchFailed({
						searchRegistryId: item.searchRegistryId,
						failureCategory
					});
				}
				rateLimitedAtIndex = i;
				break;
			}

			await markSearchFailed({
				searchRegistryId: item.searchRegistryId,
				failureCategory
			});
		}
	}

	if (rateLimitedAtIndex >= 0) {
		const remainingItems = dequeueResult.items
			.slice(rateLimitedAtIndex)
			.map((item) => item.searchRegistryId);
		if (remainingItems.length > 0) {
			const revertResult = await revertToQueued(remainingItems);
			if (revertResult.success) {
				logger.debug('Reverted remaining items to queue after rate limit', {
					connectorId: connector.id,
					reverted: revertResult.reverted,
					requeued: revertResult.requeued
				});
			} else {
				logger.error('Failed to revert items to queue after rate limit', {
					connectorId: connector.id,
					error: revertResult.error,
					itemCount: remainingItems.length
				});
			}
		}
	}

	return result;
}

/** Initialize all scheduled jobs. Safe to call multiple times. */
export function initializeScheduler(): void {
	const state = getSchedulerState();

	if (state.initialized) {
		logger.info('Already initialized, skipping');
		return;
	}

	logger.info('Initializing scheduled jobs');

	initializeLogPersistence().catch((err) => {
		logger.error('Failed to initialize log persistence', {
			error: err instanceof Error ? err.message : String(err)
		});
	});

	const throttleResetJob = new Cron(
		'* * * * *',
		{
			name: 'throttle-window-reset',
			protect: true,
			catch: (err) => {
				logger.error('Throttle window reset failed', {
					error: err instanceof Error ? err.message : String(err)
				});
			}
		},
		withJobContext('throttle-window-reset', async () => {
			const result = await throttleEnforcer.resetExpiredWindows();

			if (result.minuteResets > 0 || result.dayResets > 0 || result.pausesCleared > 0) {
				logger.info('Throttle windows reset', {
					minuteResets: result.minuteResets,
					dayResets: result.dayResets,
					pausesCleared: result.pausesCleared
				});
			}

			const apiKeyResets = await apiKeyRateLimiter.resetExpiredWindows();

			if (apiKeyResets > 0) {
				logger.info('API key rate limit windows reset', {
					windowsReset: apiKeyResets
				});
			}
		})
	);

	state.jobs.set('throttle-window-reset', {
		name: 'throttle-window-reset',
		cron: throttleResetJob
	});

	const prowlarrHealthJob = new Cron(
		'*/5 * * * *',
		{
			name: 'prowlarr-health-check',
			protect: true,
			catch: (err) => {
				logger.error('Prowlarr health check failed', {
					error: err instanceof Error ? err.message : String(err)
				});
			}
		},
		withJobContext('prowlarr-health-check', async () => {
			const results = await prowlarrHealthMonitor.checkAllInstances();

			if (results.length > 0) {
				const unhealthy = results.filter((r) => r.status !== 'healthy');
				if (unhealthy.length > 0) {
					logger.warn('Prowlarr health issues detected', {
						total: results.length,
						unhealthy: unhealthy.length,
						issues: unhealthy.map((r) => ({
							instance: r.instanceName,
							status: r.status,
							error: r.error
						}))
					});
				}
			}
		})
	);

	state.jobs.set('prowlarr-health-check', {
		name: 'prowlarr-health-check',
		cron: prowlarrHealthJob
	});

	const connectorHealthJob = new Cron(
		'*/5 * * * *',
		{
			name: 'connector-health-check',
			protect: true,
			catch: (err) => {
				logger.error('Connector health check failed', {
					error: err instanceof Error ? err.message : String(err)
				});
			}
		},
		withJobContext('connector-health-check', async () => {
			const connectors = await getEnabledConnectors();

			if (connectors.length === 0) {
				return;
			}

			const results: Array<{
				id: number;
				name: string;
				oldStatus: string;
				newStatus: string;
				error?: string;
			}> = [];

			for (const connector of connectors) {
				try {
					const apiKey = await getDecryptedApiKey(connector);
					const client = createConnectorClient(connector, apiKey);
					const isReachable = await client.ping();

					if (!isReachable) {
						await updateConnectorHealth(connector.id, 'offline');
						results.push({
							id: connector.id,
							name: connector.name,
							oldStatus: connector.healthStatus,
							newStatus: 'offline',
							error: 'Connection failed'
						});
						await initializeReconnectForOfflineConnector(connector.id);
						continue;
					}

					const healthChecks = await client.getHealth();
					const newStatus = determineHealthFromChecks(healthChecks);
					await updateConnectorHealth(connector.id, newStatus);

					if (connector.healthStatus !== newStatus) {
						results.push({
							id: connector.id,
							name: connector.name,
							oldStatus: connector.healthStatus,
							newStatus
						});
					}
				} catch (error) {
					let newStatus: HealthStatus;
					let errorMsg: string;

					if (error instanceof AuthenticationError) {
						newStatus = 'unhealthy';
						errorMsg = 'Authentication failed';
					} else if (error instanceof NetworkError || error instanceof TimeoutError) {
						newStatus = 'offline';
						errorMsg = error.message;
					} else {
						newStatus = 'unhealthy';
						errorMsg = error instanceof Error ? error.message : 'Unknown error';
					}

					await updateConnectorHealth(connector.id, newStatus);
					results.push({
						id: connector.id,
						name: connector.name,
						oldStatus: connector.healthStatus,
						newStatus,
						error: errorMsg
					});
					if (newStatus === 'offline' || newStatus === 'unhealthy') {
						await initializeReconnectForOfflineConnector(connector.id);
					}
				}
			}

			if (results.length > 0) {
				logger.info('Connector health status changes', { results });
			}
		})
	);

	state.jobs.set('connector-health-check', {
		name: 'connector-health-check',
		cron: connectorHealthJob
	});

	const connectorReconnectJob = new Cron(
		'*/30 * * * * *',
		{
			name: 'connector-reconnect',
			protect: true,
			catch: (err) => {
				logger.error('Connector reconnect failed', {
					error: err instanceof Error ? err.message : String(err)
				});
			}
		},
		withJobContext('connector-reconnect', async () => {
			const results = await processReconnections();

			if (results.processed > 0) {
				logger.info('Connector reconnections processed', {
					processed: results.processed,
					succeeded: results.succeeded,
					failed: results.failed,
					details: results.results.map((r) => ({
						id: r.connectorId,
						name: r.connectorName,
						success: r.success,
						newStatus: r.newStatus,
						attempt: r.attemptNumber,
						error: r.error
					}))
				});
			}
		})
	);

	state.jobs.set('connector-reconnect', {
		name: 'connector-reconnect',
		cron: connectorReconnectJob
	});

	const incrementalSyncJob = new Cron(
		'*/15 * * * *',
		{
			name: 'incremental-sync-sweep',
			protect: true,
			catch: (err) => {
				logger.error('Incremental sync sweep failed', {
					error: err instanceof Error ? err.message : String(err)
				});
			}
		},
		withJobContext('incremental-sync-sweep', async () => {
			const startTime = Date.now();
			const connectors = await getHealthyConnectors();
			await logSkippedUnhealthyConnectors(connectors);

			if (connectors.length === 0) {
				return;
			}

			const summary = {
				connectorsProcessed: 0,
				syncErrors: 0,
				totalItemsSynced: 0,
				totalGapsFound: 0,
				totalUpgradesFound: 0,
				totalItemsEnqueued: 0
			};

			for (const connector of connectors) {
				try {
					const syncResult = await runIncrementalSync(connector);
					if (syncResult.success) {
						summary.totalItemsSynced += syncResult.itemsSynced;
						try {
							await captureConnectorSnapshotAfterSync(connector.id);
						} catch (snapshotError) {
							logger.warn('Failed to capture completion snapshot', {
								connectorId: connector.id,
								error:
									snapshotError instanceof Error ? snapshotError.message : String(snapshotError)
							});
						}
					} else {
						summary.syncErrors++;
						logger.warn('Sync failed for connector', {
							connectorId: connector.id,
							name: connector.name,
							error: syncResult.error
						});
						continue;
					}

					const gapsResult = await discoverGaps(connector.id);
					const upgradesResult = await discoverUpgrades(connector.id);

					if (gapsResult.success) {
						summary.totalGapsFound += gapsResult.registriesCreated;
						await analyticsCollector.recordGapDiscovery(connector.id, gapsResult);
					}
					if (upgradesResult.success) {
						summary.totalUpgradesFound += upgradesResult.registriesCreated;
						await analyticsCollector.recordUpgradeDiscovery(connector.id, upgradesResult);
					}

					const enqueueResult = await enqueuePendingItems(connector.id);
					if (enqueueResult.success) {
						summary.totalItemsEnqueued += enqueueResult.itemsEnqueued;
					}

					summary.connectorsProcessed++;
				} catch (error) {
					summary.syncErrors++;
					logger.error('Error processing connector', {
						connectorId: connector.id,
						name: connector.name,
						error: error instanceof Error ? error.message : String(error)
					});
				}
			}

			const durationMs = Date.now() - startTime;
			if (
				summary.totalItemsSynced > 0 ||
				summary.totalGapsFound > 0 ||
				summary.totalUpgradesFound > 0 ||
				summary.totalItemsEnqueued > 0 ||
				summary.syncErrors > 0
			) {
				logger.info('Incremental sync sweep completed', {
					...summary,
					durationMs
				});
			}
		})
	);

	state.jobs.set('incremental-sync-sweep', {
		name: 'incremental-sync-sweep',
		cron: incrementalSyncJob
	});

	const fullReconciliationJob = new Cron(
		'0 3 * * *',
		{
			name: 'full-reconciliation',
			protect: true,
			catch: (err) => {
				logger.error('Full reconciliation failed', {
					error: err instanceof Error ? err.message : String(err)
				});
			}
		},
		withJobContext('full-reconciliation', async () => {
			const startTime = Date.now();
			const connectors = await getHealthyConnectors();
			await logSkippedUnhealthyConnectors(connectors);

			if (connectors.length === 0) {
				return;
			}

			const summary = {
				connectorsProcessed: 0,
				reconciliationErrors: 0,
				totalCreated: 0,
				totalUpdated: 0,
				totalDeleted: 0,
				totalGapsFound: 0,
				totalUpgradesFound: 0,
				totalItemsEnqueued: 0
			};

			for (const connector of connectors) {
				try {
					const reconcileResult = await runFullReconciliation(connector);
					if (reconcileResult.success) {
						summary.totalCreated += reconcileResult.itemsCreated;
						summary.totalUpdated += reconcileResult.itemsUpdated;
						summary.totalDeleted += reconcileResult.itemsDeleted;
						try {
							await captureConnectorSnapshotAfterSync(connector.id);
						} catch (snapshotError) {
							logger.warn('Failed to capture completion snapshot', {
								connectorId: connector.id,
								error:
									snapshotError instanceof Error ? snapshotError.message : String(snapshotError)
							});
						}
					} else {
						summary.reconciliationErrors++;
						logger.warn('Reconciliation failed for connector', {
							connectorId: connector.id,
							name: connector.name,
							error: reconcileResult.error
						});
						continue;
					}

					const gapsResult = await discoverGaps(connector.id);
					const upgradesResult = await discoverUpgrades(connector.id);

					if (gapsResult.success) {
						summary.totalGapsFound += gapsResult.registriesCreated;
						await analyticsCollector.recordGapDiscovery(connector.id, gapsResult);
					}
					if (upgradesResult.success) {
						summary.totalUpgradesFound += upgradesResult.registriesCreated;
						await analyticsCollector.recordUpgradeDiscovery(connector.id, upgradesResult);
					}

					const enqueueResult = await enqueuePendingItems(connector.id);
					if (enqueueResult.success) {
						summary.totalItemsEnqueued += enqueueResult.itemsEnqueued;
					}

					summary.connectorsProcessed++;
				} catch (error) {
					summary.reconciliationErrors++;
					logger.error('Error during reconciliation', {
						connectorId: connector.id,
						name: connector.name,
						error: error instanceof Error ? error.message : String(error)
					});
				}
			}

			const durationMs = Date.now() - startTime;
			logger.info('Full reconciliation completed', {
				...summary,
				durationMs
			});
		})
	);

	state.jobs.set('full-reconciliation', {
		name: 'full-reconciliation',
		cron: fullReconciliationJob
	});

	const completionSnapshotJob = new Cron(
		'0 4 * * *',
		{
			name: 'completion-snapshot',
			protect: true,
			catch: (err) => {
				logger.error('Completion snapshot failed', {
					error: err instanceof Error ? err.message : String(err)
				});
			}
		},
		withJobContext('completion-snapshot', async () => {
			const { captureCompletionSnapshots, cleanupOldSnapshots } = await import(
				'$lib/server/db/queries/completion'
			);

			const captured = await captureCompletionSnapshots();
			const cleaned = await cleanupOldSnapshots(30);

			if (captured > 0 || cleaned > 0) {
				logger.info('Completion snapshot', {
					snapshotsCaptured: captured,
					oldSnapshotsCleaned: cleaned
				});
			}
		})
	);

	state.jobs.set('completion-snapshot', {
		name: 'completion-snapshot',
		cron: completionSnapshotJob
	});

	const dbMaintenanceJob = new Cron(
		'30 4 * * *',
		{
			name: 'db-maintenance',
			protect: true,
			catch: (err) => {
				logger.error('Database maintenance failed', {
					error: err instanceof Error ? err.message : String(err)
				});
			}
		},
		withJobContext('db-maintenance', async () => {
			const maintenanceResult = await runDatabaseMaintenance();

			if (maintenanceResult.success) {
				logger.info('Database maintenance completed', {
					vacuumDurationMs: maintenanceResult.vacuumDurationMs,
					analyzeDurationMs: maintenanceResult.analyzeDurationMs,
					totalDurationMs: maintenanceResult.totalDurationMs
				});
			} else {
				logger.error('Database maintenance failed', { error: maintenanceResult.error });
			}

			const orphanResult = await cleanupOrphanedSearchState();

			if (orphanResult.success) {
				if (orphanResult.totalOrphansDeleted > 0) {
					logger.info('Orphan cleanup completed', {
						episodeOrphansDeleted: orphanResult.episodeOrphansDeleted,
						movieOrphansDeleted: orphanResult.movieOrphansDeleted,
						totalOrphansDeleted: orphanResult.totalOrphansDeleted,
						durationMs: orphanResult.durationMs
					});
				}
			} else {
				logger.error('Orphan cleanup failed', { error: orphanResult.error });
			}

			const historyResult = await pruneSearchHistory();

			if (historyResult.success) {
				if (historyResult.searchHistoryDeleted > 0) {
					logger.info('History pruning completed', {
						searchHistoryDeleted: historyResult.searchHistoryDeleted,
						durationMs: historyResult.durationMs
					});
				}
			} else {
				logger.error('History pruning failed', { error: historyResult.error });
			}

			const logResult = await pruneApplicationLogs();

			if (logResult.success) {
				if (logResult.logsDeleted > 0) {
					logger.info('Log pruning completed', {
						logsDeleted: logResult.logsDeleted,
						durationMs: logResult.durationMs
					});
				}
			} else {
				logger.error('Log pruning failed', { error: logResult.error });
			}
		})
	);

	state.jobs.set('db-maintenance', {
		name: 'db-maintenance',
		cron: dbMaintenanceJob
	});

	const queueProcessorJob = new Cron(
		'* * * * *',
		{
			name: 'queue-processor',
			protect: true,
			catch: (err) => {
				logger.error('Queue processor failed', {
					error: err instanceof Error ? err.message : String(err)
				});
			}
		},
		withJobContext('queue-processor', async () => {
			const startTime = Date.now();
			const orphanCleanup = await cleanupOrphanedSearchingItems(10);
			const reenqueueResult = await reenqueueEligibleCooldownItems();

			const summary = {
				orphansRecovered: orphanCleanup.success ? orphanCleanup.requeued : 0,
				reenqueued: reenqueueResult.success ? reenqueueResult.itemsReenqueued : 0,
				dispatched: 0,
				succeeded: 0,
				failed: 0,
				rateLimited: 0
			};

			const connectors = await getHealthyConnectors();

			if (connectors.length > 0) {
				const results = await Promise.allSettled(
					connectors.map((connector) => processConnectorQueue(connector))
				);

				for (const result of results) {
					if (result.status === 'fulfilled') {
						summary.dispatched += result.value.dispatched;
						summary.succeeded += result.value.succeeded;
						summary.failed += result.value.failed;
						summary.rateLimited += result.value.rateLimited;
					} else {
						logger.error('Error processing queue for connector', {
							error: result.reason instanceof Error ? result.reason.message : String(result.reason)
						});
					}
				}
			}

			const durationMs = Date.now() - startTime;
			if (
				summary.orphansRecovered > 0 ||
				summary.reenqueued > 0 ||
				summary.dispatched > 0 ||
				summary.failed > 0 ||
				summary.rateLimited > 0
			) {
				logger.info('Queue processor completed', {
					...summary,
					durationMs
				});
			}
		})
	);

	state.jobs.set('queue-processor', {
		name: 'queue-processor',
		cron: queueProcessorJob
	});

	const notificationBatchJob = new Cron(
		'* * * * *',
		{
			name: 'notification-batch-processor',
			protect: true,
			catch: (err) => {
				logger.error('Notification batch processing failed', {
					error: err instanceof Error ? err.message : String(err)
				});
			}
		},
		withJobContext('notification-batch-processor', async () => {
			const { processBatches } = await import('$lib/server/services/notifications/batcher');

			const result = await processBatches();

			if (result.batchesSent > 0 || result.errors > 0) {
				logger.info('Notification batches processed', {
					channelsProcessed: result.channelsProcessed,
					batchesSent: result.batchesSent,
					notificationsBatched: result.notificationsBatched,
					errors: result.errors
				});
			}
		})
	);

	state.jobs.set('notification-batch-processor', {
		name: 'notification-batch-processor',
		cron: notificationBatchJob
	});

	const queueDepthSamplerJob = new Cron(
		'*/5 * * * *',
		{
			name: 'queue-depth-sampler',
			protect: true,
			catch: (err) => {
				logger.error('Queue depth sampling failed', {
					error: err instanceof Error ? err.message : String(err)
				});
			}
		},
		withJobContext('queue-depth-sampler', async () => {
			const samples = await analyticsCollector.sampleQueueDepth();

			if (samples.length > 0) {
				const totalDepth = samples.reduce((sum, s) => sum + s.queueDepth, 0);
				logger.info('Queue depth sampled', {
					connectors: samples.length,
					totalQueueDepth: totalDepth
				});
			}
		})
	);

	state.jobs.set('queue-depth-sampler', {
		name: 'queue-depth-sampler',
		cron: queueDepthSamplerJob
	});

	const hourlyAggregationJob = new Cron(
		'5 * * * *',
		{
			name: 'analytics-hourly-aggregation',
			protect: true,
			catch: (err) => {
				logger.error('Hourly analytics aggregation failed', {
					error: err instanceof Error ? err.message : String(err)
				});
			}
		},
		withJobContext('analytics-hourly-aggregation', async () => {
			const previousHour = new Date();
			previousHour.setHours(previousHour.getHours() - 1);
			previousHour.setMinutes(0, 0, 0);

			const result = await aggregateHourlyStats(previousHour);

			if (result.success && result.hourlyStatsUpdated > 0) {
				logger.info('Hourly analytics aggregated', {
					hour: previousHour.toISOString(),
					statsUpdated: result.hourlyStatsUpdated,
					eventsProcessed: result.eventsProcessed,
					durationMs: result.durationMs
				});
			}
		})
	);

	state.jobs.set('analytics-hourly-aggregation', {
		name: 'analytics-hourly-aggregation',
		cron: hourlyAggregationJob
	});

	const dailyAggregationJob = new Cron(
		'0 1 * * *',
		{
			name: 'analytics-daily-aggregation',
			protect: true,
			catch: (err) => {
				logger.error('Daily analytics aggregation failed', {
					error: err instanceof Error ? err.message : String(err)
				});
			}
		},
		withJobContext('analytics-daily-aggregation', async () => {
			const previousDay = new Date();
			previousDay.setDate(previousDay.getDate() - 1);
			previousDay.setHours(0, 0, 0, 0);

			const result = await aggregateDailyStats(previousDay);

			if (result.success) {
				logger.info('Daily analytics aggregated', {
					date: previousDay.toISOString().split('T')[0],
					statsUpdated: result.dailyStatsUpdated,
					durationMs: result.durationMs
				});
			}

			const eventsDeleted = await cleanupOldEvents(7);
			if (eventsDeleted > 0) {
				logger.info('Old analytics events cleaned up', { eventsDeleted });
			}
		})
	);

	state.jobs.set('analytics-daily-aggregation', {
		name: 'analytics-daily-aggregation',
		cron: dailyAggregationJob
	});

	initializeScheduledBackup().catch((err) => {
		logger.error('Failed to initialize scheduled backup', {
			error: err instanceof Error ? err.message : String(err)
		});
	});

	state.initialized = true;
	logger.info('Scheduled jobs initialized', { jobs: Array.from(state.jobs.keys()) });
}

/** Stop all scheduled jobs. Used for graceful shutdown. */
export async function stopScheduler(): Promise<void> {
	const state = getSchedulerState();
	logger.info('Stopping all scheduled jobs');

	for (const [name, job] of state.jobs) {
		job.cron.stop();
		logger.info('Stopped job', { name });
	}
	state.jobs.clear();

	for (const [id, cron] of state.dynamicJobs) {
		cron.stop();
		logger.info('Stopped dynamic schedule', { id });
	}
	state.dynamicJobs.clear();

	if (state.scheduledBackupJob) {
		state.scheduledBackupJob.stop();
		state.scheduledBackupJob = null;
		logger.info('Stopped scheduled backup job');
	}

	try {
		const flushed = await shutdownLogPersistence();
		if (flushed > 0) {
			logger.info('Flushed pending logs', { count: flushed });
		}
	} catch (err) {
		logger.error('Failed to flush pending logs', {
			error: err instanceof Error ? err.message : String(err)
		});
	}

	state.initialized = false;
	logger.info('All scheduled jobs stopped');
}

export function getSchedulerStatus(): {
	initialized: boolean;
	jobs: Array<{
		name: string;
		isRunning: boolean;
		nextRun: Date | null;
	}>;
	dynamicSchedules: Array<{
		id: number;
		isRunning: boolean;
		nextRun: Date | null;
	}>;
	scheduledBackup: {
		enabled: boolean;
		isRunning: boolean;
		nextRun: Date | null;
	} | null;
} {
	const state = getSchedulerState();
	return {
		initialized: state.initialized,
		jobs: Array.from(state.jobs.values()).map((job) => ({
			name: job.name,
			isRunning: job.cron.isBusy(),
			nextRun: job.cron.nextRun()
		})),
		dynamicSchedules: Array.from(state.dynamicJobs.entries()).map(([id, cron]) => ({
			id,
			isRunning: cron.isBusy(),
			nextRun: cron.nextRun()
		})),
		scheduledBackup: state.scheduledBackupJob
			? {
					enabled: true,
					isRunning: state.scheduledBackupJob.isBusy(),
					nextRun: state.scheduledBackupJob.nextRun()
				}
			: null
	};
}

export async function refreshDynamicSchedules(): Promise<void> {
	const state = getSchedulerState();
	logger.info('Refreshing dynamic schedules');

	for (const [_id, cron] of state.dynamicJobs) {
		cron.stop();
	}
	state.dynamicJobs.clear();

	const schedules = await getEnabledSchedules();

	for (const schedule of schedules) {
		try {
			const cron = new Cron(
				schedule.cronExpression,
				{
					name: `sweep-schedule-${schedule.id}`,
					timezone: schedule.timezone,
					protect: true,
					catch: (err) => {
						logger.error('Dynamic schedule failed', {
							scheduleId: schedule.id,
							scheduleName: schedule.name,
							error: err instanceof Error ? err.message : String(err)
						});
					}
				},
				withJobContext(`sweep-schedule-${schedule.id}`, async () => {
					const startTime = Date.now();

					let targetConnectors: Connector[];
					if (schedule.connectorId) {
						const connector = await getConnector(schedule.connectorId);
						if (
							!connector ||
							!connector.enabled ||
							!['healthy', 'degraded'].includes(connector.healthStatus ?? '')
						) {
							logger.warn('Schedule skipped - connector not healthy', {
								scheduleId: schedule.id,
								scheduleName: schedule.name,
								connectorId: schedule.connectorId,
								reason: !connector ? 'not found' : !connector.enabled ? 'disabled' : 'unhealthy'
							});
							return;
						}
						targetConnectors = [connector];
					} else {
						targetConnectors = await getHealthyConnectors();
					}

					if (targetConnectors.length === 0) {
						logger.debug('Schedule skipped - no healthy connectors', {
							scheduleId: schedule.id,
							scheduleName: schedule.name
						});
						return;
					}

					const summary = {
						connectorsProcessed: 0,
						syncErrors: 0,
						totalItemsSynced: 0,
						totalGapsFound: 0,
						totalUpgradesFound: 0,
						totalItemsEnqueued: 0
					};

					for (const connector of targetConnectors) {
						try {
							const syncResult =
								schedule.sweepType === 'full_reconciliation'
									? await runFullReconciliation(connector)
									: await runIncrementalSync(connector);

							if (!syncResult.success) {
								summary.syncErrors++;
								logger.warn('Schedule sync failed for connector', {
									scheduleId: schedule.id,
									connectorId: connector.id,
									connectorName: connector.name,
									error: syncResult.error
								});
								continue;
							}

							if ('itemsSynced' in syncResult) {
								summary.totalItemsSynced += syncResult.itemsSynced;
							} else if ('itemsCreated' in syncResult) {
								summary.totalItemsSynced += syncResult.itemsCreated + syncResult.itemsUpdated;
							}

							try {
								await captureConnectorSnapshotAfterSync(connector.id);
							} catch (snapshotError) {
								logger.warn('Failed to capture completion snapshot', {
									connectorId: connector.id,
									error:
										snapshotError instanceof Error ? snapshotError.message : String(snapshotError)
								});
							}

							const gapsResult = await discoverGaps(connector.id);
							const upgradesResult = await discoverUpgrades(connector.id);

							if (gapsResult.success) {
								summary.totalGapsFound += gapsResult.registriesCreated;
							}
							if (upgradesResult.success) {
								summary.totalUpgradesFound += upgradesResult.registriesCreated;
							}

							const enqueueResult = await enqueuePendingItems(connector.id);
							if (enqueueResult.success) {
								summary.totalItemsEnqueued += enqueueResult.itemsEnqueued;
							}

							summary.connectorsProcessed++;
						} catch (error) {
							summary.syncErrors++;
							logger.error('Schedule error processing connector', {
								scheduleId: schedule.id,
								connectorId: connector.id,
								connectorName: connector.name,
								error: error instanceof Error ? error.message : String(error)
							});
						}
					}

					const nextRun = state.dynamicJobs.get(schedule.id)?.nextRun();
					if (nextRun) {
						await updateNextRunAt(schedule.id, nextRun);
					}

					const durationMs = Date.now() - startTime;
					logger.info('Dynamic schedule completed', {
						scheduleId: schedule.id,
						scheduleName: schedule.name,
						sweepType: schedule.sweepType,
						...summary,
						durationMs
					});
				})
			);

			state.dynamicJobs.set(schedule.id, cron);

			const nextRun = cron.nextRun();
			if (nextRun) {
				await updateNextRunAt(schedule.id, nextRun);
			}
		} catch (error) {
			logger.error('Failed to create job for schedule', {
				scheduleId: schedule.id,
				error: error instanceof Error ? error.message : String(error)
			});
		}
	}

	logger.info('Loaded dynamic schedules', { count: state.dynamicJobs.size });
}
async function initializeLogPersistence(): Promise<void> {
	try {
		const enabled = await getSettingWithDefault('log_persistence_enabled');

		if (enabled !== 'true') {
			logger.info('Log persistence is disabled');
			return;
		}

		enableLogPersistence();
		logger.info('Log persistence enabled');
	} catch (error) {
		logger.error('Failed to initialize log persistence', {
			error: error instanceof Error ? error.message : String(error)
		});
	}
}

async function initializeScheduledBackup(): Promise<void> {
	try {
		const settings = await getBackupSettings();

		if (!settings.scheduledEnabled) {
			logger.info('Scheduled backups are disabled');
			return;
		}

		await createScheduledBackupJob(settings.scheduledCron, settings.retentionCount);
	} catch (error) {
		logger.error('Failed to initialize scheduled backup', {
			error: error instanceof Error ? error.message : String(error)
		});
	}
}

async function createScheduledBackupJob(
	cronExpression: string,
	retentionCount: number
): Promise<void> {
	const state = getSchedulerState();

	if (state.scheduledBackupJob) {
		state.scheduledBackupJob.stop();
		state.scheduledBackupJob = null;
	}

	try {
		state.scheduledBackupJob = new Cron(
			cronExpression,
			{
				name: 'scheduled-backup',
				protect: true,
				catch: (err) => {
					logger.error('Scheduled backup failed', {
						error: err instanceof Error ? err.message : String(err)
					});
				}
			},
			withJobContext('scheduled-backup', async () => {
				const startTime = Date.now();
				logger.info('Starting scheduled backup');

				const backupResult = await createBackup({
					type: 'scheduled',
					description: 'Scheduled automatic backup'
				});

				if (backupResult.success) {
					logger.info('Scheduled backup completed', {
						backupId: backupResult.metadata?.id,
						filePath: backupResult.filePath,
						fileSizeBytes: backupResult.fileSizeBytes,
						durationMs: backupResult.durationMs
					});

					const cleanupResult = await cleanupOldScheduledBackups(retentionCount);

					if (cleanupResult.success && cleanupResult.deletedCount > 0) {
						logger.info('Cleaned up old scheduled backups', {
							deletedCount: cleanupResult.deletedCount
						});
					}
				} else {
					logger.error('Scheduled backup failed', {
						error: backupResult.error,
						durationMs: backupResult.durationMs
					});
				}

				const totalDurationMs = Date.now() - startTime;
				logger.info('Scheduled backup job completed', { totalDurationMs });
			})
		);

		const nextRun = state.scheduledBackupJob.nextRun();
		logger.info('Scheduled backup job created', {
			cronExpression,
			retentionCount,
			nextRun: nextRun?.toISOString()
		});
	} catch (error) {
		logger.error('Failed to create scheduled backup job', {
			error: error instanceof Error ? error.message : String(error)
		});
		state.scheduledBackupJob = null;
	}
}

/** Refresh the scheduled backup job from database settings. */
export async function refreshScheduledBackup(): Promise<void> {
	const state = getSchedulerState();
	logger.info('Refreshing scheduled backup configuration');

	try {
		const settings = await getBackupSettings();

		if (!settings.scheduledEnabled) {
			if (state.scheduledBackupJob) {
				state.scheduledBackupJob.stop();
				state.scheduledBackupJob = null;
				logger.info('Scheduled backups disabled');
			}
			return;
		}

		await createScheduledBackupJob(settings.scheduledCron, settings.retentionCount);
	} catch (error) {
		logger.error('Failed to refresh scheduled backup', {
			error: error instanceof Error ? error.message : String(error)
		});
	}
}
