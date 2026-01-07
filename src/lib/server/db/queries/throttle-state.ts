import { eq, isNull, lt, or, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { type ThrottleState, throttleState } from '$lib/server/db/schema';
import { getStartOfDayUTC } from '$lib/server/services/throttle/time-utils';

export {
	getStartOfDayUTC,
	getStartOfNextDayUTC,
	isDayWindowExpired,
	isMinuteWindowExpired,
	msUntilMidnightUTC,
	msUntilMinuteWindowExpires
} from '$lib/server/services/throttle/time-utils';

export async function getThrottleState(connectorId: number): Promise<ThrottleState | null> {
	const result = await db
		.select()
		.from(throttleState)
		.where(eq(throttleState.connectorId, connectorId))
		.limit(1);

	return result[0] ?? null;
}

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
