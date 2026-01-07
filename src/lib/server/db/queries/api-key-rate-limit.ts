import { eq, isNull, lt, or, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { type ApiKeyRateLimitState, apiKeyRateLimitState } from '$lib/server/db/schema';
import {
	isMinuteWindowExpired,
	msUntilMinuteWindowExpires
} from '$lib/server/services/throttle/time-utils';

export {
	isMinuteWindowExpired,
	msUntilMinuteWindowExpires
} from '$lib/server/services/throttle/time-utils';

export async function getRateLimitState(apiKeyId: number): Promise<ApiKeyRateLimitState | null> {
	const result = await db
		.select()
		.from(apiKeyRateLimitState)
		.where(eq(apiKeyRateLimitState.apiKeyId, apiKeyId))
		.limit(1);

	return result[0] ?? null;
}

export async function getOrCreateRateLimitState(apiKeyId: number): Promise<ApiKeyRateLimitState> {
	const existing = await getRateLimitState(apiKeyId);
	if (existing) {
		return existing;
	}

	const now = new Date();
	const result = await db
		.insert(apiKeyRateLimitState)
		.values({
			apiKeyId,
			requestsThisMinute: 0,
			minuteWindowStart: now
		})
		.onConflictDoNothing()
		.returning();

	// Handle race condition - if another process created the state, fetch it
	if (result.length === 0) {
		const fetched = await getRateLimitState(apiKeyId);
		if (!fetched) {
			throw new Error(`Failed to create or fetch rate limit state for API key ${apiKeyId}`);
		}
		return fetched;
	}

	return result[0]!;
}

export async function incrementRequestCounter(apiKeyId: number): Promise<ApiKeyRateLimitState> {
	// Ensure state exists
	await getOrCreateRateLimitState(apiKeyId);

	const now = new Date();
	const result = await db
		.update(apiKeyRateLimitState)
		.set({
			requestsThisMinute: sql`${apiKeyRateLimitState.requestsThisMinute} + 1`,
			lastRequestAt: now,
			updatedAt: now
		})
		.where(eq(apiKeyRateLimitState.apiKeyId, apiKeyId))
		.returning();

	if (result.length === 0) {
		throw new Error(`Failed to increment counter for API key ${apiKeyId}`);
	}

	return result[0]!;
}

export async function resetMinuteWindow(apiKeyId: number): Promise<void> {
	const now = new Date();
	await db
		.update(apiKeyRateLimitState)
		.set({
			requestsThisMinute: 0,
			minuteWindowStart: now,
			updatedAt: now
		})
		.where(eq(apiKeyRateLimitState.apiKeyId, apiKeyId));
}

export async function resetExpiredMinuteWindows(): Promise<number> {
	const now = new Date();
	const oneMinuteAgo = new Date(now.getTime() - 60 * 1000);

	const result = await db
		.update(apiKeyRateLimitState)
		.set({
			requestsThisMinute: 0,
			minuteWindowStart: now,
			updatedAt: now
		})
		.where(
			or(
				isNull(apiKeyRateLimitState.minuteWindowStart),
				lt(apiKeyRateLimitState.minuteWindowStart, oneMinuteAgo)
			)
		)
		.returning({ id: apiKeyRateLimitState.id });

	return result.length;
}

export async function getCurrentRequestCount(apiKeyId: number): Promise<number> {
	const state = await getRateLimitState(apiKeyId);
	if (!state) {
		return 0;
	}

	// If window expired, count is effectively 0
	if (isMinuteWindowExpired(state.minuteWindowStart)) {
		return 0;
	}

	return state.requestsThisMinute;
}

export async function getRemainingRequests(
	apiKeyId: number,
	rateLimitPerMinute: number | null
): Promise<number | null> {
	if (rateLimitPerMinute === null) {
		return null; // Unlimited
	}

	const currentCount = await getCurrentRequestCount(apiKeyId);
	return Math.max(0, rateLimitPerMinute - currentCount);
}

export async function getTimeUntilReset(apiKeyId: number): Promise<number> {
	const state = await getRateLimitState(apiKeyId);
	if (!state || !state.minuteWindowStart) {
		return 0;
	}

	return msUntilMinuteWindowExpires(state.minuteWindowStart);
}
