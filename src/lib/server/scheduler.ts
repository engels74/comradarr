/**
 * Scheduler module for background jobs.
 *
 * Uses Croner for cron-based scheduling with:
 * - `protect: true` to prevent overlapping executions
 * - Error handling that logs but doesn't crash the server
 *
 * Requirements: 7.4 - Reset counters at configured intervals
 *
 * Jobs:
 * - throttle-window-reset: Runs every minute to reset expired throttle windows
 */

import { Cron } from 'croner';
import { throttleEnforcer } from '$lib/server/services/throttle';

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
