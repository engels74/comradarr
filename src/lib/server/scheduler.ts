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
import { runWithContext, generateCorrelationId, type RequestContext } from '$lib/server/context';
import { throttleEnforcer } from '$lib/server/services/throttle';
import { apiKeyRateLimiter } from '$lib/server/services/api-rate-limit';
import { prowlarrHealthMonitor } from '$lib/server/services/prowlarr';
import {
	getEnabledConnectors,
	getHealthyConnectors,
	getDecryptedApiKey,
	updateConnectorHealth
} from '$lib/server/db/queries/connectors';
import {
	getEnabledSchedules,
	updateNextRunAt,
	type ScheduleWithRelations
} from '$lib/server/db/queries/schedules';
import type { Connector } from '$lib/server/db/schema';
import { createConnectorClient } from '$lib/server/connectors/factory';
import { determineHealthFromChecks, type HealthStatus } from '$lib/server/services/sync/health-utils';
import { AuthenticationError, NetworkError, TimeoutError } from '$lib/server/connectors/common/errors';
import { runIncrementalSync, runFullReconciliation } from '$lib/server/services/sync';
import { discoverGaps, discoverUpgrades } from '$lib/server/services/discovery';
import {
	enqueuePendingItems,
	dequeuePriorityItems,
	reenqueueEligibleCooldownItems,
	dispatchSearch,
	markSearchFailed,
	type FailureCategory
} from '$lib/server/services/queue';
import {
	analyticsCollector,
	aggregateHourlyStats,
	aggregateDailyStats,
	cleanupOldEvents
} from '$lib/server/services/analytics';
import {
	runDatabaseMaintenance,
	cleanupOrphanedSearchState,
	pruneSearchHistory
} from '$lib/server/services/maintenance';
import { createBackup, cleanupOldScheduledBackups } from '$lib/server/services/backup';
import { getBackupSettings } from '$lib/server/db/queries/settings';
import { createLogger } from '$lib/server/logger';

const logger = createLogger('scheduler');

// =============================================================================
// Types
// =============================================================================

/**
 * Scheduled job registration.
 */
interface ScheduledJob {
	name: string;
	cron: Cron;
}

// =============================================================================
// Module State
// =============================================================================

/** Map of registered static jobs */
const jobs: Map<string, ScheduledJob> = new Map();

/** Map of dynamic schedule jobs (loaded from database) */
const dynamicJobs: Map<number, Cron> = new Map();

/** Scheduled backup job (dynamically created based on settings) */
let scheduledBackupJob: Cron | null = null;

/** Flag to prevent multiple initializations */
let initialized = false;

// =============================================================================
// Internal Helpers
// =============================================================================

/**
 * Logs connectors that are being skipped due to unhealthy status.
 * Used by sweep cycle jobs to inform about excluded connectors.
 *
 * @param healthyConnectors - Connectors that will be processed
 */
async function logSkippedUnhealthyConnectors(healthyConnectors: Connector[]): Promise<void> {
	const allEnabled = await getEnabledConnectors();
	const skipped = allEnabled.filter((c) => !healthyConnectors.some((hc) => hc.id === c.id));

	if (skipped.length > 0) {
		logger.info('Skipping unhealthy connectors', {
			connectors: skipped.map((c) => ({ id: c.id, name: c.name, healthStatus: c.healthStatus }))
		});
	}
}

/**
 * Creates a job executor that wraps the callback in a request context.
 * Ensures all scheduled jobs have proper correlation ID propagation.
 *
 * @param jobName - Name of the job for context tracking
 * @param callback - The job callback to wrap
 * @returns Wrapped callback that executes within a request context
 */
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

// =============================================================================
// Public API
// =============================================================================

/**
 * Initialize all scheduled jobs.
 * Safe to call multiple times - will only initialize once.
 */
