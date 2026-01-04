/**
 * Unit tests for quiet hours utility functions.
 *
 * Tests cover:
 * - parseTimeString() with valid and invalid formats
 * - getCurrentTimeInTimezone() with different timezones
 * - timeToMinutes() conversion
 * - isTimeInRange() with same-day and midnight-spanning ranges
 * - isInQuietHours() with various channel configurations
 * - Edge cases and boundary conditions
 *

 */

import { describe, it, expect, vi } from 'vitest';
import {
	parseTimeString,
	getCurrentTimeInTimezone,
	timeToMinutes,
	isTimeInRange,
	isInQuietHours,
	type TimeOfDay
} from '../../src/lib/server/services/notifications/quiet-hours';
import type { NotificationChannel } from '../../src/lib/server/db/schema';

/**
 * Helper to create a mock notification channel with quiet hours configuration.
 */
function createMockChannel(overrides: Partial<NotificationChannel> = {}): NotificationChannel {
	return {
		id: 1,
		name: 'Test Channel',
		type: 'discord',
		config: null,
		configEncrypted: null,
		enabled: true,
		enabledEvents: null,
		batchingEnabled: false,
		batchingWindowSeconds: 60,
		quietHoursEnabled: false,
		quietHoursStart: null,
		quietHoursEnd: null,
		quietHoursTimezone: 'UTC',
		createdAt: new Date(),
		updatedAt: new Date(),
		...overrides
	};
}

/**
 * Helper to create a Date at a specific UTC time.
 */
function createUTCDate(hours: number, minutes: number): Date {
	const date = new Date('2024-07-15T00:00:00Z');
	date.setUTCHours(hours, minutes, 0, 0);
	return date;
}

describe('parseTimeString', () => {
	describe('valid formats', () => {
		it('should parse "22:00" correctly', () => {
			const result = parseTimeString('22:00');
			expect(result).toEqual({ hours: 22, minutes: 0 });
		});

		it('should parse "08:30" correctly', () => {
			const result = parseTimeString('08:30');
			expect(result).toEqual({ hours: 8, minutes: 30 });
		});

		it('should parse "00:00" (midnight) correctly', () => {
			const result = parseTimeString('00:00');
			expect(result).toEqual({ hours: 0, minutes: 0 });
		});

		it('should parse "23:59" correctly', () => {
			const result = parseTimeString('23:59');
			expect(result).toEqual({ hours: 23, minutes: 59 });
		});

		it('should parse single-digit hours like "8:00"', () => {
			const result = parseTimeString('8:00');
			expect(result).toEqual({ hours: 8, minutes: 0 });
		});
	});

	describe('invalid formats', () => {
		it('should throw for empty string', () => {
			expect(() => parseTimeString('')).toThrow('Time string is required');
		});

		it('should throw for null/undefined', () => {
			expect(() => parseTimeString(null as unknown as string)).toThrow('Time string is required');
			expect(() => parseTimeString(undefined as unknown as string)).toThrow(
				'Time string is required'
			);
		});

		it('should throw for invalid format "22-00"', () => {
			expect(() => parseTimeString('22-00')).toThrow('Invalid time format');
		});

		it('should throw for invalid format "22:0"', () => {
			expect(() => parseTimeString('22:0')).toThrow('Invalid time format');
		});

		it('should throw for hours > 23', () => {
			expect(() => parseTimeString('24:00')).toThrow('Invalid hours');
		});

		it('should throw for hours < 0', () => {
			expect(() => parseTimeString('-1:00')).toThrow('Invalid time format');
		});

		it('should throw for minutes > 59', () => {
			expect(() => parseTimeString('22:60')).toThrow('Invalid minutes');
		});

		it('should throw for non-numeric values', () => {
			expect(() => parseTimeString('ab:cd')).toThrow('Invalid time format');
		});
	});
});

describe('timeToMinutes', () => {
	it('should convert midnight (00:00) to 0', () => {
		expect(timeToMinutes({ hours: 0, minutes: 0 })).toBe(0);
	});

	it('should convert 01:00 to 60', () => {
		expect(timeToMinutes({ hours: 1, minutes: 0 })).toBe(60);
	});

	it('should convert 12:30 to 750', () => {
		expect(timeToMinutes({ hours: 12, minutes: 30 })).toBe(750);
	});

	it('should convert 23:59 to 1439', () => {
		expect(timeToMinutes({ hours: 23, minutes: 59 })).toBe(1439);
	});
});

