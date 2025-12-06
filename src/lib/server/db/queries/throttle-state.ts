/**
 * Database queries for throttle state operations.
 *
 *
 * Throttle state tracks runtime rate-limiting counters per connector:
 * - requestsThisMinute: Counter for per-minute rate limit
 * - requestsToday: Counter for daily budget
 * - minuteWindowStart: Start of current minute window
 * - dayWindowStart: Start of current day window (midnight UTC)
 * - pausedUntil: Timestamp until which dispatch is paused
 * - pauseReason: Reason for pause (rate_limit, daily_budget_exhausted, manual)
 */

import { db } from '$lib/server/db';
import { throttleState, type ThrottleState } from '$lib/server/db/schema';
import { eq, lt, sql, or, isNull } from 'drizzle-orm';
import { getStartOfDayUTC } from '$lib/server/services/throttle/time-utils';

// Re-export pure utility functions for convenience
export {
	getStartOfDayUTC,
	getStartOfNextDayUTC,
	isMinuteWindowExpired,
	isDayWindowExpired,
	msUntilMinuteWindowExpires,
	msUntilMidnightUTC
} from '$lib/server/services/throttle/time-utils';

// =============================================================================
// Core CRUD Operations
// =============================================================================

/**
 * Gets the throttle state for a connector.
 *
 * @param connectorId - Connector ID
 * @returns Throttle state if found, null otherwise
 */
export async function getThrottleState(connectorId: number): Promise<ThrottleState | null> {
	const result = await db
		.select()
		.from(throttleState)
		.where(eq(throttleState.connectorId, connectorId))
		.limit(1);

	return result[0] ?? null;
}

/**
 * Gets or creates throttle state for a connector.
 * Creates a new state with zero counters if one doesn't exist.
 *
 * @param connectorId - Connector ID
 * @returns Throttle state (existing or newly created)
 */
export async function getOrCreateThrottleState(connectorId: number): Promise<ThrottleState> {
	const existing = await getThrottleState(connectorId);
	if (existing) {
		return existing;
	}

	const now = new Date();
	const result = await db
		.insert(throttleState)
		.values({
			connectorId,
			requestsThisMinute: 0,
			requestsToday: 0,
			minuteWindowStart: now,
			dayWindowStart: getStartOfDayUTC(now)
		})
		.onConflictDoNothing()
		.returning();

	// Handle race condition - if another process created the state, fetch it
	if (result.length === 0) {
		const fetched = await getThrottleState(connectorId);
		if (!fetched) {
			throw new Error(`Failed to create or fetch throttle state for connector ${connectorId}`);
		}
		return fetched;
	}

	return result[0]!;
}

/**
 * Updates throttle state for a connector.
 *
 * @param connectorId - Connector ID
 * @param updates - Fields to update
 * @returns Updated throttle state, or null if not found
 */
export async function updateThrottleState(
	connectorId: number,
	updates: Partial<Omit<ThrottleState, 'id' | 'connectorId' | 'createdAt'>>
): Promise<ThrottleState | null> {
	const result = await db
		.update(throttleState)
		.set({
			...updates,
			updatedAt: new Date()
		})
		.where(eq(throttleState.connectorId, connectorId))
		.returning();

	return result[0] ?? null;
}

// =============================================================================
// Counter Operations (Atomic)
// =============================================================================

/**
 * Atomically increments both request counters and updates lastRequestAt.
 * Creates throttle state if it doesn't exist.
 *
 * @param connectorId - Connector ID
 * @returns Updated throttle state
 */
export async function incrementRequestCounters(connectorId: number): Promise<ThrottleState> {
	// Ensure state exists
	await getOrCreateThrottleState(connectorId);

	const now = new Date();
	const result = await db
		.update(throttleState)
		.set({
			requestsThisMinute: sql`${throttleState.requestsThisMinute} + 1`,
			requestsToday: sql`${throttleState.requestsToday} + 1`,
			lastRequestAt: now,
			updatedAt: now
		})
		.where(eq(throttleState.connectorId, connectorId))
		.returning();

	if (result.length === 0) {
		throw new Error(`Failed to increment counters for connector ${connectorId}`);
	}

	return result[0]!;
}

// =============================================================================
// Window Reset Operations
// =============================================================================

