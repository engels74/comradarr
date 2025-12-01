/**
 * Scheduler module for background jobs.
 *
 * Uses Croner for cron-based scheduling with:
 * - `protect: true` to prevent overlapping executions
 * - Error handling that logs but doesn't crash the server
 *
 * Requirements:
 * - 7.4: Reset counters at configured intervals
 * - 8.1: Execute sweeps at specified cron intervals
 * - 8.2: Run discovery for configured search types
 * - 8.4: Log summary of discoveries and items queued
 * - 38.2: Periodic Prowlarr health checks
 *
 * Jobs:
 * - throttle-window-reset: Every minute - resets expired throttle windows
 * - prowlarr-health-check: Every 5 minutes - checks Prowlarr indexer health
 * - incremental-sync-sweep: Every 15 minutes - syncs content, discovers gaps/upgrades, enqueues items
 * - full-reconciliation: Daily at 3 AM - complete sync with deletion of removed items
 * - queue-processor: Every minute - re-enqueues cooldown items, dispatches searches
 */

import { Cron } from 'croner';
import { throttleEnforcer } from '$lib/server/services/throttle';
import { prowlarrHealthMonitor } from '$lib/server/services/prowlarr';
import { getEnabledConnectors } from '$lib/server/db/queries/connectors';
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

/** Map of registered jobs */
const jobs: Map<string, ScheduledJob> = new Map();

/** Flag to prevent multiple initializations */
let initialized = false;

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

	// =========================================================================
	// Sweep Cycle Jobs (Requirements 8.1, 8.2, 8.4)
	// =========================================================================

	// Incremental sync sweep - runs every 15 minutes
	// Syncs content from *arr apps, discovers gaps/upgrades, enqueues items
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
			const connectors = await getEnabledConnectors();

			if (connectors.length === 0) {
				return; // No connectors to process
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
					}
					if (upgradesResult.success) {
						summary.totalUpgradesFound += upgradesResult.registriesCreated;
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
			const connectors = await getEnabledConnectors();

			if (connectors.length === 0) {
				return; // No connectors to process
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
					}
					if (upgradesResult.success) {
						summary.totalUpgradesFound += upgradesResult.registriesCreated;
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

	// Queue processor - runs every minute
	// Re-enqueues cooldown items, dequeues and dispatches searches
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

			// 2. Process queue for each enabled connector
			const connectors = await getEnabledConnectors();

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

						const dispatchResult = await dispatchSearch(
							item.connectorId,
							item.searchRegistryId,
							item.contentType,
							item.searchType,
							dispatchOptions
						);

						if (dispatchResult.success) {
							summary.succeeded++;
						} else {
							summary.failed++;

							if (dispatchResult.rateLimited) {
								summary.rateLimited++;
								// Stop processing this connector if rate limited
								break;
							}

							// Mark the search as failed with appropriate category
							const failureCategory: FailureCategory = dispatchResult.rateLimited
								? 'rate_limited'
								: dispatchResult.error?.includes('timeout')
									? 'timeout'
									: dispatchResult.error?.includes('network')
										? 'network_error'
										: 'server_error';

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

	initialized = true;
	console.log('[scheduler] Scheduled jobs initialized:', Array.from(jobs.keys()));
}

/**
 * Stop all scheduled jobs.
 * Used for graceful shutdown.
 */
export function stopScheduler(): void {
	console.log('[scheduler] Stopping all scheduled jobs...');

	for (const [name, job] of jobs) {
		job.cron.stop();
		console.log(`[scheduler] Stopped job: ${name}`);
	}

	jobs.clear();
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
} {
	return {
		initialized,
		jobs: Array.from(jobs.values()).map((job) => ({
			name: job.name,
			isRunning: job.cron.isRunning(),
			nextRun: job.cron.nextRun()
		}))
	};
}