describe('getCurrentTimeInTimezone', () => {
	it('should return UTC time for UTC timezone', () => {
		const date = createUTCDate(14, 30);
		const result = getCurrentTimeInTimezone('UTC', date);
		expect(result).toEqual({ hours: 14, minutes: 30 });
	});

	it('should convert to different timezone', () => {
		// At 14:30 UTC, America/New_York would be either 9:30 or 10:30 depending on DST
		// Using a fixed date in July (EDT, UTC-4)
		const date = new Date('2024-07-15T14:30:00Z');
		const result = getCurrentTimeInTimezone('America/New_York', date);
		// EDT is UTC-4, so 14:30 UTC = 10:30 EDT
		expect(result).toEqual({ hours: 10, minutes: 30 });
	});

	it('should handle Europe/London timezone', () => {
		// In July, UK is on BST (UTC+1)
		const date = new Date('2024-07-15T14:30:00Z');
		const result = getCurrentTimeInTimezone('Europe/London', date);
		// BST is UTC+1, so 14:30 UTC = 15:30 BST
		expect(result).toEqual({ hours: 15, minutes: 30 });
	});

	it('should fall back to UTC for invalid timezone', () => {
		// Invalid timezones fall back to UTC and log a warning via the structured logger
		const date = createUTCDate(14, 30);
		const result = getCurrentTimeInTimezone('Invalid/Timezone', date);
		expect(result).toEqual({ hours: 14, minutes: 30 });
	});
});

describe('isTimeInRange', () => {
	describe('same-day range', () => {
		// Range: 13:00 - 15:00 (afternoon)
		const start: TimeOfDay = { hours: 13, minutes: 0 };
		const end: TimeOfDay = { hours: 15, minutes: 0 };

		it('should return true for time within range', () => {
			expect(isTimeInRange({ hours: 14, minutes: 0 }, start, end)).toBe(true);
			expect(isTimeInRange({ hours: 14, minutes: 30 }, start, end)).toBe(true);
		});

		it('should return true at exactly start time (inclusive)', () => {
			expect(isTimeInRange({ hours: 13, minutes: 0 }, start, end)).toBe(true);
		});

		it('should return false at exactly end time (exclusive)', () => {
			expect(isTimeInRange({ hours: 15, minutes: 0 }, start, end)).toBe(false);
		});

		it('should return false for time before range', () => {
			expect(isTimeInRange({ hours: 12, minutes: 0 }, start, end)).toBe(false);
			expect(isTimeInRange({ hours: 12, minutes: 59 }, start, end)).toBe(false);
		});

		it('should return false for time after range', () => {
			expect(isTimeInRange({ hours: 15, minutes: 1 }, start, end)).toBe(false);
			expect(isTimeInRange({ hours: 20, minutes: 0 }, start, end)).toBe(false);
		});
	});

	describe('midnight-spanning range', () => {
		// Range: 22:00 - 08:00 (night to morning)
		const start: TimeOfDay = { hours: 22, minutes: 0 };
		const end: TimeOfDay = { hours: 8, minutes: 0 };

		it('should return true for time in evening part', () => {
			expect(isTimeInRange({ hours: 22, minutes: 0 }, start, end)).toBe(true);
			expect(isTimeInRange({ hours: 23, minutes: 0 }, start, end)).toBe(true);
			expect(isTimeInRange({ hours: 23, minutes: 59 }, start, end)).toBe(true);
		});

		it('should return true for time in morning part', () => {
			expect(isTimeInRange({ hours: 0, minutes: 0 }, start, end)).toBe(true);
			expect(isTimeInRange({ hours: 3, minutes: 0 }, start, end)).toBe(true);
			expect(isTimeInRange({ hours: 7, minutes: 59 }, start, end)).toBe(true);
		});

		it('should return false at exactly end time (exclusive)', () => {
			expect(isTimeInRange({ hours: 8, minutes: 0 }, start, end)).toBe(false);
		});

		it('should return false for time in daytime gap', () => {
			expect(isTimeInRange({ hours: 8, minutes: 1 }, start, end)).toBe(false);
			expect(isTimeInRange({ hours: 12, minutes: 0 }, start, end)).toBe(false);
			expect(isTimeInRange({ hours: 18, minutes: 0 }, start, end)).toBe(false);
			expect(isTimeInRange({ hours: 21, minutes: 59 }, start, end)).toBe(false);
		});
	});

	describe('edge cases', () => {
		it('should handle range of entire day', () => {
			// 00:00 to 00:00 - would be 0 minutes range (empty), handled as same-day
			const start: TimeOfDay = { hours: 0, minutes: 0 };
			const end: TimeOfDay = { hours: 0, minutes: 0 };
			// Same start and end = empty range (start <= end, but no time satisfies current >= start AND current < end when they're equal)
			expect(isTimeInRange({ hours: 12, minutes: 0 }, start, end)).toBe(false);
		});

		it('should handle 1-minute range', () => {
			const start: TimeOfDay = { hours: 12, minutes: 0 };
			const end: TimeOfDay = { hours: 12, minutes: 1 };
			expect(isTimeInRange({ hours: 12, minutes: 0 }, start, end)).toBe(true);
			expect(isTimeInRange({ hours: 12, minutes: 1 }, start, end)).toBe(false);
		});
	});
});

