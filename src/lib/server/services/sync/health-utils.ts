// Pure functions with no database dependencies - safe for unit tests

import { AuthenticationError, isArrClientError } from '$lib/server/connectors/common/errors';
import { SYNC_CONFIG } from './config';

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'offline' | 'unknown';

export interface SyncFailureContext {
	connectorId: number;
	consecutiveFailures: number;
	error: unknown;
}

// AuthenticationError immediately marks as unhealthy (won't recover without config change)
export function determineHealthStatus(
	success: boolean,
	consecutiveFailures: number,
	error?: unknown
): HealthStatus {
	if (success) {
		return 'healthy';
	}

	// Authentication errors immediately mark as unhealthy
	// These won't recover without user intervention (fixing API key)
	if (error !== undefined && isArrClientError(error) && error instanceof AuthenticationError) {
		return 'unhealthy';
	}

	// Check consecutive failures against thresholds
	if (consecutiveFailures >= SYNC_CONFIG.UNHEALTHY_THRESHOLD) {
		return 'unhealthy';
	}

	// Any failure results in at least degraded status
	return 'degraded';
}

// Non-retryable errors: AuthenticationError (401), ValidationError, NotFoundError (404), SSLError
export function shouldRetrySync(error: unknown, attemptCount: number): boolean {
	// Don't retry if we've exceeded max attempts
	if (attemptCount >= SYNC_CONFIG.MAX_SYNC_RETRIES) {
		return false;
	}

	// Don't retry non-retryable errors (auth, validation, not found, SSL)
	if (error !== undefined && isArrClientError(error) && !error.retryable) {
		return false;
	}

	return true;
}

// Exponential backoff: delay = baseDelay * (multiplier ^ attempt), capped at maxDelay
export function calculateSyncBackoffDelay(attempt: number): number {
	const exponentialDelay =
		SYNC_CONFIG.SYNC_RETRY_BASE_DELAY * SYNC_CONFIG.SYNC_RETRY_MULTIPLIER ** attempt;

	return Math.min(exponentialDelay, SYNC_CONFIG.SYNC_RETRY_MAX_DELAY);
}

// 'error' type -> 'degraded'; 'warning'/'ok'/'notice' -> 'healthy'
export function determineHealthFromChecks(
	checks: Array<{ type: 'ok' | 'notice' | 'warning' | 'error' }>
): HealthStatus {
	const hasError = checks.some((c) => c.type === 'error');

	if (hasError) {
		return 'degraded';
	}

	return 'healthy';
}