export function initializeScheduler(): void {
	if (initialized) {
		logger.info('Already initialized, skipping');
		return;
	}

	logger.info('Initializing scheduled jobs');

	// Throttle window reset - runs every minute
	// Resets expired per-minute counters, daily counters, and clears expired pauses
	// Also resets expired API key rate limit windows
	const throttleResetJob = new Cron(
		'* * * * *', // Every minute
		{
			name: 'throttle-window-reset',
			protect: true, // Prevent overlapping executions
			catch: (err) => {
				logger.error('Throttle window reset failed', { error: err instanceof Error ? err.message : String(err) });
			}
		},
		withJobContext('throttle-window-reset', async () => {
			// Reset connector throttle windows
			const result = await throttleEnforcer.resetExpiredWindows();

			// Only log if resets occurred (reduce log noise)
			if (result.minuteResets > 0 || result.dayResets > 0 || result.pausesCleared > 0) {
				logger.info('Throttle windows reset', {
					minuteResets: result.minuteResets,
					dayResets: result.dayResets,
					pausesCleared: result.pausesCleared
				});
			}

			// Reset API key rate limit windows
			const apiKeyResets = await apiKeyRateLimiter.resetExpiredWindows();

			if (apiKeyResets > 0) {
				logger.info('API key rate limit windows reset', {
					windowsReset: apiKeyResets
				});
			}
		})
	);

	jobs.set('throttle-window-reset', {
		name: 'throttle-window-reset',
		cron: throttleResetJob
	});

	// Prowlarr health check - runs every 5 minutes
	// Checks indexer health status from Prowlarr and caches results
	const prowlarrHealthJob = new Cron(
		'*/5 * * * *', // Every 5 minutes
		{
			name: 'prowlarr-health-check',
			protect: true, // Prevent overlapping executions
			catch: (err) => {
				logger.error('Prowlarr health check failed', { error: err instanceof Error ? err.message : String(err) });
			}
		},
		withJobContext('prowlarr-health-check', async () => {
			const results = await prowlarrHealthMonitor.checkAllInstances();

			// Only log if there are instances to check
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

	jobs.set('prowlarr-health-check', {
		name: 'prowlarr-health-check',
		cron: prowlarrHealthJob
	});

	// Connector health check - runs every 5 minutes
	// Checks *arr connector health status and updates database
	const connectorHealthJob = new Cron(
		'*/5 * * * *', // Every 5 minutes
		{
			name: 'connector-health-check',
			protect: true, // Prevent overlapping executions
			catch: (err) => {
				logger.error('Connector health check failed', { error: err instanceof Error ? err.message : String(err) });
			}
		},
		withJobContext('connector-health-check', async () => {
			const connectors = await getEnabledConnectors();

			if (connectors.length === 0) {
				return; // No connectors to check
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
					// Decrypt API key and create client
					const apiKey = await getDecryptedApiKey(connector);
					const client = createConnectorClient(connector, apiKey);

					// Try to ping first (fast connectivity check)
					const isReachable = await client.ping();

					if (!isReachable) {
						// Can't reach connector - mark as offline
						await updateConnectorHealth(connector.id, 'offline');
						results.push({
							id: connector.id,
							name: connector.name,
							oldStatus: connector.healthStatus,
							newStatus: 'offline',
							error: 'Connection failed'
						});
						continue;
					}

					// Get health checks from API
					const healthChecks = await client.getHealth();
					const newStatus = determineHealthFromChecks(healthChecks);

					// Update status in database
					await updateConnectorHealth(connector.id, newStatus);

					// Track if status changed
					if (connector.healthStatus !== newStatus) {
						results.push({
							id: connector.id,
							name: connector.name,
							oldStatus: connector.healthStatus,
							newStatus
						});
					}
				} catch (error) {
					// Categorize error to determine status
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
				}
			}

			// Log only if there were status changes
			if (results.length > 0) {
				logger.info('Connector health status changes', { results });
			}
		})
	);

	jobs.set('connector-health-check', {
		name: 'connector-health-check',
		cron: connectorHealthJob
	});

	// =========================================================================
	// Sweep Cycle Jobs
	// =========================================================================

	// Incremental sync sweep - runs every 15 minutes
	// Syncs content from *arr apps, discovers gaps/upgrades, enqueues items
	// Only processes healthy connectors
	const incrementalSyncJob = new Cron(
		'*/15 * * * *', // Every 15 minutes
		{
			name: 'incremental-sync-sweep',
			protect: true, // Prevent overlapping executions
			catch: (err) => {
				logger.error('Incremental sync sweep failed', { error: err instanceof Error ? err.message : String(err) });
			}
		},
		withJobContext('incremental-sync-sweep', async () => {
			const startTime = Date.now();
			// Only process healthy connectors
			const connectors = await getHealthyConnectors();

			// Log any unhealthy connectors being skipped
			await logSkippedUnhealthyConnectors(connectors);

			if (connectors.length === 0) {
				return; // No healthy connectors to process
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
					// 1. Run incremental sync
					const syncResult = await runIncrementalSync(connector);
					if (syncResult.success) {
						summary.totalItemsSynced += syncResult.itemsSynced;
					} else {
						summary.syncErrors++;
						logger.warn('Sync failed for connector', {
							connectorId: connector.id,
							name: connector.name,
							error: syncResult.error
						});
						continue; // Skip discovery/enqueue for failed sync
					}

					// 2. Run discovery (gaps and upgrades)
					const [gapsResult, upgradesResult] = await Promise.all([
						discoverGaps(connector.id),
						discoverUpgrades(connector.id)
					]);

					if (gapsResult.success) {
						summary.totalGapsFound += gapsResult.registriesCreated;
						// Record analytics for gap discovery
						await analyticsCollector.recordGapDiscovery(connector.id, gapsResult);
					}
					if (upgradesResult.success) {
						summary.totalUpgradesFound += upgradesResult.registriesCreated;
						// Record analytics for upgrade discovery
						await analyticsCollector.recordUpgradeDiscovery(connector.id, upgradesResult);
					}

					// 3. Enqueue pending items
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

			// Log summary
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

	jobs.set('incremental-sync-sweep', {
		name: 'incremental-sync-sweep',
		cron: incrementalSyncJob
	});

	// Full reconciliation - runs daily at 3 AM
	// Complete sync with deletion of removed items, full discovery and enqueue
	// Only processes healthy connectors
	const fullReconciliationJob = new Cron(
		'0 3 * * *', // Daily at 3:00 AM
		{
			name: 'full-reconciliation',
			protect: true, // Prevent overlapping executions
			catch: (err) => {
				logger.error('Full reconciliation failed', { error: err instanceof Error ? err.message : String(err) });
			}
		},
		withJobContext('full-reconciliation', async () => {
			const startTime = Date.now();
			// Only process healthy connectors
			const connectors = await getHealthyConnectors();

			// Log any unhealthy connectors being skipped
			await logSkippedUnhealthyConnectors(connectors);

			if (connectors.length === 0) {
				return; // No healthy connectors to process
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
					// 1. Run full reconciliation
					const reconcileResult = await runFullReconciliation(connector);
					if (reconcileResult.success) {
						summary.totalCreated += reconcileResult.itemsCreated;
						summary.totalUpdated += reconcileResult.itemsUpdated;
						summary.totalDeleted += reconcileResult.itemsDeleted;
					} else {
						summary.reconciliationErrors++;
						logger.warn('Reconciliation failed for connector', {
							connectorId: connector.id,
							name: connector.name,
							error: reconcileResult.error
						});
						continue; // Skip discovery/enqueue for failed reconciliation
					}

					// 2. Run discovery (gaps and upgrades)
					const [gapsResult, upgradesResult] = await Promise.all([
						discoverGaps(connector.id),
						discoverUpgrades(connector.id)
					]);

					if (gapsResult.success) {
						summary.totalGapsFound += gapsResult.registriesCreated;
						// Record analytics for gap discovery
						await analyticsCollector.recordGapDiscovery(connector.id, gapsResult);
					}
					if (upgradesResult.success) {
						summary.totalUpgradesFound += upgradesResult.registriesCreated;
						// Record analytics for upgrade discovery
						await analyticsCollector.recordUpgradeDiscovery(connector.id, upgradesResult);
					}

					// 3. Enqueue pending items
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

			// Log summary
			const durationMs = Date.now() - startTime;
			logger.info('Full reconciliation completed', {
				...summary,
				durationMs
			});
		})
	);

	jobs.set('full-reconciliation', {
		name: 'full-reconciliation',
		cron: fullReconciliationJob
	});

	// =========================================================================
	// Completion Snapshot Job
	// =========================================================================

	// Completion snapshot capture - runs daily at 4 AM (after full reconciliation at 3 AM)
	// Captures library completion stats for trend visualization (sparklines)
	const completionSnapshotJob = new Cron(
		'0 4 * * *', // Daily at 4:00 AM
		{
			name: 'completion-snapshot',
			protect: true, // Prevent overlapping executions
			catch: (err) => {
				logger.error('Completion snapshot failed', { error: err instanceof Error ? err.message : String(err) });
			}
		},
		withJobContext('completion-snapshot', async () => {
			const { captureCompletionSnapshots, cleanupOldSnapshots } = await import(
				'$lib/server/db/queries/completion'
			);

			// Capture current state
			const captured = await captureCompletionSnapshots();

			// Clean up old snapshots (keep 30 days)
			const cleaned = await cleanupOldSnapshots(30);

			if (captured > 0 || cleaned > 0) {
				logger.info('Completion snapshot', {
					snapshotsCaptured: captured,
					oldSnapshotsCleaned: cleaned
				});
			}
		})
	);

	jobs.set('completion-snapshot', {
		name: 'completion-snapshot',
		cron: completionSnapshotJob
	});

	// =========================================================================
	// Database Maintenance Job
	// =========================================================================

	// Database maintenance - runs daily at 4:30 AM (after completion snapshot at 4:00 AM)
	// Executes VACUUM/ANALYZE and orphan cleanup for optimal database performance
	const dbMaintenanceJob = new Cron(
		'30 4 * * *', // Daily at 4:30 AM
		{
			name: 'db-maintenance',
			protect: true, // Prevent overlapping executions
			catch: (err) => {
				logger.error('Database maintenance failed', { error: err instanceof Error ? err.message : String(err) });
			}
		},
		withJobContext('db-maintenance', async () => {
			// 1. Run VACUUM and ANALYZE
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

			// 2. Run orphan cleanup
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

			// 3. Run history pruning
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
		})
	);

	jobs.set('db-maintenance', {
		name: 'db-maintenance',
		cron: dbMaintenanceJob
	});

	// Queue processor - runs every minute
	// Re-enqueues cooldown items, dequeues and dispatches searches
	// Only processes healthy connectors
	const queueProcessorJob = new Cron(
		'* * * * *', // Every minute
		{
			name: 'queue-processor',
			protect: true, // Prevent overlapping executions
			catch: (err) => {
				logger.error('Queue processor failed', { error: err instanceof Error ? err.message : String(err) });
			}
		},
		withJobContext('queue-processor', async () => {
			const startTime = Date.now();

			// 1. Re-enqueue eligible cooldown items (items whose cooldown has expired)
			const reenqueueResult = await reenqueueEligibleCooldownItems();

			const summary = {
				reenqueued: reenqueueResult.success ? reenqueueResult.itemsReenqueued : 0,
				dispatched: 0,
				succeeded: 0,
				failed: 0,
				rateLimited: 0
			};

			// 2. Process queue for each healthy connector
			const connectors = await getHealthyConnectors();

			for (const connector of connectors) {
				try {
					// Dequeue items for this connector (limit to 5 per minute per connector)
					const dequeueResult = await dequeuePriorityItems(connector.id, { limit: 5 });

					if (!dequeueResult.success || dequeueResult.items.length === 0) {
						continue;
					}

					// Dispatch each dequeued item
					for (const item of dequeueResult.items) {
						summary.dispatched++;

						// Build dispatch options based on content type
						const dispatchOptions =
							item.contentType === 'movie'
								? { movieIds: [item.contentId] }
								: { episodeIds: [item.contentId] };

						// Track response time for analytics
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
							summary.succeeded++;
							// Record successful dispatch analytics
							await analyticsCollector.recordSearchDispatched(
								item.connectorId,
								item.searchRegistryId,
								item.contentType,
								item.searchType,
								dispatchResult.commandId!,
								responseTimeMs
							);
						} else {
							summary.failed++;

							// Mark the search as failed with appropriate category
							const failureCategory: FailureCategory = dispatchResult.rateLimited
								? 'rate_limited'
								: dispatchResult.error?.includes('timeout')
									? 'timeout'
									: dispatchResult.error?.includes('network')
										? 'network_error'
										: 'server_error';

							// Record failed dispatch analytics
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
								summary.rateLimited++;
								// Stop processing this connector if rate limited
								break;
							}

							await markSearchFailed({
								searchRegistryId: item.searchRegistryId,
								failureCategory
							});
						}
					}
				} catch (error) {
					logger.error('Error processing queue for connector', {
						connectorId: connector.id,
						name: connector.name,
						error: error instanceof Error ? error.message : String(error)
					});
				}
			}

			// Log summary only if there was activity
			const durationMs = Date.now() - startTime;
			if (
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

	jobs.set('queue-processor', {
		name: 'queue-processor',
		cron: queueProcessorJob
	});

	// =========================================================================
	// Notification Batch Processor
	// =========================================================================

	// Notification batch processor - runs every minute
	// Processes pending batched notifications and sends digest notifications
	const notificationBatchJob = new Cron(
		'* * * * *', // Every minute
		{
			name: 'notification-batch-processor',
			protect: true, // Prevent overlapping executions
			catch: (err) => {
				logger.error('Notification batch processing failed', { error: err instanceof Error ? err.message : String(err) });
			}
		},
		withJobContext('notification-batch-processor', async () => {
			const { processBatches } = await import('$lib/server/services/notifications/batcher');

			const result = await processBatches();

			// Only log if there was activity
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

	jobs.set('notification-batch-processor', {
		name: 'notification-batch-processor',
		cron: notificationBatchJob
	});

	// =========================================================================
	// Analytics Jobs
	// =========================================================================

	// Queue depth sampler - runs every 5 minutes
	// Samples queue depth for analytics tracking
	const queueDepthSamplerJob = new Cron(
		'*/5 * * * *', // Every 5 minutes
		{
			name: 'queue-depth-sampler',
			protect: true, // Prevent overlapping executions
			catch: (err) => {
				logger.error('Queue depth sampling failed', { error: err instanceof Error ? err.message : String(err) });
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

	jobs.set('queue-depth-sampler', {
		name: 'queue-depth-sampler',
		cron: queueDepthSamplerJob
	});

	// Hourly stats aggregation - runs at minute 5 of every hour
	// Aggregates raw events into hourly statistics
	const hourlyAggregationJob = new Cron(
		'5 * * * *', // 5 minutes past every hour
		{
			name: 'analytics-hourly-aggregation',
			protect: true, // Prevent overlapping executions
			catch: (err) => {
				logger.error('Hourly analytics aggregation failed', { error: err instanceof Error ? err.message : String(err) });
			}
		},
		withJobContext('analytics-hourly-aggregation', async () => {
			// Aggregate the previous hour
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

	jobs.set('analytics-hourly-aggregation', {
		name: 'analytics-hourly-aggregation',
		cron: hourlyAggregationJob
	});

	// Daily stats aggregation - runs at 1:00 AM
	// Aggregates hourly stats into daily statistics and cleans up old events
	const dailyAggregationJob = new Cron(
		'0 1 * * *', // 1:00 AM daily
		{
			name: 'analytics-daily-aggregation',
			protect: true, // Prevent overlapping executions
			catch: (err) => {
				logger.error('Daily analytics aggregation failed', { error: err instanceof Error ? err.message : String(err) });
			}
		},
		withJobContext('analytics-daily-aggregation', async () => {
			// Aggregate the previous day
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

			// Cleanup old raw events (keep 7 days)
			const eventsDeleted = await cleanupOldEvents(7);
			if (eventsDeleted > 0) {
				logger.info('Old analytics events cleaned up', { eventsDeleted });
			}
		})
	);

	jobs.set('analytics-daily-aggregation', {
		name: 'analytics-daily-aggregation',
		cron: dailyAggregationJob
	});

	// =========================================================================
	// Scheduled Backup Job
	// =========================================================================

	// Initialize scheduled backup job from settings
	// This is done asynchronously to avoid blocking initialization
	initializeScheduledBackup().catch((err) => {
		logger.error('Failed to initialize scheduled backup', { error: err instanceof Error ? err.message : String(err) });
	});

	initialized = true;
	logger.info('Scheduled jobs initialized', { jobs: Array.from(jobs.keys()) });
}

/**
 * Stop all scheduled jobs.
 * Used for graceful shutdown.
 */
export function stopScheduler(): void {
	logger.info('Stopping all scheduled jobs');

	// Stop static jobs
	for (const [name, job] of jobs) {
		job.cron.stop();
		logger.info('Stopped job', { name });
	}
	jobs.clear();

	// Stop dynamic jobs
	for (const [id, cron] of dynamicJobs) {
		cron.stop();
		logger.info('Stopped dynamic schedule', { id });
	}
	dynamicJobs.clear();

	// Stop scheduled backup job
	if (scheduledBackupJob) {
		scheduledBackupJob.stop();
		scheduledBackupJob = null;
		logger.info('Stopped scheduled backup job');
	}

	initialized = false;
	logger.info('All scheduled jobs stopped');
}

/**
 * Get the status of all scheduled jobs.
 * Useful for health checks and debugging.
 */
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
	return {
		initialized,
		jobs: Array.from(jobs.values()).map((job) => ({
			name: job.name,
			isRunning: job.cron.isBusy(),
			nextRun: job.cron.nextRun()
		})),
		dynamicSchedules: Array.from(dynamicJobs.entries()).map(([id, cron]) => ({
			id,
			isRunning: cron.isBusy(),
			nextRun: cron.nextRun()
		})),
		scheduledBackup: scheduledBackupJob
			? {
					enabled: true,
					isRunning: scheduledBackupJob.isBusy(),
					nextRun: scheduledBackupJob.nextRun()
				}
			: null
	};
}

// =============================================================================
// Dynamic Schedule Management
// =============================================================================

/**
 * Refresh dynamic schedules from the database.
 * Called when schedules are created, updated, or toggled.
 *
 * This function:
 * 1. Stops all existing dynamic schedule jobs
 * 2. Loads enabled schedules from database
 * 3. Creates new Cron jobs for each enabled schedule
 * 4. Updates nextRunAt for each schedule in the database
 */
export async function refreshDynamicSchedules(): Promise<void> {
	logger.info('Refreshing dynamic schedules');

	// Stop all existing dynamic jobs
	for (const [id, cron] of dynamicJobs) {
		cron.stop();
	}
	dynamicJobs.clear();

	// Load enabled schedules from database
	const schedules = await getEnabledSchedules();

	for (const schedule of schedules) {
		try {
			// Create Cron job for this schedule
			const cron = new Cron(
				schedule.cronExpression,
				{
					name: `sweep-schedule-${schedule.id}`,
					timezone: schedule.timezone,
					protect: true, // Prevent overlapping executions
					catch: (err) => {
						logger.error('Dynamic schedule failed', { scheduleId: schedule.id, scheduleName: schedule.name, error: err instanceof Error ? err.message : String(err) });
					}
				},
				withJobContext(`sweep-schedule-${schedule.id}`, async () => {
					// Job execution will be implemented in a future task
					// For now, just log that it would run
					logger.info('Dynamic schedule triggered', { scheduleName: schedule.name, scheduleId: schedule.id });
				})
			);

			dynamicJobs.set(schedule.id, cron);

			// Update nextRunAt in database
			const nextRun = cron.nextRun();
			if (nextRun) {
				await updateNextRunAt(schedule.id, nextRun);
			}
		} catch (error) {
			logger.error('Failed to create job for schedule', { scheduleId: schedule.id, error: error instanceof Error ? error.message : String(error) });
		}
	}

	logger.info('Loaded dynamic schedules', { count: dynamicJobs.size });
}

// =============================================================================
// Scheduled Backup Management
// =============================================================================

/**
 * Initialize the scheduled backup job from database settings.
 * Called during scheduler initialization.
 */
async function initializeScheduledBackup(): Promise<void> {
	try {
		const settings = await getBackupSettings();

		if (!settings.scheduledEnabled) {
			logger.info('Scheduled backups are disabled');
			return;
		}

		await createScheduledBackupJob(settings.scheduledCron, settings.retentionCount);
	} catch (error) {
		logger.error('Failed to initialize scheduled backup', { error: error instanceof Error ? error.message : String(error) });
	}
}

/**
 * Creates the scheduled backup cron job.
 *
 * @param cronExpression - Cron expression for backup schedule
 * @param retentionCount - Number of scheduled backups to retain
 */
async function createScheduledBackupJob(
	cronExpression: string,
	retentionCount: number
): Promise<void> {
	// Stop existing job if any
	if (scheduledBackupJob) {
		scheduledBackupJob.stop();
		scheduledBackupJob = null;
	}

	try {
		scheduledBackupJob = new Cron(
			cronExpression,
			{
				name: 'scheduled-backup',
				protect: true, // Prevent overlapping executions
				catch: (err) => {
					logger.error('Scheduled backup failed', { error: err instanceof Error ? err.message : String(err) });
				}
			},
			withJobContext('scheduled-backup', async () => {
				const startTime = Date.now();
				logger.info('Starting scheduled backup');

				// Create the backup
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

					// Clean up old scheduled backups
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

		const nextRun = scheduledBackupJob.nextRun();
		logger.info('Scheduled backup job created', {
			cronExpression,
			retentionCount,
			nextRun: nextRun?.toISOString()
		});
	} catch (error) {
		logger.error('Failed to create scheduled backup job', { error: error instanceof Error ? error.message : String(error) });
		scheduledBackupJob = null;
	}
}

/**
 * Refresh the scheduled backup job from database settings.
 * Called when backup settings are updated.
 */
export async function refreshScheduledBackup(): Promise<void> {
	logger.info('Refreshing scheduled backup configuration');

	try {
		const settings = await getBackupSettings();

		if (!settings.scheduledEnabled) {
			// Disable scheduled backups
			if (scheduledBackupJob) {
				scheduledBackupJob.stop();
				scheduledBackupJob = null;
				logger.info('Scheduled backups disabled');
			}
			return;
		}

		// Create or recreate the job with new settings
		await createScheduledBackupJob(settings.scheduledCron, settings.retentionCount);
	} catch (error) {
		logger.error('Failed to refresh scheduled backup', { error: error instanceof Error ? error.message : String(error) });
	}
}
