import { calculateBackoffDelay } from '$lib/server/connectors/common/retry.js';
import type { RetryConfig } from '$lib/server/connectors/common/types.js';
import { BACKLOG_CONFIG, getStateTransitionConfig, STATE_TRANSITION_CONFIG } from './config';

/** Calculate next retry time using exponential backoff. */
export function calculateNextEligibleTime(attemptCount: number, now: Date = new Date()): Date {
	const config: Required<RetryConfig> = {
		maxRetries: STATE_TRANSITION_CONFIG.MAX_ATTEMPTS,
		baseDelay: STATE_TRANSITION_CONFIG.COOLDOWN_BASE_DELAY,
		maxDelay: STATE_TRANSITION_CONFIG.COOLDOWN_MAX_DELAY,
		multiplier: STATE_TRANSITION_CONFIG.COOLDOWN_MULTIPLIER,
		jitter: STATE_TRANSITION_CONFIG.COOLDOWN_JITTER
	};

	const delayMs = calculateBackoffDelay(Math.max(0, attemptCount - 1), config);
	return new Date(now.getTime() + delayMs);
}

export function shouldMarkExhausted(attemptCount: number): boolean {
	return attemptCount >= STATE_TRANSITION_CONFIG.MAX_ATTEMPTS;
}

/** Async version using database-configured cooldown settings. */
export async function calculateNextEligibleTimeWithConfig(
	attemptCount: number,
	now: Date = new Date()
): Promise<Date> {
	const stateConfig = await getStateTransitionConfig();

	const config: Required<RetryConfig> = {
		maxRetries: stateConfig.MAX_ATTEMPTS,
		baseDelay: stateConfig.COOLDOWN_BASE_DELAY,
		maxDelay: stateConfig.COOLDOWN_MAX_DELAY,
		multiplier: stateConfig.COOLDOWN_MULTIPLIER,
		jitter: stateConfig.COOLDOWN_JITTER
	};

	const delayMs = calculateBackoffDelay(Math.max(0, attemptCount - 1), config);
	return new Date(now.getTime() + delayMs);
}

/** Async version using database-configured max attempts. */
export async function shouldMarkExhaustedWithConfig(attemptCount: number): Promise<boolean> {
	const stateConfig = await getStateTransitionConfig();
	return attemptCount >= stateConfig.MAX_ATTEMPTS;
}

/** Check if item should enter backlog (after exhausting normal retries). */
export function shouldEnterBacklog(attemptCount: number, maxAttempts: number): boolean {
	return attemptCount >= maxAttempts;
}

/** Get the next backlog tier, capped at maxTier. */
export function getNextBacklogTier(
	currentTier: number,
	maxTier: number = BACKLOG_CONFIG.MAX_TIER
): number {
	return Math.min(currentTier + 1, maxTier);
}

/**
 * Calculate next eligible time for backlog items using tier-based delays.
 * Adds ±12 hours jitter to prevent thundering herd.
 */
export function calculateBacklogNextEligibleTime(
	backlogTier: number,
	tierDelaysDays: number[],
	now: Date = new Date()
): Date {
	// Tier is 1-indexed, array is 0-indexed
	const tierIndex = Math.min(backlogTier - 1, tierDelaysDays.length - 1);
	const delayDays = tierDelaysDays[tierIndex] ?? tierDelaysDays[tierDelaysDays.length - 1]!;
	const delayMs = delayDays * 24 * 60 * 60 * 1000;

	// Add jitter (±12 hours) to prevent thundering herd
	const jitterMs = (Math.random() - 0.5) * 24 * 60 * 60 * 1000;

	return new Date(now.getTime() + delayMs + jitterMs);
}
