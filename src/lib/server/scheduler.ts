/**
 * Scheduler module for background jobs.
 *
 * Uses Croner for cron-based scheduling with:
 * - `protect: true` to prevent overlapping executions
 * - Error handling that logs but doesn't crash the server
 *
 * Requirements: 7.4 - Reset counters at configured intervals
 * Requirements: 38.2 - Periodic Prowlarr health checks
 *
 * Jobs:
 * - throttle-window-reset: Runs every minute to reset expired throttle windows
 * - prowlarr-health-check: Runs every 5 minutes to check Prowlarr indexer health
 */

import { Cron } from 'croner';
import { throttleEnforcer } from '$lib/server/services/throttle';
import { prowlarrHealthMonitor } from '$lib/server/services/prowlarr';

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
