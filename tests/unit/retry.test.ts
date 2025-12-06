/**
 * Unit tests for retry logic with exponential backoff
 *
 * Tests cover:
 * - calculateBackoffDelay() behavior
 * - withRetry() success scenarios
 * - withRetry() retry behavior for retryable errors
 * - withRetry() non-retry behavior for non-retryable errors
 * - Rate limit handling with Retry-After header
 * - Jitter behavior
 *

 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	withRetry,
	calculateBackoffDelay,
	DEFAULT_RETRY_CONFIG,
	NetworkError,
	AuthenticationError,
	RateLimitError,
	ServerError,
	TimeoutError,
	NotFoundError,
	SSLError
} from '../../src/lib/server/connectors/index';

describe('calculateBackoffDelay', () => {
	const baseConfig = {
		...DEFAULT_RETRY_CONFIG,
		jitter: false // Disable jitter for predictable tests
	};

	describe('exponential growth', () => {
		it('should return baseDelay for attempt 0', () => {
			const delay = calculateBackoffDelay(0, baseConfig);
			expect(delay).toBe(1000); // 1000 * 2^0 = 1000
		});

		it('should double delay for each attempt', () => {
			expect(calculateBackoffDelay(0, baseConfig)).toBe(1000); // 2^0 = 1
			expect(calculateBackoffDelay(1, baseConfig)).toBe(2000); // 2^1 = 2
			expect(calculateBackoffDelay(2, baseConfig)).toBe(4000); // 2^2 = 4
			expect(calculateBackoffDelay(3, baseConfig)).toBe(8000); // 2^3 = 8
			expect(calculateBackoffDelay(4, baseConfig)).toBe(16000); // 2^4 = 16
		});

		it('should respect custom baseDelay', () => {
			const config = { ...baseConfig, baseDelay: 500 };
			expect(calculateBackoffDelay(0, config)).toBe(500);
			expect(calculateBackoffDelay(1, config)).toBe(1000);
			expect(calculateBackoffDelay(2, config)).toBe(2000);
		});

		it('should respect custom multiplier', () => {
			const config = { ...baseConfig, multiplier: 3 };
			expect(calculateBackoffDelay(0, config)).toBe(1000); // 1000 * 3^0 = 1000
			expect(calculateBackoffDelay(1, config)).toBe(3000); // 1000 * 3^1 = 3000
			expect(calculateBackoffDelay(2, config)).toBe(9000); // 1000 * 3^2 = 9000
		});
	});

	describe('maxDelay cap', () => {
		it('should cap delay at maxDelay', () => {
			const config = { ...baseConfig, maxDelay: 5000 };
			expect(calculateBackoffDelay(0, config)).toBe(1000);
			expect(calculateBackoffDelay(1, config)).toBe(2000);
			expect(calculateBackoffDelay(2, config)).toBe(4000);
			expect(calculateBackoffDelay(3, config)).toBe(5000); // Would be 8000, capped at 5000
			expect(calculateBackoffDelay(10, config)).toBe(5000); // Still capped
		});
	});

	describe('jitter', () => {
		it('should add jitter when enabled', () => {
			const config = { ...baseConfig, jitter: true };
			const delays = new Set<number>();

			// Generate multiple delays - with jitter they should vary
			for (let i = 0; i < 100; i++) {
				delays.add(calculateBackoffDelay(0, config));
			}

			// With jitter enabled, we should see variation
			expect(delays.size).toBeGreaterThan(1);
		});

		it('should produce delays within ±25% range with jitter', () => {
			const config = { ...baseConfig, jitter: true, baseDelay: 1000 };
			const minExpected = 750; // 1000 * 0.75
			const maxExpected = 1250; // 1000 * 1.25

			for (let i = 0; i < 100; i++) {
				const delay = calculateBackoffDelay(0, config);
				expect(delay).toBeGreaterThanOrEqual(minExpected);
				expect(delay).toBeLessThanOrEqual(maxExpected);
			}
		});

		it('should not have jitter when disabled', () => {
			const config = { ...baseConfig, jitter: false };
			const delays = new Set<number>();

			for (let i = 0; i < 10; i++) {
				delays.add(calculateBackoffDelay(0, config));
			}

			// Without jitter, all delays should be identical
			expect(delays.size).toBe(1);
		});
	});
});

describe('withRetry', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe('successful execution', () => {
		it('should return result on first success', async () => {
			const fn = vi.fn().mockResolvedValue('success');

			const promise = withRetry(fn, { maxRetries: 3 });
			await vi.runAllTimersAsync();
			const result = await promise;

			expect(result).toBe('success');
			expect(fn).toHaveBeenCalledTimes(1);
		});

		it('should return result after retry success', async () => {
			const fn = vi
				.fn()
				.mockRejectedValueOnce(new NetworkError('Connection failed', 'connection_refused'))
				.mockResolvedValue('success');

			const promise = withRetry(fn, { maxRetries: 3, jitter: false });
			await vi.runAllTimersAsync();
			const result = await promise;

			expect(result).toBe('success');
			expect(fn).toHaveBeenCalledTimes(2);
		});
	});

	describe('retryable errors', () => {
		it('should retry on NetworkError', async () => {
			const fn = vi
				.fn()
				.mockRejectedValueOnce(new NetworkError('Connection failed', 'connection_refused'))
				.mockRejectedValueOnce(new NetworkError('DNS failed', 'dns_failure'))
				.mockResolvedValue('success');

			const resultPromise = (async () => {
				const promise = withRetry(fn, { maxRetries: 3, jitter: false });
				await vi.runAllTimersAsync();
				return promise;
			})();

			const result = await resultPromise;
			expect(result).toBe('success');
			expect(fn).toHaveBeenCalledTimes(3);
		});

		it('should retry on ServerError', async () => {
			const fn = vi
				.fn()
				.mockRejectedValueOnce(new ServerError(500, 'Internal Server Error'))
				.mockResolvedValue('success');

			const resultPromise = (async () => {
				const promise = withRetry(fn, { maxRetries: 3, jitter: false });
				await vi.runAllTimersAsync();
				return promise;
			})();

			const result = await resultPromise;
			expect(result).toBe('success');
			expect(fn).toHaveBeenCalledTimes(2);
		});

		it('should retry on TimeoutError', async () => {
			const fn = vi
				.fn()
				.mockRejectedValueOnce(new TimeoutError(30000))
				.mockResolvedValue('success');

			const resultPromise = (async () => {
				const promise = withRetry(fn, { maxRetries: 3, jitter: false });
				await vi.runAllTimersAsync();
				return promise;
			})();

			const result = await resultPromise;
			expect(result).toBe('success');
			expect(fn).toHaveBeenCalledTimes(2);
		});

		it('should retry on RateLimitError', async () => {
			const fn = vi
				.fn()
				.mockRejectedValueOnce(new RateLimitError())
				.mockResolvedValue('success');

			const resultPromise = (async () => {
				const promise = withRetry(fn, { maxRetries: 3, jitter: false });
				await vi.runAllTimersAsync();
				return promise;
			})();

			const result = await resultPromise;
			expect(result).toBe('success');
			expect(fn).toHaveBeenCalledTimes(2);
		});
	});

	describe('non-retryable errors', () => {
		it('should NOT retry on AuthenticationError', async () => {
			const fn = vi.fn().mockRejectedValue(new AuthenticationError());

			const promise = withRetry(fn, { maxRetries: 3 });

			await expect(promise).rejects.toThrow(AuthenticationError);
			expect(fn).toHaveBeenCalledTimes(1);
		});

		it('should NOT retry on NotFoundError', async () => {
			const fn = vi.fn().mockRejectedValue(new NotFoundError('series/123'));

			const promise = withRetry(fn, { maxRetries: 3 });

			await expect(promise).rejects.toThrow(NotFoundError);
			expect(fn).toHaveBeenCalledTimes(1);
		});

		it('should NOT retry on SSLError', async () => {
			const fn = vi.fn().mockRejectedValue(new SSLError('Certificate invalid'));

			const promise = withRetry(fn, { maxRetries: 3 });

			await expect(promise).rejects.toThrow(SSLError);
			expect(fn).toHaveBeenCalledTimes(1);
		});
	});

	describe('max retries', () => {
		it('should throw after max retries exhausted', async () => {
			const error = new NetworkError('Connection failed', 'connection_refused');
			const fn = vi.fn().mockRejectedValue(error);

			// Create promise and immediately set up error handling
			let caughtError: unknown;
			const promise = withRetry(fn, { maxRetries: 3, jitter: false }).catch((e) => {
				caughtError = e;
			});

			// Advance timers to complete all retries
			await vi.runAllTimersAsync();
			await promise;

			expect(caughtError).toBeInstanceOf(NetworkError);
			// Initial attempt + 3 retries = 4 total calls
			expect(fn).toHaveBeenCalledTimes(4);
		});

		it('should respect maxRetries=0 (no retries)', async () => {
			const fn = vi.fn().mockRejectedValue(new NetworkError('Connection failed', 'connection_refused'));

			await expect(withRetry(fn, { maxRetries: 0 })).rejects.toThrow(NetworkError);
			expect(fn).toHaveBeenCalledTimes(1);
		});

		it('should respect custom maxRetries', async () => {
			const fn = vi.fn().mockRejectedValue(new ServerError(503, 'Service Unavailable'));

			// Create promise and immediately set up error handling
			let caughtError: unknown;
			const promise = withRetry(fn, { maxRetries: 5, jitter: false }).catch((e) => {
				caughtError = e;
			});

			// Advance timers to complete all retries
			await vi.runAllTimersAsync();
			await promise;

			expect(caughtError).toBeInstanceOf(ServerError);
			expect(fn).toHaveBeenCalledTimes(6); // 1 initial + 5 retries
		});
	});

	describe('Retry-After header handling', () => {
		it('should respect Retry-After header on RateLimitError', async () => {
			const fn = vi
				.fn()
				.mockRejectedValueOnce(new RateLimitError(2)) // 2 seconds
				.mockResolvedValue('success');

			const promise = withRetry(fn, { maxRetries: 3, baseDelay: 1000, jitter: false });

			// First call fails
			await vi.advanceTimersByTimeAsync(0);

			// Should wait 2000ms (2 seconds * 1000) from Retry-After, not 1000ms base delay
			await vi.advanceTimersByTimeAsync(1999);
			expect(fn).toHaveBeenCalledTimes(1); // Still only initial call

			await vi.advanceTimersByTimeAsync(1);
			expect(fn).toHaveBeenCalledTimes(2); // Retry happened after 2000ms

			// Advance any remaining timers and get result
			await vi.runAllTimersAsync();
			const result = await promise;
			expect(result).toBe('success');
		});
	});

	describe('delay timing', () => {
		it('should wait exponentially increasing delays between retries', async () => {
			const fn = vi
				.fn()
				.mockRejectedValueOnce(new NetworkError('fail', 'connection_refused'))
				.mockRejectedValueOnce(new NetworkError('fail', 'connection_refused'))
				.mockRejectedValueOnce(new NetworkError('fail', 'connection_refused'))
				.mockResolvedValue('success');

			const promise = withRetry(fn, {
				maxRetries: 3,
				baseDelay: 1000,
				multiplier: 2,
				jitter: false
			});

			// Initial call
			await vi.advanceTimersByTimeAsync(0);
			expect(fn).toHaveBeenCalledTimes(1);

			// Wait 1000ms (1st retry delay: 1000 * 2^0)
			await vi.advanceTimersByTimeAsync(1000);
			expect(fn).toHaveBeenCalledTimes(2);

			// Wait 2000ms (2nd retry delay: 1000 * 2^1)
			await vi.advanceTimersByTimeAsync(2000);
			expect(fn).toHaveBeenCalledTimes(3);

			// Wait 4000ms (3rd retry delay: 1000 * 2^2)
			await vi.advanceTimersByTimeAsync(4000);
			expect(fn).toHaveBeenCalledTimes(4);

			// Advance any remaining timers and get result
			await vi.runAllTimersAsync();
			const result = await promise;
			expect(result).toBe('success');
		});
	});

	describe('default configuration', () => {
		it('should use default config when not provided', async () => {
			const fn = vi.fn().mockResolvedValue('success');

			const result = await withRetry(fn);

			expect(result).toBe('success');
			expect(fn).toHaveBeenCalledTimes(1);
		});
	});
});

describe('DEFAULT_RETRY_CONFIG', () => {
	it('should have expected default values', () => {
		expect(DEFAULT_RETRY_CONFIG.maxRetries).toBe(3);
		expect(DEFAULT_RETRY_CONFIG.baseDelay).toBe(1000);
		expect(DEFAULT_RETRY_CONFIG.maxDelay).toBe(30000);
		expect(DEFAULT_RETRY_CONFIG.multiplier).toBe(2);
		expect(DEFAULT_RETRY_CONFIG.jitter).toBe(true);
	});
});
