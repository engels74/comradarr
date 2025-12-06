/**
 * Pure time utility functions for throttle window calculations.
 *
 * These functions have no database dependencies and can be used
 * in both server-side code and unit tests.
 *
 */

/**
 * Gets the start of the day in UTC for a given date.
 *
 * @param date - Date to get start of day for
 * @returns Date representing midnight UTC of that day
 */
export function getStartOfDayUTC(date: Date): Date {
	const result = new Date(date);
	result.setUTCHours(0, 0, 0, 0);
	return result;
}

/**
 * Gets the start of the next day in UTC for a given date.
 *
 * @param date - Date to get next day start for
 * @returns Date representing midnight UTC of the next day
 */
export function getStartOfNextDayUTC(date: Date): Date {
	const result = new Date(date);
	result.setUTCDate(result.getUTCDate() + 1);
	result.setUTCHours(0, 0, 0, 0);
	return result;
}

/**
 * Checks if a minute window has expired.
 * Window is expired if windowStart + 60 seconds <= now.
 *
 * @param windowStart - Start of the minute window
 * @param now - Current time (optional, defaults to now)
 * @returns true if window has expired
 */
export function isMinuteWindowExpired(windowStart: Date | null, now: Date = new Date()): boolean {
	if (!windowStart) return true;
	return now.getTime() >= windowStart.getTime() + 60 * 1000;
}

/**
 * Checks if a day window has expired (new UTC day has started).
 *
 * @param windowStart - Start of the day window
 * @param now - Current time (optional, defaults to now)
 * @returns true if window has expired (new day)
 */
export function isDayWindowExpired(windowStart: Date | null, now: Date = new Date()): boolean {
	if (!windowStart) return true;
	const startOfToday = getStartOfDayUTC(now);
	return startOfToday > windowStart;
}

/**
 * Calculates milliseconds until the minute window expires.
 *
 * @param windowStart - Start of the minute window
 * @param now - Current time (optional, defaults to now)
 * @returns Milliseconds until window expires (0 if already expired)
 */
export function msUntilMinuteWindowExpires(
	windowStart: Date | null,
	now: Date = new Date()
): number {
	if (!windowStart) return 0;
	const expiresAt = windowStart.getTime() + 60 * 1000;
	const remaining = expiresAt - now.getTime();
	return Math.max(0, remaining);
}

/**
 * Calculates milliseconds until midnight UTC (next day window).
 *
 * @param now - Current time (optional, defaults to now)
 * @returns Milliseconds until midnight UTC
 */
export function msUntilMidnightUTC(now: Date = new Date()): number {
	const nextMidnight = getStartOfNextDayUTC(now);
	return nextMidnight.getTime() - now.getTime();
}
