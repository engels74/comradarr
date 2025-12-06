/**
 * Unit tests for throttle enforcer utility functions.
 *
 * These tests focus on pure logic without database dependencies:
 * - Window expiration calculations
 * - Time utility functions
 * - Edge cases for boundary conditions
 */

import { describe, it, expect } from 'vitest';
import {
	getStartOfDayUTC,
	getStartOfNextDayUTC,
	isMinuteWindowExpired,
	isDayWindowExpired,
	msUntilMinuteWindowExpires,
	msUntilMidnightUTC
} from '../../src/lib/server/services/throttle/time-utils';

describe('Throttle Utility Functions', () => {
	describe('getStartOfDayUTC', () => {
		it('should return midnight UTC for a given date', () => {
			const date = new Date('2024-06-15T14:30:45.123Z');
			const result = getStartOfDayUTC(date);

			expect(result.getUTCFullYear()).toBe(2024);
			expect(result.getUTCMonth()).toBe(5); // June (0-indexed)
			expect(result.getUTCDate()).toBe(15);
			expect(result.getUTCHours()).toBe(0);
			expect(result.getUTCMinutes()).toBe(0);
			expect(result.getUTCSeconds()).toBe(0);
			expect(result.getUTCMilliseconds()).toBe(0);
		});

		it('should handle date already at midnight', () => {
			const date = new Date('2024-06-15T00:00:00.000Z');
			const result = getStartOfDayUTC(date);

			expect(result.getTime()).toBe(date.getTime());
		});

		it('should handle end of day', () => {
			const date = new Date('2024-06-15T23:59:59.999Z');
			const result = getStartOfDayUTC(date);

			expect(result.getUTCDate()).toBe(15);
			expect(result.getUTCHours()).toBe(0);
		});

		it('should handle year boundary', () => {
			const date = new Date('2024-01-01T12:00:00.000Z');
			const result = getStartOfDayUTC(date);

			expect(result.getUTCFullYear()).toBe(2024);
			expect(result.getUTCMonth()).toBe(0);
			expect(result.getUTCDate()).toBe(1);
		});
	});

	describe('getStartOfNextDayUTC', () => {
		it('should return midnight UTC of the next day', () => {
			const date = new Date('2024-06-15T14:30:45.123Z');
			const result = getStartOfNextDayUTC(date);

			expect(result.getUTCFullYear()).toBe(2024);
			expect(result.getUTCMonth()).toBe(5);
			expect(result.getUTCDate()).toBe(16);
			expect(result.getUTCHours()).toBe(0);
			expect(result.getUTCMinutes()).toBe(0);
		});

		it('should handle end of month', () => {
			const date = new Date('2024-06-30T14:30:00.000Z');
			const result = getStartOfNextDayUTC(date);

			expect(result.getUTCMonth()).toBe(6); // July
			expect(result.getUTCDate()).toBe(1);
		});

		it('should handle end of year', () => {
			const date = new Date('2024-12-31T14:30:00.000Z');
			const result = getStartOfNextDayUTC(date);

			expect(result.getUTCFullYear()).toBe(2025);
			expect(result.getUTCMonth()).toBe(0);
			expect(result.getUTCDate()).toBe(1);
		});

		it('should handle leap year', () => {
			const date = new Date('2024-02-28T14:30:00.000Z');
			const result = getStartOfNextDayUTC(date);

			expect(result.getUTCMonth()).toBe(1); // February
			expect(result.getUTCDate()).toBe(29); // 2024 is a leap year
		});
	});

	describe('isMinuteWindowExpired', () => {
		it('should return true for null windowStart', () => {
			expect(isMinuteWindowExpired(null)).toBe(true);
		});

		it('should return false for recent window', () => {
			const now = new Date();
			const windowStart = new Date(now.getTime() - 30 * 1000); // 30 seconds ago
			expect(isMinuteWindowExpired(windowStart, now)).toBe(false);
		});

		it('should return true for expired window (exactly 60 seconds)', () => {
			const now = new Date();
			const windowStart = new Date(now.getTime() - 60 * 1000); // Exactly 60 seconds ago
			expect(isMinuteWindowExpired(windowStart, now)).toBe(true);
		});

		it('should return true for window older than 60 seconds', () => {
			const now = new Date();
			const windowStart = new Date(now.getTime() - 90 * 1000); // 90 seconds ago
			expect(isMinuteWindowExpired(windowStart, now)).toBe(true);
		});

		it('should return false for window at 59.999 seconds', () => {
			const now = new Date();
			const windowStart = new Date(now.getTime() - 59999); // 59.999 seconds ago
			expect(isMinuteWindowExpired(windowStart, now)).toBe(false);
		});
	});

	describe('isDayWindowExpired', () => {
		it('should return true for null windowStart', () => {
			expect(isDayWindowExpired(null)).toBe(true);
		});

		it('should return false for window from today', () => {
			const now = new Date('2024-06-15T14:30:00.000Z');
			const windowStart = new Date('2024-06-15T00:00:00.000Z'); // Today midnight
			expect(isDayWindowExpired(windowStart, now)).toBe(false);
		});

		it('should return true for window from yesterday', () => {
			const now = new Date('2024-06-15T14:30:00.000Z');
			const windowStart = new Date('2024-06-14T00:00:00.000Z'); // Yesterday midnight
			expect(isDayWindowExpired(windowStart, now)).toBe(true);
		});

		it('should return true at midnight crossing', () => {
			const now = new Date('2024-06-16T00:00:01.000Z'); // Just past midnight
			const windowStart = new Date('2024-06-15T00:00:00.000Z'); // Yesterday
			expect(isDayWindowExpired(windowStart, now)).toBe(true);
		});

		it('should return false just before midnight', () => {
			const now = new Date('2024-06-15T23:59:59.999Z');
			const windowStart = new Date('2024-06-15T00:00:00.000Z');
			expect(isDayWindowExpired(windowStart, now)).toBe(false);
		});

		it('should return true for old window', () => {
			const now = new Date('2024-06-15T14:30:00.000Z');
			const windowStart = new Date('2024-06-01T00:00:00.000Z'); // Two weeks ago
			expect(isDayWindowExpired(windowStart, now)).toBe(true);
		});
	});

	describe('msUntilMinuteWindowExpires', () => {
		it('should return 0 for null windowStart', () => {
			expect(msUntilMinuteWindowExpires(null)).toBe(0);
		});

		it('should return 0 for expired window', () => {
			const now = new Date();
			const windowStart = new Date(now.getTime() - 90 * 1000); // 90 seconds ago
			expect(msUntilMinuteWindowExpires(windowStart, now)).toBe(0);
		});

		it('should return remaining time for active window', () => {
			const now = new Date();
			const windowStart = new Date(now.getTime() - 30 * 1000); // 30 seconds ago
			const result = msUntilMinuteWindowExpires(windowStart, now);

			// Should be approximately 30 seconds remaining
			expect(result).toBeGreaterThan(29000);
			expect(result).toBeLessThanOrEqual(30000);
		});

		it('should return 60 seconds for window that just started', () => {
			const now = new Date();
			const windowStart = new Date(now.getTime()); // Just now
			const result = msUntilMinuteWindowExpires(windowStart, now);

			expect(result).toBe(60000);
		});

		it('should return 1ms for window about to expire', () => {
			const now = new Date();
			const windowStart = new Date(now.getTime() - 59999); // 59.999 seconds ago
			const result = msUntilMinuteWindowExpires(windowStart, now);

			expect(result).toBe(1);
		});
	});

	describe('msUntilMidnightUTC', () => {
		it('should calculate time until midnight for morning', () => {
			const now = new Date('2024-06-15T06:00:00.000Z');
			const result = msUntilMidnightUTC(now);

			// 18 hours until midnight
			expect(result).toBe(18 * 60 * 60 * 1000);
		});

		it('should calculate time until midnight for evening', () => {
			const now = new Date('2024-06-15T22:00:00.000Z');
			const result = msUntilMidnightUTC(now);

			// 2 hours until midnight
			expect(result).toBe(2 * 60 * 60 * 1000);
		});

		it('should return 24 hours at midnight', () => {
			const now = new Date('2024-06-15T00:00:00.000Z');
			const result = msUntilMidnightUTC(now);

			// Full 24 hours until next midnight
			expect(result).toBe(24 * 60 * 60 * 1000);
		});

		it('should return ~1ms just before midnight', () => {
			const now = new Date('2024-06-15T23:59:59.999Z');
			const result = msUntilMidnightUTC(now);

			expect(result).toBe(1);
		});

		it('should handle end of month correctly', () => {
			const now = new Date('2024-06-30T12:00:00.000Z');
			const result = msUntilMidnightUTC(now);

			// 12 hours until July 1st midnight
			expect(result).toBe(12 * 60 * 60 * 1000);
		});
	});
});

