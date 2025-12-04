/**
 * Scheduler module for background jobs.
 *
 * Uses Croner for cron-based scheduling with:
 * - `protect: true` to prevent overlapping executions
 * - Error handling that logs but doesn't crash the server
 *
 * Requirements:
 * - 1.4: Connector health checks
 * - 1.5: Skip sweep cycles for unhealthy connectors
 * - 7.4: Reset counters at configured intervals
 * - 8.1: Execute sweeps at specified cron intervals
 * - 8.2: Run discovery for configured search types
 * - 8.4: Log summary of discoveries and items queued
 * - 12.1: Track analytics (gap discovery, search volume, queue depth)
 * - 15.4: Capture completion snapshots for trend visualization
 * - 38.2: Periodic Prowlarr health checks
 *
 * Jobs:
 * - throttle-window-reset: Every minute - resets expired throttle windows
 * - prowlarr-health-check: Every 5 minutes - checks Prowlarr indexer health
 * - connector-health-check: Every 5 minutes - checks *arr connector health
 * - incremental-sync-sweep: Every 15 minutes - syncs content, discovers gaps/upgrades, enqueues items
 * - full-reconciliation: Daily at 3 AM - complete sync with deletion of removed items
 * - completion-snapshot: Daily at 4 AM - captures library completion stats for trend sparklines
 * - queue-processor: Every minute - re-enqueues cooldown items, dispatches searches
 * - queue-depth-sampler: Every 5 minutes - samples queue depth for analytics
 * - analytics-hourly-aggregation: 5 min past each hour - aggregates raw events to hourly stats
 * - analytics-daily-aggregation: Daily at 1 AM - aggregates hourly to daily stats, cleans old events
 */

import { Cron } from 'croner';
import { throttleEnforcer } from '$lib/server/services/throttle';
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

/** Flag to prevent multiple initializations */
let initialized = false;

// =============================================================================
// Internal Helpers
// =============================================================================

/**
 * Logs connectors that are being skipped due to unhealthy status.
 * Used by sweep cycle jobs to inform about excluded connectors (Requirement 1.5).
 *
 * @param healthyConnectors - Connectors that will be processed
 */
