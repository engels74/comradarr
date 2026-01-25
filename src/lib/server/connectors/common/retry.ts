import { createLogger } from '$lib/server/logger';
import { isRetryableError, RateLimitError } from './errors.js';
import type { RetryConfig } from './types.js';

const logger = createLogger('arr-retry');

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
		// ±25% jitter to prevent thundering herd
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
			const result = await fn();
			if (attempt > 0) {
				logger.info('Retry succeeded', { attempt, maxRetries: resolvedConfig.maxRetries });
			}
			return result;
		} catch (error) {
			lastError = error;

			const isLastAttempt = attempt === resolvedConfig.maxRetries;
			const shouldRetry = isRetryableError(error);

			if (isLastAttempt || !shouldRetry) {
				if (attempt > 0) {
					logger.warn('All retry attempts exhausted', {
						attempts: attempt + 1,
						errorType: error instanceof Error ? error.name : 'unknown',
						errorMessage: error instanceof Error ? error.message : String(error)
					});
				}
				throw error;
			}

			let delay: number;
			if (error instanceof RateLimitError && error.retryAfter !== undefined) {
				delay = error.retryAfter * 1000;
				logger.debug('Rate limited, waiting for retry-after', {
					attempt: attempt + 1,
					maxRetries: resolvedConfig.maxRetries,
					delayMs: delay,
					retryAfterSeconds: error.retryAfter
				});
			} else {
				delay = calculateBackoffDelay(attempt, resolvedConfig);
				logger.debug('Retrying after error', {
					attempt: attempt + 1,
					maxRetries: resolvedConfig.maxRetries,
					delayMs: delay,
					errorType: error instanceof Error ? error.name : 'unknown'
				});
			}

			await sleep(delay);
		}
	}

	throw lastError;
}
