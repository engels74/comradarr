/**
 * Property-based tests for exponential backoff calculation.
 *
 * Verifies that backoff delay increases with each attempt until reaching maxDelay.
 */

import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
	calculateBackoffDelay,
	DEFAULT_RETRY_CONFIG
} from '../../src/lib/server/connectors/common/retry';
import type { RetryConfig } from '../../src/lib/server/connectors/common/types';

/**
 * Arbitrary generator for Required<RetryConfig> objects.
 * Generates valid retry configurations with reasonable constraints.
 */
const retryConfigArbitrary: fc.Arbitrary<Required<RetryConfig>> = fc
	.record({
		maxRetries: fc.integer({ min: 1, max: 10 }),
		baseDelay: fc.integer({ min: 100, max: 10000 }),
		maxDelay: fc.integer({ min: 1000, max: 60000 }),
		multiplier: fc.double({ min: 1.1, max: 3.0, noNaN: true }),
		jitter: fc.boolean()
	})
	.filter((config) => config.baseDelay <= config.maxDelay);

/**
 * RetryConfig with jitter disabled for deterministic testing
 */
const retryConfigNoJitterArbitrary: fc.Arbitrary<Required<RetryConfig>> = fc
	.record({
		maxRetries: fc.integer({ min: 1, max: 10 }),
		baseDelay: fc.integer({ min: 100, max: 10000 }),
		maxDelay: fc.integer({ min: 1000, max: 60000 }),
		multiplier: fc.double({ min: 1.1, max: 3.0, noNaN: true }),
		jitter: fc.constant(false)
	})
	.filter((config) => config.baseDelay <= config.maxDelay);

/**
 * RetryConfig with jitter enabled for jitter-specific tests
 */
const retryConfigWithJitterArbitrary: fc.Arbitrary<Required<RetryConfig>> = fc
	.record({
		maxRetries: fc.integer({ min: 1, max: 10 }),
		baseDelay: fc.integer({ min: 100, max: 10000 }),
		maxDelay: fc.integer({ min: 1000, max: 60000 }),
		multiplier: fc.double({ min: 1.1, max: 3.0, noNaN: true }),
		jitter: fc.constant(true)
	})
	.filter((config) => config.baseDelay <= config.maxDelay);

/**
 * Attempt number arbitrary (0-based, within reasonable bounds)
 */
const attemptArbitrary = fc.integer({ min: 0, max: 20 });