async function logSkippedUnhealthyConnectors(healthyConnectors: Connector[]): Promise<void> {
	const allEnabled = await getEnabledConnectors();
	const skipped = allEnabled.filter((c) => !healthyConnectors.some((hc) => hc.id === c.id));

	if (skipped.length > 0) {
		console.log(
			'[scheduler] Skipping unhealthy connectors:',
			skipped.map((c) => ({ id: c.id, name: c.name, healthStatus: c.healthStatus }))
		);
	}
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
		console.log('[scheduler] Already initialized, skipping');
		return;
	}

	console.log('[scheduler] Initializing scheduled jobs...');

	// Throttle window reset - runs every minute
	// Resets expired per-minute counters, daily counters, and clears expired pauses
	const throttleResetJob = new Cron(
		'* * * * *', // Every minute
		{
			name: 'throttle-window-reset',
			protect: true, // Prevent overlapping executions
			catch: (err) => {
				console.error('[scheduler] Throttle window reset failed:', err);
			}
		},
		async () => {
			const result = await throttleEnforcer.resetExpiredWindows();

			// Only log if resets occurred (reduce log noise)
			if (result.minuteResets > 0 || result.dayResets > 0 || result.pausesCleared > 0) {
				console.log('[scheduler] Throttle windows reset:', {
					minuteResets: result.minuteResets,
					dayResets: result.dayResets,
					pausesCleared: result.pausesCleared
				});
			}
		}
	);

	jobs.set('throttle-window-reset', {
		name: 'throttle-window-reset',
		cron: throttleResetJob
	});

	// Prowlarr health check - runs every 5 minutes
	// Checks indexer health status from Prowlarr and caches results (Req 38.2)
	const prowlarrHealthJob = new Cron(
		'*/5 * * * *', // Every 5 minutes
		{
			name: 'prowlarr-health-check',
			protect: true, // Prevent overlapping executions
			catch: (err) => {
				console.error('[scheduler] Prowlarr health check failed:', err);
			}
		},
		async () => {
			const results = await prowlarrHealthMonitor.checkAllInstances();

			// Only log if there are instances to check
			if (results.length > 0) {
				const unhealthy = results.filter((r) => r.status !== 'healthy');
				if (unhealthy.length > 0) {
					console.log('[scheduler] Prowlarr health issues detected:', {
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
		}
	);

	jobs.set('prowlarr-health-check', {
		name: 'prowlarr-health-check',
		cron: prowlarrHealthJob
	});

	// Connector health check - runs every 5 minutes
	// Checks *arr connector health status and updates database (Req 1.4)
	const connectorHealthJob = new Cron(
		'*/5 * * * *', // Every 5 minutes
		{
			name: 'connector-health-check',
			protect: true, // Prevent overlapping executions
			catch: (err) => {
				console.error('[scheduler] Connector health check failed:', err);
			}
		},
		async () => {
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
				console.log('[scheduler] Connector health status changes:', results);
			}
		}
	);

	jobs.set('connector-health-check', {
		name: 'connector-health-check',
		cron: connectorHealthJob
	});

	// =========================================================================
	// Sweep Cycle Jobs (Requirements 8.1, 8.2, 8.4)
	// =========================================================================

	// Incremental sync sweep - runs every 15 minutes
	// Syncs content from *arr apps, discovers gaps/upgrades, enqueues items
	// Only processes healthy connectors (Requirement 1.5)
	const incrementalSyncJob = new Cron(
		'*/15 * * * *', // Every 15 minutes
		{
			name: 'incremental-sync-sweep',
			protect: true, // Prevent overlapping executions
			catch: (err) => {
				console.error('[scheduler] Incremental sync sweep failed:', err);
			}
		},
		async () => {
			const startTime = Date.now();
			// Only process healthy connectors (Requirement 1.5)
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
						console.warn('[scheduler] Sync failed for connector:', {
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
						// Record analytics for gap discovery (Requirement 12.1)
						await analyticsCollector.recordGapDiscovery(connector.id, gapsResult);
					}
					if (upgradesResult.success) {
						summary.totalUpgradesFound += upgradesResult.registriesCreated;
						// Record analytics for upgrade discovery (Requirement 12.1)
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
					console.error('[scheduler] Error processing connector:', {
						connectorId: connector.id,
						name: connector.name,
						error: error instanceof Error ? error.message : String(error)
					});
				}
			}

			// Log summary (Requirement 8.4)
			const durationMs = Date.now() - startTime;
			if (
				summary.totalItemsSynced > 0 ||
				summary.totalGapsFound > 0 ||
				summary.totalUpgradesFound > 0 ||
				summary.totalItemsEnqueued > 0 ||
				summary.syncErrors > 0
			) {
				console.log('[scheduler] Incremental sync sweep completed:', {
					...summary,
					durationMs
				});
			}
		}
	);

	jobs.set('incremental-sync-sweep', {
		name: 'incremental-sync-sweep',
		cron: incrementalSyncJob
	});

	// Full reconciliation - runs daily at 3 AM
	// Complete sync with deletion of removed items, full discovery and enqueue
	// Only processes healthy connectors (Requirement 1.5)
	const fullReconciliationJob = new Cron(
		'0 3 * * *', // Daily at 3:00 AM
		{
			name: 'full-reconciliation',
			protect: true, // Prevent overlapping executions
			catch: (err) => {
				console.error('[scheduler] Full reconciliation failed:', err);
			}
		},
		async () => {
			const startTime = Date.now();
			// Only process healthy connectors (Requirement 1.5)
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
						console.warn('[scheduler] Reconciliation failed for connector:', {
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
						// Record analytics for gap discovery (Requirement 12.1)
						await analyticsCollector.recordGapDiscovery(connector.id, gapsResult);
					}
					if (upgradesResult.success) {
						summary.totalUpgradesFound += upgradesResult.registriesCreated;
						// Record analytics for upgrade discovery (Requirement 12.1)
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
					console.error('[scheduler] Error during reconciliation:', {
						connectorId: connector.id,
						name: connector.name,
						error: error instanceof Error ? error.message : String(error)
					});
				}
			}

			// Log summary (Requirement 8.4)
			const durationMs = Date.now() - startTime;
			console.log('[scheduler] Full reconciliation completed:', {
				...summary,
				durationMs
			});
		}
	);

	jobs.set('full-reconciliation', {
		name: 'full-reconciliation',
		cron: fullReconciliationJob
	});

	// =========================================================================
	// Completion Snapshot Job (Requirement 15.4)
	// =========================================================================

	// Completion snapshot capture - runs daily at 4 AM (after full reconciliation at 3 AM)
	// Captures library completion stats for trend visualization (sparklines)
	const completionSnapshotJob = new Cron(
		'0 4 * * *', // Daily at 4:00 AM
		{
			name: 'completion-snapshot',
			protect: true, // Prevent overlapping executions
			catch: (err) => {
				console.error('[scheduler] Completion snapshot failed:', err);
			}
		},
		async () => {
			const { captureCompletionSnapshots, cleanupOldSnapshots } = await import(
				'$lib/server/db/queries/completion'
			);

			// Capture current state
			const captured = await captureCompletionSnapshots();

			// Clean up old snapshots (keep 30 days)
			const cleaned = await cleanupOldSnapshots(30);

			if (captured > 0 || cleaned > 0) {
				console.log('[scheduler] Completion snapshot:', {
					snapshotsCaptured: captured,
					oldSnapshotsCleaned: cleaned
				});
			}
		}
	);

	jobs.set('completion-snapshot', {
		name: 'completion-snapshot',
		cron: completionSnapshotJob
	});

	// Queue processor - runs every minute
	// Re-enqueues cooldown items, dequeues and dispatches searches
	// Only processes healthy connectors (Requirement 1.5)
	const queueProcessorJob = new Cron(
		'* * * * *', // Every minute
		{
			name: 'queue-processor',
			protect: true, // Prevent overlapping executions
			catch: (err) => {
				console.error('[scheduler] Queue processor failed:', err);
			}
		},
		async () => {
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

			// 2. Process queue for each healthy connector (Requirement 1.5)
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

						// Track response time for analytics (Requirement 12.1)
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
							// Record successful dispatch analytics (Requirement 12.1)
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

							// Record failed dispatch analytics (Requirement 12.1)
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
					console.error('[scheduler] Error processing queue for connector:', {
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
				console.log('[scheduler] Queue processor completed:', {
					...summary,
					durationMs
				});
			}
		}
	);

	jobs.set('queue-processor', {
		name: 'queue-processor',
		cron: queueProcessorJob
	});

	// =========================================================================
	// Notification Batch Processor (Requirement 9.3)
	// =========================================================================

	// Notification batch processor - runs every minute
	// Processes pending batched notifications and sends digest notifications
	const notificationBatchJob = new Cron(
		'* * * * *', // Every minute
		{
			name: 'notification-batch-processor',
			protect: true, // Prevent overlapping executions
			catch: (err) => {
				console.error('[scheduler] Notification batch processing failed:', err);
			}
		},
		async () => {
			const { processBatches } = await import('$lib/server/services/notifications/batcher');

			const result = await processBatches();

			// Only log if there was activity
			if (result.batchesSent > 0 || result.errors > 0) {
				console.log('[scheduler] Notification batches processed:', {
					channelsProcessed: result.channelsProcessed,
					batchesSent: result.batchesSent,
					notificationsBatched: result.notificationsBatched,
					errors: result.errors
				});
			}
		}
	);

	jobs.set('notification-batch-processor', {
		name: 'notification-batch-processor',
		cron: notificationBatchJob
	});

	// =========================================================================
	// Analytics Jobs (Requirement 12.1)
	// =========================================================================

	// Queue depth sampler - runs every 5 minutes
	// Samples queue depth for analytics tracking
	const queueDepthSamplerJob = new Cron(
		'*/5 * * * *', // Every 5 minutes
		{
			name: 'queue-depth-sampler',
			protect: true, // Prevent overlapping executions
			catch: (err) => {
				console.error('[scheduler] Queue depth sampling failed:', err);
			}
		},
		async () => {
			const samples = await analyticsCollector.sampleQueueDepth();

			if (samples.length > 0) {
				const totalDepth = samples.reduce((sum, s) => sum + s.queueDepth, 0);
				console.log('[scheduler] Queue depth sampled:', {
					connectors: samples.length,
					totalQueueDepth: totalDepth
				});
			}
		}
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
				console.error('[scheduler] Hourly analytics aggregation failed:', err);
			}
		},
		async () => {
			// Aggregate the previous hour
			const previousHour = new Date();
			previousHour.setHours(previousHour.getHours() - 1);
			previousHour.setMinutes(0, 0, 0);

			const result = await aggregateHourlyStats(previousHour);

			if (result.success && result.hourlyStatsUpdated > 0) {
				console.log('[scheduler] Hourly analytics aggregated:', {
					hour: previousHour.toISOString(),
					statsUpdated: result.hourlyStatsUpdated,
					eventsProcessed: result.eventsProcessed,
					durationMs: result.durationMs
				});
			}
		}
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
				console.error('[scheduler] Daily analytics aggregation failed:', err);
			}
		},
		async () => {
			// Aggregate the previous day
			const previousDay = new Date();
			previousDay.setDate(previousDay.getDate() - 1);
			previousDay.setHours(0, 0, 0, 0);

			const result = await aggregateDailyStats(previousDay);

			if (result.success) {
				console.log('[scheduler] Daily analytics aggregated:', {
					date: previousDay.toISOString().split('T')[0],
					statsUpdated: result.dailyStatsUpdated,
					durationMs: result.durationMs
				});
			}

			// Cleanup old raw events (keep 7 days)
			const eventsDeleted = await cleanupOldEvents(7);
			if (eventsDeleted > 0) {
				console.log('[scheduler] Old analytics events cleaned up:', eventsDeleted);
			}
		}
	);

	jobs.set('analytics-daily-aggregation', {
		name: 'analytics-daily-aggregation',
		cron: dailyAggregationJob
	});

	initialized = true;
	console.log('[scheduler] Scheduled jobs initialized:', Array.from(jobs.keys()));
}

