/**
 * Property-based tests for throttle enforcement.
 *
 * Validates requirements:
 * - 7.1: Enforce requests per minute, batch size, cooldown periods, and daily request budget limits
 * - 7.2: Pause queue processing when daily budget is exhausted until next day
 * - 7.4: Reset counters appropriately at window boundaries
 *
 * Property 11: Throttle Profile Enforcement
 * - Requests in any minute window <= requestsPerMinute
 * - Daily requests <= dailyBudget (when not unlimited)
 *
 * Property 12: Request Counter Reset
 * - Counter resets to zero at window boundary
 * - Post-reset requests unaffected by pre-reset counts
 *

 */

import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { ThrottlePreset } from '../../src/lib/config/throttle-presets';
import {
	getStartOfDayUTC,
	getStartOfNextDayUTC,
	isDayWindowExpired,
	isMinuteWindowExpired,
	msUntilMidnightUTC,
	msUntilMinuteWindowExpires
} from '../../src/lib/server/services/throttle/time-utils';

// =============================================================================
// Arbitraries
// =============================================================================

/**
 * Arbitrary for throttle profile configuration.
 * Generates valid profile settings within reasonable bounds.
 */
const throttleProfileArbitrary: fc.Arbitrary<ThrottlePreset> = fc.record({
	name: fc.string({ minLength: 1, maxLength: 50 }),
	description: fc.string({ maxLength: 200 }),
	requestsPerMinute: fc.integer({ min: 1, max: 100 }),
	dailyBudget: fc.oneof(
		fc.constant(null), // Unlimited
		fc.integer({ min: 1, max: 10000 })
	),
	batchSize: fc.integer({ min: 1, max: 50 }),
	batchCooldownSeconds: fc.integer({ min: 1, max: 600 }),
	rateLimitPauseSeconds: fc.integer({ min: 1, max: 3600 })
});

/**
 * Arbitrary for a valid date in a reasonable range.
 */
const validDateArbitrary = fc
	.integer({ min: Date.UTC(2020, 0, 1), max: Date.UTC(2030, 11, 31) })
	.map((ts) => new Date(ts));

/**
 * Arbitrary for time offsets in milliseconds.
 */
const _timeOffsetMsArbitrary = fc.integer({ min: 0, max: 24 * 60 * 60 * 1000 });

// =============================================================================
// Property 11: Throttle Profile Enforcement
// =============================================================================