describe('Edge Cases and Boundary Conditions', () => {
	describe('Timezone handling', () => {
		it('should handle dates in different timezones consistently', () => {
			// All should resolve to the same UTC midnight
			const date1 = new Date('2024-06-15T00:00:00.000Z');
			const date2 = new Date('2024-06-15T12:00:00.000Z');
			const date3 = new Date('2024-06-15T23:59:59.999Z');

			const result1 = getStartOfDayUTC(date1);
			const result2 = getStartOfDayUTC(date2);
			const result3 = getStartOfDayUTC(date3);

			expect(result1.getTime()).toBe(result2.getTime());
			expect(result2.getTime()).toBe(result3.getTime());
		});
	});

	describe('Leap second edge cases', () => {
		it('should handle dates near year boundaries', () => {
			const newYearsEve = new Date('2024-12-31T23:59:59.999Z');
			const nextDay = getStartOfNextDayUTC(newYearsEve);

			expect(nextDay.getUTCFullYear()).toBe(2025);
			expect(nextDay.getUTCMonth()).toBe(0);
			expect(nextDay.getUTCDate()).toBe(1);
		});
	});

	describe('Window boundary precision', () => {
		it('isMinuteWindowExpired should be precise at 60000ms boundary', () => {
			const now = new Date(1000000060000); // Arbitrary base time + 60000ms
			const windowStart = new Date(1000000000000); // Exactly 60000ms earlier

			// At exactly 60 seconds, window is expired
			expect(isMinuteWindowExpired(windowStart, now)).toBe(true);

			// At 59999ms, window is not expired
			const almostNow = new Date(now.getTime() - 1);
			expect(isMinuteWindowExpired(windowStart, almostNow)).toBe(false);
		});
	});
});
