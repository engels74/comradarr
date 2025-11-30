/**
 * Sync service configuration constants.
 *
 * Defines thresholds for health status updates and retry behavior
 * for sync operations.
 *
 * @module services/sync/config
 * @requirements 2.6
 */

/**
 * Sync failure handling configuration.
 *
 * These constants control:
 * - When a connector is marked degraded/unhealthy
 * - How sync-level retries are performed (separate from HTTP-level retries)
 * - Backoff delays between retry attempts
 */
export const SYNC_CONFIG = {
	/**
	 * Number of consecutive failures before marking connector as unhealthy.
	 * Auth errors immediately mark unhealthy regardless of count.
	 */
	UNHEALTHY_THRESHOLD: 5,

	/**
	 * Number of consecutive failures before marking connector as degraded.
	 * First failure(s) result in degraded status.
	 */
	DEGRADED_THRESHOLD: 2,

	/**
	 * Maximum number of retries for entire sync operation.
	 * This is separate from HTTP-level retries which handle individual requests.
	 */
	MAX_SYNC_RETRIES: 3,

	/**
	 * Base delay for sync-level backoff in milliseconds.
	 * Actual delay = baseDelay * (multiplier ^ attemptNumber)
	 */
	SYNC_RETRY_BASE_DELAY: 30_000, // 30 seconds

	/**
	 * Maximum delay for sync-level backoff in milliseconds.
	 * Prevents unbounded growth of backoff delays.
	 */
	SYNC_RETRY_MAX_DELAY: 300_000, // 5 minutes

	/**
	 * Multiplier for exponential backoff calculation.
	 * delay(n) = baseDelay * (multiplier ^ n), capped at maxDelay
	 */
	SYNC_RETRY_MULTIPLIER: 2
} as const;

/** Type for the sync configuration */
export type SyncConfig = typeof SYNC_CONFIG;
