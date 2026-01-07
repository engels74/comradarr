import { calculateBackoffDelay } from '$lib/server/connectors/common/retry.js';
import type { RetryConfig } from '$lib/server/connectors/common/types.js';
import { getStateTransitionConfig, STATE_TRANSITION_CONFIG } from './config';

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