/**
 * Resets the minute window counter for a connector.
 * Sets requestsThisMinute to 0 and updates minuteWindowStart to now.
 *
 * @param connectorId - Connector ID
 */
export async function resetMinuteWindow(connectorId: number): Promise<void> {
	const now = new Date();
	await db
		.update(throttleState)
		.set({
			requestsThisMinute: 0,
			minuteWindowStart: now,
			updatedAt: now
		})
		.where(eq(throttleState.connectorId, connectorId));
}

/**
 * Resets the day window counter for a connector.
 * Sets requestsToday to 0 and updates dayWindowStart to start of current day UTC.
 * Also clears pausedUntil if the pause reason was daily_budget_exhausted.
 *
 * @param connectorId - Connector ID
 */
export async function resetDayWindow(connectorId: number): Promise<void> {
	const now = new Date();
	await db
		.update(throttleState)
		.set({
			requestsToday: 0,
			dayWindowStart: getStartOfDayUTC(now),
			// Clear pause if it was due to daily budget
			pausedUntil: sql`CASE WHEN ${throttleState.pauseReason} = 'daily_budget_exhausted' THEN NULL ELSE ${throttleState.pausedUntil} END`,
			pauseReason: sql`CASE WHEN ${throttleState.pauseReason} = 'daily_budget_exhausted' THEN NULL ELSE ${throttleState.pauseReason} END`,
			updatedAt: now
		})
		.where(eq(throttleState.connectorId, connectorId));
}

/**
 * Resets minute window for all connectors where the window has expired.
 * A window is expired if minuteWindowStart + 60 seconds < now.
 *
 * @returns Number of connectors reset
 */
export async function resetExpiredMinuteWindows(): Promise<number> {
	const now = new Date();
	const oneMinuteAgo = new Date(now.getTime() - 60 * 1000);

	const result = await db
		.update(throttleState)
		.set({
			requestsThisMinute: 0,
			minuteWindowStart: now,
			updatedAt: now
		})
		.where(
			or(isNull(throttleState.minuteWindowStart), lt(throttleState.minuteWindowStart, oneMinuteAgo))
		)
		.returning({ id: throttleState.id });

	return result.length;
}

/**
 * Resets day window for all connectors where the window has expired (new UTC day).
 * Also clears daily_budget_exhausted pauses.
 *
 * @returns Number of connectors reset
 */
export async function resetExpiredDayWindows(): Promise<number> {
	const now = new Date();
	const startOfToday = getStartOfDayUTC(now);

	const result = await db
		.update(throttleState)
		.set({
			requestsToday: 0,
			dayWindowStart: startOfToday,
			pausedUntil: sql`CASE WHEN ${throttleState.pauseReason} = 'daily_budget_exhausted' THEN NULL ELSE ${throttleState.pausedUntil} END`,
			pauseReason: sql`CASE WHEN ${throttleState.pauseReason} = 'daily_budget_exhausted' THEN NULL ELSE ${throttleState.pauseReason} END`,
			updatedAt: now
		})
		.where(or(isNull(throttleState.dayWindowStart), lt(throttleState.dayWindowStart, startOfToday)))
		.returning({ id: throttleState.id });

	return result.length;
}

// =============================================================================
// Pause Operations
// =============================================================================

/**
 * Sets or clears the pause state for a connector.
 *
 * @param connectorId - Connector ID
 * @param until - Timestamp until which to pause (null to unpause)
 * @param reason - Reason for pause ('rate_limit' | 'daily_budget_exhausted' | 'manual')
 */
export async function setPausedUntil(
	connectorId: number,
	until: Date | null,
	reason: string | null
): Promise<void> {
	await db
		.update(throttleState)
		.set({
			pausedUntil: until,
			pauseReason: reason,
			updatedAt: new Date()
		})
		.where(eq(throttleState.connectorId, connectorId));
}

/**
 * Clears expired pause states for all connectors.
 * A pause is expired if pausedUntil < now.
 *
 * @returns Number of connectors unpaused
 */
export async function clearExpiredPauses(): Promise<number> {
	const now = new Date();

	const result = await db
		.update(throttleState)
		.set({
			pausedUntil: null,
			pauseReason: null,
			updatedAt: now
		})
		.where(lt(throttleState.pausedUntil, now))
		.returning({ id: throttleState.id });

	return result.length;
}