/**
 * Stop all scheduled jobs.
 * Used for graceful shutdown.
 */
export function stopScheduler(): void {
	console.log('[scheduler] Stopping all scheduled jobs...');

	// Stop static jobs
	for (const [name, job] of jobs) {
		job.cron.stop();
		console.log(`[scheduler] Stopped job: ${name}`);
	}
	jobs.clear();

	// Stop dynamic jobs
	for (const [id, cron] of dynamicJobs) {
		cron.stop();
		console.log(`[scheduler] Stopped dynamic schedule: ${id}`);
	}
	dynamicJobs.clear();

	initialized = false;
	console.log('[scheduler] All scheduled jobs stopped');
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
} {
	return {
		initialized,
		jobs: Array.from(jobs.values()).map((job) => ({
			name: job.name,
			isRunning: job.cron.isRunning(),
			nextRun: job.cron.nextRun()
		})),
		dynamicSchedules: Array.from(dynamicJobs.entries()).map(([id, cron]) => ({
			id,
			isRunning: cron.isRunning(),
			nextRun: cron.nextRun()
		}))
	};
}

// =============================================================================
// Dynamic Schedule Management (Requirement 19.1)
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
	console.log('[scheduler] Refreshing dynamic schedules...');

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
						console.error(`[scheduler] Dynamic schedule ${schedule.id} (${schedule.name}) failed:`, err);
					}
				},
				async () => {
					// Job execution will be implemented in a future task
					// For now, just log that it would run
					console.log(`[scheduler] Dynamic schedule triggered: ${schedule.name} (ID: ${schedule.id})`);
				}
			);

			dynamicJobs.set(schedule.id, cron);

			// Update nextRunAt in database
			const nextRun = cron.nextRun();
			if (nextRun) {
				await updateNextRunAt(schedule.id, nextRun);
			}
		} catch (error) {
			console.error(`[scheduler] Failed to create job for schedule ${schedule.id}:`, error);
		}
	}

	console.log(`[scheduler] Loaded ${dynamicJobs.size} dynamic schedules`);
}
