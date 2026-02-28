/**
 * Pure time utility functions for throttle window calculations.
 *
 * These functions have no database dependencies and can be used
 * in both server-side code and unit tests.
 *
 */

export function getStartOfDayUTC(date: Date): Date {
	const result = new Date(date);
	result.setUTCHours(0, 0, 0, 0);
	return result;
}

export function getStartOfNextDayUTC(date: Date): Date {
	const result = new Date(date);
	result.setUTCDate(result.getUTCDate() + 1);
	result.setUTCHours(0, 0, 0, 0);
	return result;
}

export function isMinuteWindowExpired(windowStart: Date | null, now: Date = new Date()): boolean {
	if (!windowStart) return true;
	return now.getTime() >= windowStart.getTime() + 60 * 1000;
}

export function isDayWindowExpired(windowStart: Date | null, now: Date = new Date()): boolean {
	if (!windowStart) return true;
	const startOfToday = getStartOfDayUTC(now);
	return startOfToday > windowStart;
}

export function msUntilMinuteWindowExpires(
	windowStart: Date | null,
	now: Date = new Date()
): number {
	if (!windowStart) return 0;
	const expiresAt = windowStart.getTime() + 60 * 1000;
	const remaining = expiresAt - now.getTime();
	return Math.max(0, remaining);
}

export function msUntilMidnightUTC(now: Date = new Date()): number {
	const nextMidnight = getStartOfNextDayUTC(now);
	return nextMidnight.getTime() - now.getTime();
}
