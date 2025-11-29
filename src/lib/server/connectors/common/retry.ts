/**
 * Retry wrapper with exponential backoff for *arr API requests
 *
 * Implements automatic retry logic for failed requests with:
 * - Exponential backoff with configurable base delay and multiplier
 * - Maximum delay cap to prevent excessive waits
 * - Optional jitter to prevent thundering herd
 * - Respect for Retry-After headers on rate limit errors
 * - Skip retry for non-retryable errors (auth, not found, SSL)
 *
 * @module connectors/common/retry
 * @requirements 23.5
 */

import type { RetryConfig } from './types.js';
import { isRetryableError, RateLimitError } from './errors.js';

/**
 * Default retry configuration values
 */
export const DEFAULT_RETRY_CONFIG: Required<RetryConfig> = {
	maxRetries: 3,
	baseDelay: 1000,
	maxDelay: 30000,
	multiplier: 2,
	jitter: true
};

/**
 * Calculate the delay before the next retry attempt using exponential backoff
 *
 * Formula: min(baseDelay * multiplier^attempt, maxDelay) with optional jitter
 *
 * @param attempt - Zero-based attempt number (0 for first retry, 1 for second, etc.)
 * @param config - Retry configuration with all required fields
 * @returns Delay in milliseconds before next retry
 *
 * @example
 * ```typescript
 * const config = { baseDelay: 1000, multiplier: 2, maxDelay: 30000, maxRetries: 3, jitter: false };
 * calculateBackoffDelay(0, config); // 1000ms (1000 * 2^0)
 * calculateBackoffDelay(1, config); // 2000ms (1000 * 2^1)
 * calculateBackoffDelay(2, config); // 4000ms (1000 * 2^2)
 * calculateBackoffDelay(5, config); // 30000ms (capped at maxDelay)
 * ```
 */
export function calculateBackoffDelay(attempt: number, config: Required<RetryConfig>): number {
	const exponentialDelay = config.baseDelay * Math.pow(config.multiplier, attempt);
	const clampedDelay = Math.min(exponentialDelay, config.maxDelay);

	if (config.jitter) {
		// Add random jitter of ±25% to prevent thundering herd
		// Range: [0.75 * delay, 1.25 * delay]
		const jitterFactor = 0.75 + Math.random() * 0.5;
		return Math.floor(clampedDelay * jitterFactor);
	}

	return clampedDelay;
}

/**
 * Sleep for the specified duration
 *
 * @param ms - Duration in milliseconds
 * @returns Promise that resolves after the delay
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a function with automatic retry logic and exponential backoff
 *
 * This function wraps an async operation and automatically retries it on failure
 * if the error is retryable (network errors, server errors, timeouts, rate limits).
 * Non-retryable errors (authentication, not found, SSL) are thrown immediately.
 *
 * @param fn - Async function to execute with retry logic
 * @param config - Optional retry configuration (uses defaults if not provided)
 * @returns Promise resolving to the function's return value
 * @throws The last error encountered if all retries are exhausted or error is non-retryable
 *
 * @example
 * ```typescript
 * // Basic usage with defaults
 * const result = await withRetry(() => fetchData());
 *
 * // Custom configuration
 * const result = await withRetry(
 *   () => fetchData(),
 *   { maxRetries: 5, baseDelay: 500, multiplier: 1.5 }
 * );
 * ```
 *
 * @requirements 23.5
 */
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
