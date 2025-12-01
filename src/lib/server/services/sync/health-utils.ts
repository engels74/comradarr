/**
 * Pure utility functions for sync health status determination.
 *
 * This module contains only pure functions with no database dependencies,
 * allowing them to be imported in vitest unit tests without pulling in bun:sql.
 *
 * @module services/sync/health-utils
 * @requirements 2.6
 */

import {
	AuthenticationError,
	isArrClientError
} from '$lib/server/connectors/common/errors';
import { SYNC_CONFIG } from './config';

/**
 * Connector health status values.
 */
export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'offline' | 'unknown';

/**
 * Context information about a sync failure for logging/diagnostics.
 */
export interface SyncFailureContext {
	connectorId: number;
	consecutiveFailures: number;
	error: unknown;
}

/**
 * Determines the appropriate health status based on sync result and failure count.
 *
 * Health status determination rules:
 * - Success: Always 'healthy'
 * - AuthenticationError: Immediately 'unhealthy' (won't recover without config change)
 * - failures >= UNHEALTHY_THRESHOLD: 'unhealthy'
 * - failures >= DEGRADED_THRESHOLD: 'degraded'
 * - failures < DEGRADED_THRESHOLD: 'degraded' (first failures are still degraded)
 *
 * @param success - Whether the sync succeeded
 * @param consecutiveFailures - Number of consecutive failures (including this one if failure)
 * @param error - The error if sync failed
 * @returns The determined health status
 */
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

/**
 * Determines if a sync operation should be retried based on error type and attempt count.
 *
 * Non-retryable errors:
 * - AuthenticationError (401) - won't succeed without config change
 * - ValidationError - data issue won't resolve on retry
 * - NotFoundError (404) - resource doesn't exist
 * - SSLError - certificate issue won't resolve on retry
 *
 * @param error - The error from the failed sync attempt
 * @param attemptCount - Number of attempts made so far (0-indexed)
 * @returns true if sync should be retried, false otherwise
 */
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

/**
 * Calculates the backoff delay for a sync retry attempt.
 *
 * Uses exponential backoff: delay = baseDelay * (multiplier ^ attempt)
 * Capped at maxDelay to prevent unbounded growth.
 *
 * Example with default config (base=30s, multiplier=2, max=300s):
 * - Attempt 0: 30s
 * - Attempt 1: 60s
 * - Attempt 2: 120s
 * - Attempt 3+: 240s (would be 240s, 300s cap not reached yet)
 *
 * @param attempt - The attempt number (0-indexed)
 * @returns Delay in milliseconds before the next attempt
 */
export function calculateSyncBackoffDelay(attempt: number): number {
	const exponentialDelay =
		SYNC_CONFIG.SYNC_RETRY_BASE_DELAY * Math.pow(SYNC_CONFIG.SYNC_RETRY_MULTIPLIER, attempt);

	return Math.min(exponentialDelay, SYNC_CONFIG.SYNC_RETRY_MAX_DELAY);
}

/**
 * Determines connector health status from API health check results.
 *
 * This function analyzes the health checks returned by the *arr application's
 * /api/v3/health endpoint and determines the overall health status.
 *
 * Rules:
 * - Any 'error' type: 'degraded' (connector is responding but has issues)
 * - Any 'warning' type: 'healthy' (warnings are informational)
 * - All 'ok' or 'notice': 'healthy'
 *
 * @param checks - Array of health check items from the *arr API
 * @returns The determined health status
 * @requirements 1.4
 */
export function determineHealthFromChecks(
	checks: Array<{ type: 'ok' | 'notice' | 'warning' | 'error' }>
): HealthStatus {
	const hasError = checks.some((c) => c.type === 'error');

	if (hasError) {
		return 'degraded';
	}

	return 'healthy';
}