describe('isInQuietHours', () => {
	describe('when quiet hours are disabled', () => {
		it('should return false when quietHoursEnabled is false', () => {
			const channel = createMockChannel({
				quietHoursEnabled: false,
				quietHoursStart: '22:00',
				quietHoursEnd: '08:00'
			});
			const now = createUTCDate(23, 0); // Would be in range if enabled

			expect(isInQuietHours(channel, now)).toBe(false);
		});
	});

	describe('when quiet hours config is missing', () => {
		it('should return false when quietHoursStart is null', () => {
			const channel = createMockChannel({
				quietHoursEnabled: true,
				quietHoursStart: null,
				quietHoursEnd: '08:00'
			});

			expect(isInQuietHours(channel, new Date())).toBe(false);
		});

		it('should return false when quietHoursEnd is null', () => {
			const channel = createMockChannel({
				quietHoursEnabled: true,
				quietHoursStart: '22:00',
				quietHoursEnd: null
			});

			expect(isInQuietHours(channel, new Date())).toBe(false);
		});
	});

	describe('when quiet hours config is invalid', () => {
		it('should return false and log warning for invalid start time', () => {
			// Invalid configs return false and log a warning via the structured logger
			const channel = createMockChannel({
				quietHoursEnabled: true,
				quietHoursStart: 'invalid',
				quietHoursEnd: '08:00'
			});

			expect(isInQuietHours(channel, new Date())).toBe(false);
		});

		it('should return false and log warning for invalid end time', () => {
			// Invalid configs return false and log a warning via the structured logger
			const channel = createMockChannel({
				quietHoursEnabled: true,
				quietHoursStart: '22:00',
				quietHoursEnd: 'invalid'
			});

			expect(isInQuietHours(channel, new Date())).toBe(false);
		});
	});

	describe('with valid quiet hours configuration', () => {
		describe('same-day range (13:00-15:00 UTC)', () => {
			const channel = createMockChannel({
				quietHoursEnabled: true,
				quietHoursStart: '13:00',
				quietHoursEnd: '15:00',
				quietHoursTimezone: 'UTC'
			});

			it('should return true during quiet hours', () => {
				expect(isInQuietHours(channel, createUTCDate(14, 0))).toBe(true);
				expect(isInQuietHours(channel, createUTCDate(14, 30))).toBe(true);
			});

			it('should return true at exactly start time', () => {
				expect(isInQuietHours(channel, createUTCDate(13, 0))).toBe(true);
			});

			it('should return false at exactly end time', () => {
				expect(isInQuietHours(channel, createUTCDate(15, 0))).toBe(false);
			});

			it('should return false outside quiet hours', () => {
				expect(isInQuietHours(channel, createUTCDate(12, 0))).toBe(false);
				expect(isInQuietHours(channel, createUTCDate(16, 0))).toBe(false);
			});
		});

		describe('midnight-spanning range (22:00-08:00 UTC)', () => {
			const channel = createMockChannel({
				quietHoursEnabled: true,
				quietHoursStart: '22:00',
				quietHoursEnd: '08:00',
				quietHoursTimezone: 'UTC'
			});

			it('should return true in evening part', () => {
				expect(isInQuietHours(channel, createUTCDate(22, 0))).toBe(true);
				expect(isInQuietHours(channel, createUTCDate(23, 0))).toBe(true);
				expect(isInQuietHours(channel, createUTCDate(23, 59))).toBe(true);
			});

			it('should return true in morning part', () => {
				expect(isInQuietHours(channel, createUTCDate(0, 0))).toBe(true);
				expect(isInQuietHours(channel, createUTCDate(3, 0))).toBe(true);
				expect(isInQuietHours(channel, createUTCDate(7, 59))).toBe(true);
			});

			it('should return false at exactly end time', () => {
				expect(isInQuietHours(channel, createUTCDate(8, 0))).toBe(false);
			});

			it('should return false during daytime', () => {
				expect(isInQuietHours(channel, createUTCDate(8, 1))).toBe(false);
				expect(isInQuietHours(channel, createUTCDate(12, 0))).toBe(false);
				expect(isInQuietHours(channel, createUTCDate(18, 0))).toBe(false);
				expect(isInQuietHours(channel, createUTCDate(21, 59))).toBe(false);
			});
		});

		describe('timezone handling', () => {
			it('should respect channel timezone', () => {
				// Channel is configured for America/New_York (EDT, UTC-4 in July)
				// Quiet hours 22:00-08:00 New York time
				const channel = createMockChannel({
					quietHoursEnabled: true,
					quietHoursStart: '22:00',
					quietHoursEnd: '08:00',
					quietHoursTimezone: 'America/New_York'
				});

				// 02:00 UTC = 22:00 EDT (in quiet hours)
				const inQuietHours = new Date('2024-07-15T02:00:00Z');
				expect(isInQuietHours(channel, inQuietHours)).toBe(true);

				// 18:00 UTC = 14:00 EDT (not in quiet hours)
				const notInQuietHours = new Date('2024-07-15T18:00:00Z');
				expect(isInQuietHours(channel, notInQuietHours)).toBe(false);
			});

			it('should default to UTC when timezone is null', () => {
				const channel = createMockChannel({
					quietHoursEnabled: true,
					quietHoursStart: '22:00',
					quietHoursEnd: '08:00',
					quietHoursTimezone: null as unknown as string
				});

				// Should use UTC - 23:00 UTC should be in quiet hours
				expect(isInQuietHours(channel, createUTCDate(23, 0))).toBe(true);
			});
		});
	});
});
