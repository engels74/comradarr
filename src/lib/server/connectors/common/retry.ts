import { isRetryableError, RateLimitError } from './errors.js';
import type { RetryConfig } from './types.js';

export const DEFAULT_RETRY_CONFIG: Required<RetryConfig> = {
	maxRetries: 3,
	baseDelay: 1000,
	maxDelay: 30000,
	multiplier: 2,
	jitter: true
};

export function calculateBackoffDelay(attempt: number, config: Required<RetryConfig>): number {
	const exponentialDelay = config.baseDelay * config.multiplier ** attempt;
	const clampedDelay = Math.min(exponentialDelay, config.maxDelay);

	if (config.jitter) {
		// Add random jitter of ±25% to prevent thundering herd
		// Range: [0.75 * delay, 1.25 * delay]
		const jitterFactor = 0.75 + Math.random() * 0.5;
		return Math.floor(clampedDelay * jitterFactor);
	}

	return clampedDelay;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(fn: () => Promise<T>, config?: RetryConfig): Promise<T> {
	const resolvedConfig: Required<RetryConfig> = {
		...DEFAULT_RETRY_CONFIG,
		...config
	};

	let lastError: unknown;

	for (let attempt = 0; attempt <= resolvedConfig.maxRetries; attempt++) {
		try {
			return await fn();
		} catch (error) {
			lastError = error;

			// Don't retry if:
			// 1. This was the last attempt
			// 2. The error is not retryable
			const isLastAttempt = attempt === resolvedConfig.maxRetries;
			const shouldRetry = isRetryableError(error);

			if (isLastAttempt || !shouldRetry) {
				throw error;
			}

			// Calculate delay for next retry
			let delay: number;

			// Handle RateLimitError with Retry-After header specially
			if (error instanceof RateLimitError && error.retryAfter !== undefined) {
				// Retry-After is in seconds, convert to milliseconds
				delay = error.retryAfter * 1000;
			} else {
				delay = calculateBackoffDelay(attempt, resolvedConfig);
			}

			await sleep(delay);
		}
	}

	// This should never be reached due to the throw in the loop,
	// but TypeScript needs this for type safety
	throw lastError;
}
