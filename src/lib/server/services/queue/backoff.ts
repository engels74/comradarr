/**
 * Cooldown backoff calculation for search state transitions.
 *
 * This module provides pure functions for calculating cooldown delays,
 * separate from database operations to allow unit testing without
 * database dependencies.
 *
 * @module services/queue/backoff
 * @requirements 5.5
 */

import { calculateBackoffDelay } from '$lib/server/connectors/common/retry.js';
import type { RetryConfig } from '$lib/server/connectors/common/types.js';
import { STATE_TRANSITION_CONFIG } from './config';

/**
 * Calculate the next eligible time for a retry attempt using exponential backoff.
 *
 * Uses the existing backoff calculation from retry.ts with cooldown-specific
 * configuration (longer delays than API retries).
 *
 * @param attemptCount - Number of failed attempts (1-based, after the current failure)
 * @param now - Current time (default: new Date())
 * @returns Date when the item becomes eligible for retry
 *
 * @example
 * ```typescript
 * // After first failure (attemptCount = 1)
 * const nextEligible = calculateNextEligibleTime(1);
 * // Returns a Date approximately 1 hour from now (with jitter)
 *
 * // After second failure (attemptCount = 2)
 * const nextEligible = calculateNextEligibleTime(2);
 * // Returns a Date approximately 2 hours from now (with jitter)
 * ```
 *
 * @requirements 5.5
 */
export function calculateNextEligibleTime(attemptCount: number, now: Date = new Date()): Date {
	// Create retry config from state transition config
	const config: Required<RetryConfig> = {
		maxRetries: STATE_TRANSITION_CONFIG.MAX_ATTEMPTS,
		baseDelay: STATE_TRANSITION_CONFIG.COOLDOWN_BASE_DELAY,
		maxDelay: STATE_TRANSITION_CONFIG.COOLDOWN_MAX_DELAY,
		multiplier: STATE_TRANSITION_CONFIG.COOLDOWN_MULTIPLIER,
		jitter: STATE_TRANSITION_CONFIG.COOLDOWN_JITTER
	};

	// Use attemptCount - 1 for delay calculation since calculateBackoffDelay
	// expects 0-based attempt index (0 = first retry)
	const delayMs = calculateBackoffDelay(Math.max(0, attemptCount - 1), config);
	return new Date(now.getTime() + delayMs);
}

/**
 * Check if an item should be marked as exhausted based on attempt count.
 *
 * @param attemptCount - Current attempt count (after incrementing for failure)
 * @returns True if the item has reached max attempts and should be exhausted
 *
 * @requirements 5.6
 */
export function shouldMarkExhausted(attemptCount: number): boolean {
	return attemptCount >= STATE_TRANSITION_CONFIG.MAX_ATTEMPTS;
}
