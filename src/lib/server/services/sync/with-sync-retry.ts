// Sync-level retries (entire operation) vs HTTP-level retries (individual requests)

import { getSyncState } from '$lib/server/db/queries/connectors';
import { createLogger } from '$lib/server/logger';
import { SYNC_CONFIG } from './config';
import {
	calculateSyncBackoffDelay,
	type HealthStatus,
	shouldRetrySync,
	updateHealthFromSyncResult
} from './health';

const logger = createLogger('sync-retry');

export interface SyncRetryOptions {
	/** Override the default max retries (default: SYNC_CONFIG.MAX_SYNC_RETRIES) */
	maxRetries?: number;
}

export interface SyncAttemptResult<T> {
	/** Whether the sync ultimately succeeded */
	success: boolean;
	/** The result data if successful */
	data?: T;
	/** The error if failed (after all retries exhausted) */
	error?: unknown;
	/** Number of attempts made (1 = first try succeeded, >1 = retries were needed) */
	attempts: number;
	/** The final health status after all attempts */
	finalHealthStatus: HealthStatus;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withSyncRetry<T>(
	connectorId: number,
	syncFn: () => Promise<T>,
	options?: SyncRetryOptions
): Promise<SyncAttemptResult<T>> {
	const maxRetries = options?.maxRetries ?? SYNC_CONFIG.MAX_SYNC_RETRIES;
	let lastError: unknown;
	let attempts = 0;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		attempts = attempt + 1;

		if (attempt > 0) {
			logger.debug('Sync retry attempt', {
				connectorId,
				attempt: attempts,
				maxAttempts: maxRetries + 1
			});
		}

		try {
			const result = await syncFn();

			// Success - update health to healthy
			// Note: The sync state (consecutiveFailures) is reset in the sync functions
			// via updateSyncState(connectorId, true)
			const finalHealthStatus = await updateHealthFromSyncResult(
				connectorId,
				true,
				0 // Success resets consecutive failures
			);

			if (attempt > 0) {
				logger.info('Sync succeeded after retry', {
					connectorId,
					attempts
				});
			}

			return {
				success: true,
				data: result,
				attempts,
				finalHealthStatus
			};
		} catch (error) {
			lastError = error;

			// Check if we should retry
			if (!shouldRetrySync(error, attempt)) {
				logger.debug('Sync error not retryable', {
					connectorId,
					attempt: attempts,
					error: error instanceof Error ? error.message : String(error)
				});
				break;
			}

			// Wait before next attempt (except on last iteration)
			if (attempt < maxRetries) {
				const delay = calculateSyncBackoffDelay(attempt);
				logger.debug('Waiting before sync retry', {
					connectorId,
					delayMs: delay,
					nextAttempt: attempts + 1
				});
				await sleep(delay);
			}
		}
	}

	// All retries exhausted or non-retryable error
	// Get current consecutive failures and add 1 for this failure
	// Note: The actual increment happens in updateSyncState(connectorId, false)
	// called by the sync function, but we need the count for health status
	const currentSyncState = await getSyncState(connectorId);
	const consecutiveFailures = (currentSyncState?.consecutiveFailures ?? 0) + 1;

	const finalHealthStatus = await updateHealthFromSyncResult(
		connectorId,
		false,
		consecutiveFailures,
		lastError
	);

	logger.warn('Sync retries exhausted', {
		connectorId,
		attempts,
		finalHealthStatus,
		consecutiveFailures,
		error: lastError instanceof Error ? lastError.message : String(lastError)
	});

	return {
		success: false,
		error: lastError,
		attempts,
		finalHealthStatus
	};
}