describe('Exponential Backoff Calculation', () => {
	describe('Property: Exponential Growth', () => {
		it('delay increases by at least multiplier factor for consecutive attempts before reaching maxDelay (without jitter)', () => {
			fc.assert(
				fc.property(retryConfigNoJitterArbitrary, attemptArbitrary, (config, attempt) => {
					const currentDelay = calculateBackoffDelay(attempt, config);
					const nextDelay = calculateBackoffDelay(attempt + 1, config);

					// If current delay hasn't reached maxDelay, next delay should be at least multiplier times greater
					// (up to maxDelay cap)
					if (currentDelay < config.maxDelay) {
						const expectedMinNext = Math.min(currentDelay * config.multiplier, config.maxDelay);
						// Use >= with small epsilon for floating point
						expect(nextDelay).toBeGreaterThanOrEqual(Math.floor(expectedMinNext * 0.999));
					}
				}),
				{ numRuns: 100 }
			);
		});
	});

	describe('Property: Maximum Delay Cap', () => {
		it('delay never exceeds maxDelay', () => {
			fc.assert(
				fc.property(retryConfigArbitrary, attemptArbitrary, (config, attempt) => {
					const delay = calculateBackoffDelay(attempt, config);

					// With jitter, max possible is 1.25 * maxDelay
					if (config.jitter) {
						expect(delay).toBeLessThanOrEqual(Math.ceil(config.maxDelay * 1.25));
					} else {
						expect(delay).toBeLessThanOrEqual(config.maxDelay);
					}
				}),
				{ numRuns: 100 }
			);
		});
	});

	describe('Property: Base Delay', () => {
		it('first attempt (attempt=0) returns baseDelay without jitter', () => {
			fc.assert(
				fc.property(retryConfigNoJitterArbitrary, (config) => {
					const delay = calculateBackoffDelay(0, config);
					expect(delay).toBe(config.baseDelay);
				}),
				{ numRuns: 100 }
			);
		});
	});

	describe('Property: Jitter Bounds', () => {
		it('with jitter enabled, delay is within ±25% of calculated value', () => {
			fc.assert(
				fc.property(retryConfigWithJitterArbitrary, attemptArbitrary, (config, attempt) => {
					// Calculate expected delay without jitter
					const exponentialDelay = config.baseDelay * config.multiplier ** attempt;
					const clampedDelay = Math.min(exponentialDelay, config.maxDelay);

					// Run multiple times to verify jitter range (since jitter is random)
					for (let i = 0; i < 10; i++) {
						const actualDelay = calculateBackoffDelay(attempt, config);

						// Jitter range is [0.75 * delay, 1.25 * delay]
						const minExpected = Math.floor(clampedDelay * 0.75);
						const maxExpected = Math.ceil(clampedDelay * 1.25);

						expect(actualDelay).toBeGreaterThanOrEqual(minExpected);
						expect(actualDelay).toBeLessThanOrEqual(maxExpected);
					}
				}),
				{ numRuns: 100 }
			);
		});
	});

	describe('Property: Monotonic Growth', () => {
		it('without jitter, delays are non-decreasing with increasing attempts', () => {
			fc.assert(
				fc.property(retryConfigNoJitterArbitrary, attemptArbitrary, (config, attempt) => {
					const currentDelay = calculateBackoffDelay(attempt, config);
					const nextDelay = calculateBackoffDelay(attempt + 1, config);

					expect(nextDelay).toBeGreaterThanOrEqual(currentDelay);
				}),
				{ numRuns: 100 }
			);
		});
	});

	describe('Property: Non-Negative Result', () => {
		it('delay is always non-negative', () => {
			fc.assert(
				fc.property(retryConfigArbitrary, attemptArbitrary, (config, attempt) => {
					const delay = calculateBackoffDelay(attempt, config);
					expect(delay).toBeGreaterThanOrEqual(0);
				}),
				{ numRuns: 100 }
			);
		});

		it('delay is an integer when jitter is enabled (due to Math.floor)', () => {
			fc.assert(
				fc.property(retryConfigWithJitterArbitrary, attemptArbitrary, (config, attempt) => {
					const delay = calculateBackoffDelay(attempt, config);
					expect(Number.isInteger(delay)).toBe(true);
				}),
				{ numRuns: 100 }
			);
		});
	});

	describe('Edge Cases', () => {
		it('should return baseDelay at attempt 0 with default config (no jitter)', () => {
			const config: Required<RetryConfig> = { ...DEFAULT_RETRY_CONFIG, jitter: false };
			const delay = calculateBackoffDelay(0, config);
			expect(delay).toBe(DEFAULT_RETRY_CONFIG.baseDelay);
		});

		it('should cap at maxDelay for very high attempt numbers', () => {
			const config: Required<RetryConfig> = {
				maxRetries: 3,
				baseDelay: 1000,
				maxDelay: 30000,
				multiplier: 2,
				jitter: false
			};

			// Attempt 10: 1000 * 2^10 = 1,024,000 should be capped to 30,000
			const delay = calculateBackoffDelay(10, config);
			expect(delay).toBe(30000);
		});

		it('should handle multiplier of 1 (no exponential growth)', () => {
			const config: Required<RetryConfig> = {
				maxRetries: 3,
				baseDelay: 1000,
				maxDelay: 30000,
				multiplier: 1,
				jitter: false
			};

			// All attempts should return baseDelay when multiplier is 1
			for (let attempt = 0; attempt <= 5; attempt++) {
				const delay = calculateBackoffDelay(attempt, config);
				expect(delay).toBe(1000);
			}
		});

		it('should handle baseDelay equal to maxDelay', () => {
			const config: Required<RetryConfig> = {
				maxRetries: 3,
				baseDelay: 5000,
				maxDelay: 5000,
				multiplier: 2,
				jitter: false
			};

			// All attempts should return maxDelay when baseDelay equals maxDelay
			for (let attempt = 0; attempt <= 5; attempt++) {
				const delay = calculateBackoffDelay(attempt, config);
				expect(delay).toBe(5000);
			}
		});

		it('should handle fast growth with high multiplier', () => {
			const config: Required<RetryConfig> = {
				maxRetries: 3,
				baseDelay: 1000,
				maxDelay: 30000,
				multiplier: 3,
				jitter: false
			};

			// Attempt 0: 1000 * 3^0 = 1000
			expect(calculateBackoffDelay(0, config)).toBe(1000);

			// Attempt 1: 1000 * 3^1 = 3000
			expect(calculateBackoffDelay(1, config)).toBe(3000);

			// Attempt 2: 1000 * 3^2 = 9000
			expect(calculateBackoffDelay(2, config)).toBe(9000);

			// Attempt 3: 1000 * 3^3 = 27000
			expect(calculateBackoffDelay(3, config)).toBe(27000);

			// Attempt 4: 1000 * 3^4 = 81000 -> capped at 30000
			expect(calculateBackoffDelay(4, config)).toBe(30000);
		});

		it('should follow documented example values', () => {
			// Example from retry.ts docstring
			const config: Required<RetryConfig> = {
				baseDelay: 1000,
				multiplier: 2,
				maxDelay: 30000,
				maxRetries: 3,
				jitter: false
			};

			expect(calculateBackoffDelay(0, config)).toBe(1000); // 1000 * 2^0
			expect(calculateBackoffDelay(1, config)).toBe(2000); // 1000 * 2^1
			expect(calculateBackoffDelay(2, config)).toBe(4000); // 1000 * 2^2
			expect(calculateBackoffDelay(5, config)).toBe(30000); // capped at maxDelay
		});

		it('should produce integer results with fractional multipliers when jitter is enabled', () => {
			const config: Required<RetryConfig> = {
				maxRetries: 3,
				baseDelay: 1000,
				maxDelay: 30000,
				multiplier: 1.5,
				jitter: true
			};

			for (let attempt = 0; attempt <= 10; attempt++) {
				const delay = calculateBackoffDelay(attempt, config);
				// With jitter enabled, Math.floor is applied, so result is always an integer
				expect(Number.isInteger(delay)).toBe(true);
			}
		});

		it('should produce finite numeric results with fractional multipliers (no jitter)', () => {
			const config: Required<RetryConfig> = {
				maxRetries: 3,
				baseDelay: 1000,
				maxDelay: 30000,
				multiplier: 1.5,
				jitter: false
			};

			for (let attempt = 0; attempt <= 10; attempt++) {
				const delay = calculateBackoffDelay(attempt, config);
				// Without jitter, result may be a float due to floating-point arithmetic
				expect(Number.isFinite(delay)).toBe(true);
				expect(delay).toBeGreaterThan(0);
			}
		});
	});
});
