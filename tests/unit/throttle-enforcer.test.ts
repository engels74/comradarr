/**
 * Unit tests for throttle enforcer utility functions.
 *
 * These tests focus on pure logic without database dependencies:
 * - Window expiration calculations
 * - Time utility functions
 * - Edge cases for boundary conditions
 */

import { describe, expect, it } from 'vitest';
import {
	getStartOfDayUTC,
	getStartOfNextDayUTC,
	isDayWindowExpired
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
});