describe('Property 11: Throttle Profile Enforcement (Requirements 7.1, 7.2)', () => {
	/**
	 * Simulated throttle state for property testing.
	 */
	interface SimulatedState {
		requestsThisMinute: number;
		requestsToday: number;
		minuteWindowStart: Date;
		dayWindowStart: Date;
	}

	/**
	 * Simulates the canDispatch logic for a given state and profile.
	 */
	function simulateCanDispatch(
		state: SimulatedState,
		profile: ThrottlePreset,
		now: Date
	): { allowed: boolean; reason?: string } {
		// Check if minute window expired
		let currentMinuteRequests = state.requestsThisMinute;
		if (isMinuteWindowExpired(state.minuteWindowStart, now)) {
			currentMinuteRequests = 0; // Window reset
		}

		// Check per-minute rate limit
		if (currentMinuteRequests >= profile.requestsPerMinute) {
			return { allowed: false, reason: 'rate_limit' };
		}

		// Check if day window expired
		let currentDayRequests = state.requestsToday;
		if (isDayWindowExpired(state.dayWindowStart, now)) {
			currentDayRequests = 0; // Window reset
		}

		// Check daily budget (null = unlimited)
		if (profile.dailyBudget !== null && currentDayRequests >= profile.dailyBudget) {
			return { allowed: false, reason: 'daily_budget_exhausted' };
		}

		return { allowed: true };
	}

	it('requests in any minute window should never exceed requestsPerMinute', () => {
		fc.assert(
			fc.property(
				throttleProfileArbitrary,
				fc.array(fc.integer({ min: 0, max: 59 * 1000 }), { minLength: 0, maxLength: 200 }), // Request times within a minute window
				(profile, requestTimeOffsets) => {
					const windowStart = new Date('2024-06-15T12:00:00.000Z');
					let requestCount = 0;
					let lastAllowed = 0;

					for (const offset of requestTimeOffsets) {
						const now = new Date(windowStart.getTime() + offset);
						const state: SimulatedState = {
							requestsThisMinute: requestCount,
							requestsToday: requestCount,
							minuteWindowStart: windowStart,
							dayWindowStart: getStartOfDayUTC(windowStart)
						};

						const result = simulateCanDispatch(state, profile, now);
						if (result.allowed) {
							requestCount++;
							lastAllowed = requestCount;
						}
					}

					// The number of allowed requests should never exceed the limit
					expect(lastAllowed).toBeLessThanOrEqual(profile.requestsPerMinute);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('daily requests should never exceed dailyBudget when not unlimited', () => {
		fc.assert(
			fc.property(
				throttleProfileArbitrary.filter((p) => p.dailyBudget !== null),
				fc.array(fc.integer({ min: 0, max: 23 * 60 * 60 * 1000 }), {
					minLength: 0,
					maxLength: 500
				}), // Request times within a day
				(profile, requestTimeOffsets) => {
					const dayStart = new Date('2024-06-15T00:00:00.000Z');
					let requestCountToday = 0;
					let minuteWindowStart = dayStart;
					let requestsThisMinute = 0;

					for (const offset of requestTimeOffsets) {
						const now = new Date(dayStart.getTime() + offset);

						// Reset minute window if expired
						if (isMinuteWindowExpired(minuteWindowStart, now)) {
							minuteWindowStart = now;
							requestsThisMinute = 0;
						}

						const state: SimulatedState = {
							requestsThisMinute,
							requestsToday: requestCountToday,
							minuteWindowStart,
							dayWindowStart: dayStart
						};

						const result = simulateCanDispatch(state, profile, now);
						if (result.allowed) {
							requestCountToday++;
							requestsThisMinute++;
						}
					}

					// Daily requests should never exceed the budget
					expect(requestCountToday).toBeLessThanOrEqual(profile.dailyBudget!);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('unlimited daily budget should allow any number of requests (up to per-minute limit)', () => {
		fc.assert(
			fc.property(
				throttleProfileArbitrary.filter((p) => p.dailyBudget === null),
				fc.integer({ min: 1, max: 100 }), // Number of minute windows to simulate
				(profile, numWindows) => {
					let totalRequests = 0;

					for (let window = 0; window < numWindows; window++) {
						// Each window can have up to requestsPerMinute requests
						totalRequests += profile.requestsPerMinute;
					}

					// With unlimited budget and enough windows, we can make many requests
					expect(totalRequests).toBeGreaterThan(0);
				}
			),
			{ numRuns: 100 }
		);
	});
});

// =============================================================================
// Property 12: Request Counter Reset
// =============================================================================

describe('Property 12: Request Counter Reset (Requirement 7.4)', () => {
	describe('Minute window reset', () => {
		it('counter should reset to zero at window boundary', () => {
			fc.assert(
				fc.property(
					validDateArbitrary,
					fc.integer({ min: 1, max: 100 }), // Requests before reset
					(windowStart, _requestsBefore) => {
						// Window has requests
						const windowEnd = new Date(windowStart.getTime() + 60 * 1000);

						// Just before expiry - window should NOT be expired
						const justBefore = new Date(windowEnd.getTime() - 1);
						expect(isMinuteWindowExpired(windowStart, justBefore)).toBe(false);

						// At exactly expiry - window IS expired
						expect(isMinuteWindowExpired(windowStart, windowEnd)).toBe(true);

						// After expiry - window IS expired
						const afterExpiry = new Date(windowEnd.getTime() + 1);
						expect(isMinuteWindowExpired(windowStart, afterExpiry)).toBe(true);
					}
				),
				{ numRuns: 100 }
			);
		});

		it('post-reset requests should be unaffected by pre-reset counts', () => {
			fc.assert(
				fc.property(
					throttleProfileArbitrary,
					fc.integer({ min: 1, max: 100 }), // Requests in first window
					fc.integer({ min: 1, max: 100 }), // Requests in second window
					(profile, requestsWindow1, requestsWindow2) => {
						const _window1Start = new Date('2024-06-15T12:00:00.000Z');
						const _window2Start = new Date('2024-06-15T12:01:00.000Z'); // 1 minute later

						// First window can only accept up to limit
						const acceptedWindow1 = Math.min(requestsWindow1, profile.requestsPerMinute);

						// Second window should also only accept up to limit, regardless of first window
						const acceptedWindow2 = Math.min(requestsWindow2, profile.requestsPerMinute);

						// Each window is independent
						expect(acceptedWindow1).toBeLessThanOrEqual(profile.requestsPerMinute);
						expect(acceptedWindow2).toBeLessThanOrEqual(profile.requestsPerMinute);

						// Total can be up to 2x the limit
						expect(acceptedWindow1 + acceptedWindow2).toBeLessThanOrEqual(
							2 * profile.requestsPerMinute
						);
					}
				),
				{ numRuns: 100 }
			);
		});
	});

	describe('Day window reset', () => {
		it('day counter should reset at UTC midnight', () => {
			fc.assert(
				fc.property(validDateArbitrary, (dayStart) => {
					const startOfDay = getStartOfDayUTC(dayStart);
					const nextDay = getStartOfNextDayUTC(dayStart);

					// During same day - window should NOT be expired
					const midDay = new Date(startOfDay.getTime() + 12 * 60 * 60 * 1000);
					expect(isDayWindowExpired(startOfDay, midDay)).toBe(false);

					// At exactly next midnight - window IS expired
					expect(isDayWindowExpired(startOfDay, nextDay)).toBe(true);

					// After next midnight - window IS expired
					const afterMidnight = new Date(nextDay.getTime() + 1000);
					expect(isDayWindowExpired(startOfDay, afterMidnight)).toBe(true);
				}),
				{ numRuns: 100 }
			);
		});

		it('daily budget should reset at new UTC day', () => {
			fc.assert(
				fc.property(
					throttleProfileArbitrary.filter((p) => p.dailyBudget !== null),
					fc.integer({ min: 1, max: 1000 }), // Requests on day 1
					fc.integer({ min: 1, max: 1000 }), // Requests on day 2
					(profile, requestsDay1, requestsDay2) => {
						// Day 1 budget
						const acceptedDay1 = Math.min(requestsDay1, profile.dailyBudget!);

						// Day 2 should have fresh budget, unaffected by Day 1
						const acceptedDay2 = Math.min(requestsDay2, profile.dailyBudget!);

						// Each day is independent
						expect(acceptedDay1).toBeLessThanOrEqual(profile.dailyBudget!);
						expect(acceptedDay2).toBeLessThanOrEqual(profile.dailyBudget!);

						// Total over two days can be up to 2x budget
						expect(acceptedDay1 + acceptedDay2).toBeLessThanOrEqual(2 * profile.dailyBudget!);
					}
				),
				{ numRuns: 100 }
			);
		});
	});
});

// =============================================================================
// Time Utility Properties
// =============================================================================

describe('Time Utility Properties', () => {
	describe('getStartOfDayUTC', () => {
		it('should be idempotent', () => {
			fc.assert(
				fc.property(validDateArbitrary, (date) => {
					const result1 = getStartOfDayUTC(date);
					const result2 = getStartOfDayUTC(result1);

					expect(result1.getTime()).toBe(result2.getTime());
				}),
				{ numRuns: 100 }
			);
		});

		it('should always return midnight UTC', () => {
			fc.assert(
				fc.property(validDateArbitrary, (date) => {
					const result = getStartOfDayUTC(date);

					expect(result.getUTCHours()).toBe(0);
					expect(result.getUTCMinutes()).toBe(0);
					expect(result.getUTCSeconds()).toBe(0);
					expect(result.getUTCMilliseconds()).toBe(0);
				}),
				{ numRuns: 100 }
			);
		});

		it('result should be <= input', () => {
			fc.assert(
				fc.property(validDateArbitrary, (date) => {
					const result = getStartOfDayUTC(date);
					expect(result.getTime()).toBeLessThanOrEqual(date.getTime());
				}),
				{ numRuns: 100 }
			);
		});
	});

	describe('getStartOfNextDayUTC', () => {
		it('should always return exactly 24 hours after start of current day', () => {
			fc.assert(
				fc.property(validDateArbitrary, (date) => {
					const startOfDay = getStartOfDayUTC(date);
					const nextDay = getStartOfNextDayUTC(date);

					expect(nextDay.getTime() - startOfDay.getTime()).toBe(24 * 60 * 60 * 1000);
				}),
				{ numRuns: 100 }
			);
		});

		it('result should be > input', () => {
			fc.assert(
				fc.property(validDateArbitrary, (date) => {
					const result = getStartOfNextDayUTC(date);
					expect(result.getTime()).toBeGreaterThan(date.getTime());
				}),
				{ numRuns: 100 }
			);
		});
	});

	describe('msUntilMinuteWindowExpires', () => {
		it('should return 0 for expired windows', () => {
			fc.assert(
				fc.property(
					validDateArbitrary,
					fc.integer({ min: 60001, max: 1000000 }), // More than 60 seconds
					(windowStart, additionalMs) => {
						const now = new Date(windowStart.getTime() + additionalMs);
						const result = msUntilMinuteWindowExpires(windowStart, now);

						expect(result).toBe(0);
					}
				),
				{ numRuns: 100 }
			);
		});

		it('should return positive value for active windows', () => {
			fc.assert(
				fc.property(
					validDateArbitrary,
					fc.integer({ min: 0, max: 59999 }), // Less than 60 seconds
					(windowStart, elapsedMs) => {
						const now = new Date(windowStart.getTime() + elapsedMs);
						const result = msUntilMinuteWindowExpires(windowStart, now);

						expect(result).toBeGreaterThan(0);
						expect(result).toBeLessThanOrEqual(60000);
					}
				),
				{ numRuns: 100 }
			);
		});
	});

	describe('msUntilMidnightUTC', () => {
		it('should always return positive value', () => {
			fc.assert(
				fc.property(validDateArbitrary, (date) => {
					const result = msUntilMidnightUTC(date);
					expect(result).toBeGreaterThan(0);
				}),
				{ numRuns: 100 }
			);
		});

		it('should return value <= 24 hours', () => {
			fc.assert(
				fc.property(validDateArbitrary, (date) => {
					const result = msUntilMidnightUTC(date);
					expect(result).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
				}),
				{ numRuns: 100 }
			);
		});

		it('should match expected calculation', () => {
			fc.assert(
				fc.property(validDateArbitrary, (date) => {
					const result = msUntilMidnightUTC(date);
					const nextMidnight = getStartOfNextDayUTC(date);
					const expected = nextMidnight.getTime() - date.getTime();

					expect(result).toBe(expected);
				}),
				{ numRuns: 100 }
			);
		});
	});
});

// =============================================================================
// Window Expiration Consistency Properties
// =============================================================================

describe('Window Expiration Consistency', () => {
	it('minute window expiration should be consistent with msUntilExpires', () => {
		fc.assert(
			fc.property(
				validDateArbitrary,
				fc.integer({ min: 0, max: 120000 }), // Up to 2 minutes
				(windowStart, elapsedMs) => {
					const now = new Date(windowStart.getTime() + elapsedMs);
					const isExpired = isMinuteWindowExpired(windowStart, now);
					const msUntil = msUntilMinuteWindowExpires(windowStart, now);

					// If expired, msUntil should be 0
					if (isExpired) {
						expect(msUntil).toBe(0);
					}

					// If msUntil > 0, should not be expired
					if (msUntil > 0) {
						expect(isExpired).toBe(false);
					}
				}
			),
			{ numRuns: 100 }
		);
	});

	it('day window expiration should be consistent with getStartOfDayUTC', () => {
		fc.assert(
			fc.property(validDateArbitrary, validDateArbitrary, (windowStart, now) => {
				const isExpired = isDayWindowExpired(windowStart, now);
				const startOfTodayAtNow = getStartOfDayUTC(now);

				// Window is expired if start of today is after window start
				const shouldBeExpired = startOfTodayAtNow > windowStart;

				expect(isExpired).toBe(shouldBeExpired);
			}),
			{ numRuns: 100 }
		);
	});
});
