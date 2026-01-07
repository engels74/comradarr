// Supports timezone-aware checking and midnight-spanning ranges (e.g., 22:00-08:00)

import type { NotificationChannel } from '$lib/server/db/schema';
import { createLogger } from '$lib/server/logger';

const logger = createLogger('quiet-hours');

export interface TimeOfDay {
	hours: number;
	minutes: number;
}

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

// Falls back to UTC if timezone is invalid
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
		logger.warn('Invalid timezone, falling back to UTC', { timezone });
		return getCurrentTimeInTimezone('UTC', now);
	}
}

export function timeToMinutes(time: TimeOfDay): number {
	return time.hours * 60 + time.minutes;
}

// Start is inclusive, end is exclusive; handles midnight-spanning ranges
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

// Returns false if quiet hours disabled, unconfigured, or invalid
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
		logger.warn('Invalid quiet hours configuration for channel', {
			channelId: channel.id,
			error: error instanceof Error ? error.message : String(error)
		});
		return false;
	}
}
