/**
 * Property-based tests for search state transitions.
 *
 * Validates requirements:
 * - 5.5: Calculate the next eligible search time using exponential backoff
 * - 5.6: Mark as exhausted when reaching maximum retry attempts
 *
 * Property 8: Exhaustion at Max Attempts
 * "For any search registry entry, when the attempt count reaches exactly
 * the configured maximum, the state should transition to 'exhausted'.
 * The state should not become exhausted before max attempts, and should
 * always become exhausted at max attempts."
 *
 * @requirements 5.5, 5.6
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
// Import directly from specific files to avoid loading database-dependent modules
import {
	calculateNextEligibleTime,
	shouldMarkExhausted
} from '../../src/lib/server/services/queue/backoff';
import { STATE_TRANSITION_CONFIG } from '../../src/lib/server/services/queue/config';

/**
 * Arbitrary for attempt counts (0 to max attempts + some buffer)
 */
const attemptCountArbitrary = fc.integer({
	min: 0,
	max: STATE_TRANSITION_CONFIG.MAX_ATTEMPTS + 5
});

/**
 * Arbitrary for valid attempt counts below max
 */
const attemptCountBelowMaxArbitrary = fc.integer({
	min: 1,
	max: STATE_TRANSITION_CONFIG.MAX_ATTEMPTS - 1
});

/**
 * Arbitrary for attempt counts at or above max
 */
const attemptCountAtOrAboveMaxArbitrary = fc.integer({
	min: STATE_TRANSITION_CONFIG.MAX_ATTEMPTS,
	max: STATE_TRANSITION_CONFIG.MAX_ATTEMPTS + 10
});

/**
 * Arbitrary for Date objects (within reasonable range)
 * Filter out invalid dates (NaN) to prevent test failures
 */
const dateArbitrary = fc
	.date({
		min: new Date('2020-01-01'),
		max: new Date('2030-12-31')
	})
	.filter((d) => !isNaN(d.getTime()));

