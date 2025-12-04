/**
 * Quiet hours utility functions for notification suppression.
 *
 * Provides functions to check if the current time falls within a channel's
 * configured quiet hours period, with support for:
 * - Timezone-aware time checking
 * - Midnight-spanning ranges (e.g., 22:00-08:00)
 * - Same-day ranges (e.g., 13:00-15:00)
 *
 * @module services/notifications/quiet-hours
 * @requirements 9.4
 */

import type { NotificationChannel } from '$lib/server/db/schema';

// =============================================================================
// Types
// =============================================================================

/**
 * Represents a time of day as hours and minutes.
 */
export interface TimeOfDay {
	hours: number;
	minutes: number;
}

// =============================================================================
// Pure Utility Functions
// =============================================================================

/**
 * Parses a time string in HH:MM format to hours and minutes.
 *
 * @param timeStr - Time string in HH:MM format (e.g., "22:00", "08:30")
 * @returns Parsed hours and minutes
 * @throws Error if format is invalid
 *
 * @example
 * ```typescript
 * parseTimeString("22:30") // { hours: 22, minutes: 30 }
 * parseTimeString("08:00") // { hours: 8, minutes: 0 }
 * ```
 */
export function parseTimeString(timeStr: string): TimeOfDay {
	if (!timeStr || typeof timeStr !== 'string') {
		throw new Error('Time string is required');
	}

	const match = timeStr.match(/^(\d{1,2}):(\d{2})$/);
	if (!match) {
		throw new Error(`Invalid time format: "${timeStr}". Expected HH:MM format.`);
	}

	const hours = parseInt(match[1]!, 10);
	const minutes = parseInt(match[2]!, 10);

	if (hours < 0 || hours > 23) {
		throw new Error(`Invalid hours: ${hours}. Must be 0-23.`);
	}

	if (minutes < 0 || minutes > 59) {
		throw new Error(`Invalid minutes: ${minutes}. Must be 0-59.`);
	}

	return { hours, minutes };
}

/**
 * Gets the current time in a specified timezone as hours and minutes.
 *
 * Uses JavaScript's Intl.DateTimeFormat for timezone conversion.
 * Falls back to UTC if the timezone is invalid.
 *
 * @param timezone - IANA timezone string (e.g., "America/New_York", "Europe/London", "UTC")
 * @param now - Optional Date object for testing (defaults to current time)
 * @returns Current time in the specified timezone
 *
 * @example
 * ```typescript
 * getCurrentTimeInTimezone("America/New_York") // { hours: 14, minutes: 30 }
 * getCurrentTimeInTimezone("Europe/London")    // { hours: 19, minutes: 30 }
 * ```
 */
export function getCurrentTimeInTimezone(timezone: string, now: Date = new Date()): TimeOfDay {
	try {
		const formatter = new Intl.DateTimeFormat('en-US', {
			timeZone: timezone,
			hour: 'numeric',
			minute: 'numeric',
			hour12: false
		});

		const parts = formatter.formatToParts(now);
		let hours = 0;
		let minutes = 0;

		for (const part of parts) {
			if (part.type === 'hour') {
				hours = parseInt(part.value, 10);
			} else if (part.type === 'minute') {
				minutes = parseInt(part.value, 10);
			}
		}

		return { hours, minutes };
	} catch {
		// Invalid timezone - fall back to UTC
		console.warn(`[QuietHours] Invalid timezone "${timezone}", falling back to UTC`);
		return getCurrentTimeInTimezone('UTC', now);
	}
}

/**
 * Converts a TimeOfDay to minutes since midnight for comparison.
 *
 * @param time - Time of day
 * @returns Minutes since midnight (0-1439)
 */
export function timeToMinutes(time: TimeOfDay): number {
	return time.hours * 60 + time.minutes;
}

/**
 * Checks if a time is within a range, handling midnight-spanning ranges.
 *
 * Boundary behavior:
 * - At exactly start time: IN quiet hours
 * - At exactly end time: NOT in quiet hours (end is exclusive)
 *
 * @param current - Current time to check
 * @param start - Start of the range (inclusive)
 * @param end - End of the range (exclusive)
 * @returns true if current time is within the range
 *
 * @example
 * ```typescript
 * // Same-day range (13:00-15:00)
 * isTimeInRange({ hours: 14, minutes: 0 }, { hours: 13, minutes: 0 }, { hours: 15, minutes: 0 })
 * // => true
 *
 * // Midnight-spanning range (22:00-08:00)
 * isTimeInRange({ hours: 23, minutes: 0 }, { hours: 22, minutes: 0 }, { hours: 8, minutes: 0 })
 * // => true (23:00 is after 22:00)
 *
 * isTimeInRange({ hours: 3, minutes: 0 }, { hours: 22, minutes: 0 }, { hours: 8, minutes: 0 })
 * // => true (03:00 is before 08:00)
 * ```
 */
export function isTimeInRange(current: TimeOfDay, start: TimeOfDay, end: TimeOfDay): boolean {
	const currentMinutes = timeToMinutes(current);
	const startMinutes = timeToMinutes(start);
	const endMinutes = timeToMinutes(end);

	if (startMinutes <= endMinutes) {
		// Same-day range (e.g., 13:00-15:00)
		// current >= start AND current < end
		return currentMinutes >= startMinutes && currentMinutes < endMinutes;
	} else {
		// Midnight-spanning range (e.g., 22:00-08:00)
		// current >= start OR current < end
		return currentMinutes >= startMinutes || currentMinutes < endMinutes;
	}
}

// =============================================================================
// Main Function
// =============================================================================

/**
 * Checks if the current time is within quiet hours for a notification channel.
 *
 * Returns false (not in quiet hours) if:
 * - quietHoursEnabled is false
 * - quietHoursStart or quietHoursEnd is not configured
 * - Time strings are invalid
 *
 * @param channel - Notification channel with quiet hours configuration
 * @param now - Optional Date object for testing (defaults to current time)
 * @returns true if notifications should be suppressed
 *
 * @example
 * ```typescript
 * const channel = {
 *   quietHoursEnabled: true,
 *   quietHoursStart: "22:00",
 *   quietHoursEnd: "08:00",
 *   quietHoursTimezone: "America/New_York"
 * };
 *
 * // At 23:00 New York time
 * isInQuietHours(channel) // true
 *
 * // At 12:00 New York time
 * isInQuietHours(channel) // false
 * ```
 */
export function isInQuietHours(channel: NotificationChannel, now: Date = new Date()): boolean {
	// Check if quiet hours are enabled
	if (!channel.quietHoursEnabled) {
		return false;
	}

	// Check if start and end times are configured
	if (!channel.quietHoursStart || !channel.quietHoursEnd) {
		return false;
	}

	try {
		// Parse the configured times
		const start = parseTimeString(channel.quietHoursStart);
		const end = parseTimeString(channel.quietHoursEnd);

		// Get current time in the channel's timezone
		const timezone = channel.quietHoursTimezone ?? 'UTC';
		const current = getCurrentTimeInTimezone(timezone, now);

		// Check if current time is within the range
		return isTimeInRange(current, start, end);
	} catch (error) {
		// Invalid configuration - treat as not in quiet hours
		console.warn(
			`[QuietHours] Invalid quiet hours configuration for channel ${channel.id}:`,
			error instanceof Error ? error.message : String(error)
		);
		return false;
	}
}