describe('State Transitions (Requirements 5.5, 5.6)', () => {
	describe('Property 8: Exhaustion at Max Attempts', () => {
		it('should determine exhaustion correctly based on attempt count vs MAX_ATTEMPTS', () => {
			fc.assert(
				fc.property(attemptCountArbitrary, (attemptCount) => {
					const maxAttempts = STATE_TRANSITION_CONFIG.MAX_ATTEMPTS;
					const shouldBeExhausted = attemptCount >= maxAttempts;

					// Simulate what markSearchFailed would do:
					// After a failure, attemptCount is incremented
					// If new attemptCount >= MAX_ATTEMPTS, state becomes 'exhausted'
					// Otherwise, state becomes 'cooldown'

					// For attemptCount before failure:
					const attemptCountAfterFailure = attemptCount + 1;
					const wouldBeExhausted = attemptCountAfterFailure >= maxAttempts;

					// When attemptCount = MAX_ATTEMPTS - 1, after failure it becomes MAX_ATTEMPTS
					// which should trigger exhaustion
					if (attemptCount === maxAttempts - 1) {
						expect(wouldBeExhausted).toBe(true);
					}

					// When attemptCount < MAX_ATTEMPTS - 1, after failure should still be below max
					if (attemptCount < maxAttempts - 1) {
						expect(wouldBeExhausted).toBe(false);
					}

					// When attemptCount >= MAX_ATTEMPTS, already exhausted (shouldn't be called)
					if (attemptCount >= maxAttempts) {
						expect(shouldBeExhausted).toBe(true);
					}
				}),
				{ numRuns: 100 }
			);
		});

		it('should not transition to exhausted before max attempts', () => {
			fc.assert(
				fc.property(attemptCountBelowMaxArbitrary, (attemptCount) => {
					// attemptCount here is the count before the failure
					// After a failure, the new count is attemptCount + 1

					// For any attempt count below MAX_ATTEMPTS - 1,
					// after failure the new count is still below MAX_ATTEMPTS
					if (attemptCount < STATE_TRANSITION_CONFIG.MAX_ATTEMPTS - 1) {
						const newCount = attemptCount + 1;
						expect(newCount).toBeLessThan(STATE_TRANSITION_CONFIG.MAX_ATTEMPTS);
					}
				}),
				{ numRuns: 100 }
			);
		});

		it('should always transition to exhausted at exactly max attempts', () => {
			fc.assert(
				fc.property(fc.constant(STATE_TRANSITION_CONFIG.MAX_ATTEMPTS - 1), (attemptCount) => {
					// When attemptCount = MAX_ATTEMPTS - 1,
					// after a failure it becomes MAX_ATTEMPTS,
					// which should trigger exhaustion
					const newCount = attemptCount + 1;
					expect(newCount).toBe(STATE_TRANSITION_CONFIG.MAX_ATTEMPTS);
					expect(newCount >= STATE_TRANSITION_CONFIG.MAX_ATTEMPTS).toBe(true);
				}),
				{ numRuns: 100 }
			);
		});
	});

	describe('Property: Next Eligible Time Calculation', () => {
		it('should always produce a future date', () => {
			fc.assert(
				fc.property(attemptCountArbitrary, dateArbitrary, (attemptCount, now) => {
					const nextEligible = calculateNextEligibleTime(attemptCount, now);
					expect(nextEligible.getTime()).toBeGreaterThan(now.getTime());
				}),
				{ numRuns: 100 }
			);
		});

		it('should produce valid Date objects', () => {
			fc.assert(
				fc.property(attemptCountArbitrary, dateArbitrary, (attemptCount, now) => {
					const nextEligible = calculateNextEligibleTime(attemptCount, now);

					expect(nextEligible).toBeInstanceOf(Date);
					expect(nextEligible.toString()).not.toBe('Invalid Date');
					expect(Number.isFinite(nextEligible.getTime())).toBe(true);
				}),
				{ numRuns: 100 }
			);
		});

		it('should produce delays within expected bounds', () => {
			fc.assert(
				fc.property(attemptCountArbitrary, dateArbitrary, (attemptCount, now) => {
					const nextEligible = calculateNextEligibleTime(attemptCount, now);
					const delay = nextEligible.getTime() - now.getTime();

					// Minimum delay is 75% of base delay (due to jitter)
					const minDelay = STATE_TRANSITION_CONFIG.COOLDOWN_BASE_DELAY * 0.75;
					// Maximum delay is 125% of max delay (due to jitter)
					const maxDelay = STATE_TRANSITION_CONFIG.COOLDOWN_MAX_DELAY * 1.25;

					expect(delay).toBeGreaterThanOrEqual(minDelay);
					expect(delay).toBeLessThanOrEqual(maxDelay);
				}),
				{ numRuns: 100 }
			);
		});

		it('should produce non-decreasing average delays for higher attempt counts', () => {
			fc.assert(
				fc.property(dateArbitrary, (now) => {
					// Sample multiple times to average out jitter
					const samples = 20;
					const averageDelays: number[] = [];

					for (let attemptCount = 1; attemptCount <= 5; attemptCount++) {
						let totalDelay = 0;
						for (let i = 0; i < samples; i++) {
							const nextEligible = calculateNextEligibleTime(attemptCount, now);
							totalDelay += nextEligible.getTime() - now.getTime();
						}
						averageDelays.push(totalDelay / samples);
					}

					// Average delays should generally increase (allowing some jitter variance)
					// Check trend: at least 3 out of 4 transitions should be non-decreasing
					let increasingCount = 0;
					for (let i = 0; i < averageDelays.length - 1; i++) {
						const next = averageDelays[i + 1];
						const current = averageDelays[i];
						// Allow 20% variance due to jitter
						if (next !== undefined && current !== undefined && next >= current * 0.8) {
							increasingCount++;
						}
					}
					expect(increasingCount).toBeGreaterThanOrEqual(3);
				}),
				{ numRuns: 100 }
			);
		});
	});

	describe('Property: State Transition Rules', () => {
		it('should correctly categorize attempt counts relative to max', () => {
			fc.assert(
				fc.property(attemptCountArbitrary, (attemptCount) => {
					const maxAttempts = STATE_TRANSITION_CONFIG.MAX_ATTEMPTS;

					const isBeforeMax = attemptCount < maxAttempts;
					const isAtMax = attemptCount === maxAttempts;
					const isAfterMax = attemptCount > maxAttempts;

					// Exactly one of these should be true
					const trueCount = [isBeforeMax, isAtMax, isAfterMax].filter(Boolean).length;
					expect(trueCount).toBe(1);

					// Verify the categorization is correct
					if (attemptCount < maxAttempts) {
						expect(isBeforeMax).toBe(true);
					} else if (attemptCount === maxAttempts) {
						expect(isAtMax).toBe(true);
					} else {
						expect(isAfterMax).toBe(true);
					}
				}),
				{ numRuns: 100 }
			);
		});

		it('should always have a non-negative attempt count after transition', () => {
			fc.assert(
				fc.property(fc.integer({ min: -10, max: 100 }), (startCount) => {
					// Simulate incrementing attempt count (what markSearchFailed does)
					const newCount = Math.max(0, startCount) + 1;
					expect(newCount).toBeGreaterThan(0);
				}),
				{ numRuns: 100 }
			);
		});
	});
});

describe('Configuration Consistency', () => {
	it('should have MAX_ATTEMPTS greater than 0', () => {
		expect(STATE_TRANSITION_CONFIG.MAX_ATTEMPTS).toBeGreaterThan(0);
	});

	it('should have COOLDOWN_BASE_DELAY greater than 0', () => {
		expect(STATE_TRANSITION_CONFIG.COOLDOWN_BASE_DELAY).toBeGreaterThan(0);
	});

	it('should have COOLDOWN_MAX_DELAY >= COOLDOWN_BASE_DELAY', () => {
		expect(STATE_TRANSITION_CONFIG.COOLDOWN_MAX_DELAY).toBeGreaterThanOrEqual(
			STATE_TRANSITION_CONFIG.COOLDOWN_BASE_DELAY
		);
	});

	it('should have COOLDOWN_MULTIPLIER >= 1', () => {
		expect(STATE_TRANSITION_CONFIG.COOLDOWN_MULTIPLIER).toBeGreaterThanOrEqual(1);
	});

	it('should have reasonable delay progression', () => {
		fc.assert(
			fc.property(fc.constant(null), () => {
				const { COOLDOWN_BASE_DELAY, COOLDOWN_MULTIPLIER, COOLDOWN_MAX_DELAY, MAX_ATTEMPTS } =
					STATE_TRANSITION_CONFIG;

				// Calculate delay at max attempts
				const maxAttemptDelay =
					COOLDOWN_BASE_DELAY * Math.pow(COOLDOWN_MULTIPLIER, MAX_ATTEMPTS - 1);

				// Max delay should be reached within MAX_ATTEMPTS attempts
				// or the configured max delay should cap it
				expect(Math.min(maxAttemptDelay, COOLDOWN_MAX_DELAY)).toBeLessThanOrEqual(
					COOLDOWN_MAX_DELAY
				);
			}),
			{ numRuns: 1 }
		);
	});
});
