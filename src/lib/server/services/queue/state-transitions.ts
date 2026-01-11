// State machine: pending → queued → searching → cooldown → pending (retry) or exhausted

import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { episodes, requestQueue, searchRegistry } from '$lib/server/db/schema';
import { calculateNextEligibleTime, shouldMarkExhausted } from './backoff';
import type {
	MarkSearchFailedInput,
	ReenqueueCooldownResult,
	RevertToQueuedResult,
	SearchState,
	StateTransitionResult
} from './types';

export { calculateNextEligibleTime, shouldMarkExhausted } from './backoff';

// Season pack failure with no_results triggers EpisodeSearch fallback for all episodes in the season
export async function markSearchFailed(
	input: MarkSearchFailedInput
): Promise<StateTransitionResult> {
	const { searchRegistryId, failureCategory, wasSeasonPackSearch } = input;

	try {
		const current = await db
			.select({
				id: searchRegistry.id,
				state: searchRegistry.state,
				attemptCount: searchRegistry.attemptCount,
				contentType: searchRegistry.contentType,
				contentId: searchRegistry.contentId,
				connectorId: searchRegistry.connectorId
			})
			.from(searchRegistry)
			.where(eq(searchRegistry.id, searchRegistryId))
			.limit(1);

		if (current.length === 0) {
			return {
				success: false,
				searchRegistryId,
				previousState: 'searching',
				newState: 'searching',
				error: `Search registry entry ${searchRegistryId} not found`
			};
		}

		const entry = current[0]!;
		const previousState = entry.state as SearchState;

		if (previousState !== 'searching') {
			return {
				success: false,
				searchRegistryId,
				previousState,
				newState: previousState,
				error: `Cannot mark failed: entry is in state '${previousState}', expected 'searching'`
			};
		}

		const newAttemptCount = entry.attemptCount + 1;
		const now = new Date();

		// Season pack no_results triggers EpisodeSearch fallback
		if (
			wasSeasonPackSearch === true &&
			failureCategory === 'no_results' &&
			entry.contentType === 'episode'
		) {
			await markSeasonPackFailedForSeason(entry.contentId, entry.connectorId, now);
		}

		if (shouldMarkExhausted(newAttemptCount)) {
			await db
				.update(searchRegistry)
				.set({
					state: 'exhausted',
					attemptCount: newAttemptCount,
					failureCategory,
					nextEligible: null, // No retry for exhausted items
					updatedAt: now
				})
				.where(eq(searchRegistry.id, searchRegistryId));

			return {
				success: true,
				searchRegistryId,
				previousState,
				newState: 'exhausted',
				attemptCount: newAttemptCount
			};
		}

		const nextEligible = calculateNextEligibleTime(newAttemptCount, now);

		await db
			.update(searchRegistry)
			.set({
				state: 'cooldown',
				attemptCount: newAttemptCount,
				failureCategory,
				nextEligible,
				updatedAt: now
			})
			.where(eq(searchRegistry.id, searchRegistryId));

		return {
			success: true,
			searchRegistryId,
			previousState,
			newState: 'cooldown',
			attemptCount: newAttemptCount,
			nextEligible
		};
	} catch (error) {
		return {
			success: false,
			searchRegistryId,
			previousState: 'searching',
			newState: 'searching',
			error: error instanceof Error ? error.message : String(error)
		};
	}
}

async function markSeasonPackFailedForSeason(
	episodeContentId: number,
	connectorId: number,
	now: Date
): Promise<void> {
	const episodeRecord = await db
		.select({ seasonId: episodes.seasonId })
		.from(episodes)
		.where(eq(episodes.id, episodeContentId))
		.limit(1);

	if (episodeRecord.length === 0) {
		// Episode not found, cannot determine season - skip fallback marking
		return;
	}

	const seasonId = episodeRecord[0]!.seasonId;

	const seasonEpisodes = await db
		.select({ id: episodes.id })
		.from(episodes)
		.where(eq(episodes.seasonId, seasonId));

	if (seasonEpisodes.length === 0) {
		return;
	}

	const episodeIds = seasonEpisodes.map((e) => e.id);

	await db
		.update(searchRegistry)
		.set({
			seasonPackFailed: true,
			updatedAt: now
		})
		.where(
			and(
				eq(searchRegistry.connectorId, connectorId),
				eq(searchRegistry.contentType, 'episode'),
				inArray(searchRegistry.contentId, episodeIds)
			)
		);
}

// Valid from 'searching' or 'cooldown' states only
export async function markSearchExhausted(
	searchRegistryId: number
): Promise<StateTransitionResult> {
	try {
		const current = await db
			.select({
				id: searchRegistry.id,
				state: searchRegistry.state,
				attemptCount: searchRegistry.attemptCount
			})
			.from(searchRegistry)
			.where(eq(searchRegistry.id, searchRegistryId))
			.limit(1);

		if (current.length === 0) {
			return {
				success: false,
				searchRegistryId,
				previousState: 'searching',
				newState: 'searching',
				error: `Search registry entry ${searchRegistryId} not found`
			};
		}

		const entry = current[0]!;
		const previousState = entry.state as SearchState;

		if (previousState !== 'searching' && previousState !== 'cooldown') {
			return {
				success: false,
				searchRegistryId,
				previousState,
				newState: previousState,
				error: `Cannot mark exhausted: entry is in state '${previousState}', expected 'searching' or 'cooldown'`
			};
		}

		const now = new Date();
		await db
			.update(searchRegistry)
			.set({
				state: 'exhausted',
				nextEligible: null, // No retry for exhausted items
				updatedAt: now
			})
			.where(eq(searchRegistry.id, searchRegistryId));

		return {
			success: true,
			searchRegistryId,
			previousState,
			newState: 'exhausted',
			attemptCount: entry.attemptCount
		};
	} catch (error) {
		return {
			success: false,
			searchRegistryId,
			previousState: 'searching',
			newState: 'searching',
			error: error instanceof Error ? error.message : String(error)
		};
	}
}

// Transitions cooldown items back to pending when nextEligible <= now
export async function reenqueueEligibleCooldownItems(
	connectorId?: number
): Promise<ReenqueueCooldownResult> {
	const startTime = Date.now();

	try {
		const now = new Date();

		const conditions = [
			eq(searchRegistry.state, 'cooldown'),
			lte(searchRegistry.nextEligible, now)
		];

		if (connectorId !== undefined) {
			conditions.push(eq(searchRegistry.connectorId, connectorId));
		}

		const cooldownConditions = [eq(searchRegistry.state, 'cooldown')];
		if (connectorId !== undefined) {
			cooldownConditions.push(eq(searchRegistry.connectorId, connectorId));
		}

		const totalInCooldown = await db
			.select({ count: sql<number>`count(*)::int` })
			.from(searchRegistry)
			.where(and(...cooldownConditions));

		const totalCount = totalInCooldown[0]?.count ?? 0;

		const updated = await db
			.update(searchRegistry)
			.set({
				state: 'pending',
				nextEligible: null,
				updatedAt: now
			})
			.where(and(...conditions))
			.returning({ id: searchRegistry.id });

		const itemsReenqueued = updated.length;
		const itemsSkipped = totalCount - itemsReenqueued;

		const result: ReenqueueCooldownResult = {
			success: true,
			itemsReenqueued,
			itemsSkipped,
			durationMs: Date.now() - startTime
		};

		if (connectorId !== undefined) {
			result.connectorId = connectorId;
		}

		return result;
	} catch (error) {
		const result: ReenqueueCooldownResult = {
			success: false,
			itemsReenqueued: 0,
			itemsSkipped: 0,
			durationMs: Date.now() - startTime,
			error: error instanceof Error ? error.message : String(error)
		};

		if (connectorId !== undefined) {
			result.connectorId = connectorId;
		}

		return result;
	}
}

export async function getSearchState(searchRegistryId: number): Promise<SearchState | null> {
	const result = await db
		.select({ state: searchRegistry.state })
		.from(searchRegistry)
		.where(eq(searchRegistry.id, searchRegistryId))
		.limit(1);

	if (result.length === 0) {
		return null;
	}

	return result[0]!.state as SearchState;
}

export async function setSearching(searchRegistryId: number): Promise<StateTransitionResult> {
	try {
		const now = new Date();
		const result = await db
			.update(searchRegistry)
			.set({
				state: 'searching',
				lastSearched: now,
				updatedAt: now
			})
			.where(and(eq(searchRegistry.id, searchRegistryId), eq(searchRegistry.state, 'queued')))
			.returning({ id: searchRegistry.id, state: searchRegistry.state });

		if (result.length === 0) {
			const current = await getSearchState(searchRegistryId);
			return {
				success: false,
				searchRegistryId,
				previousState: current ?? 'queued',
				newState: current ?? 'queued',
				error: current
					? `Cannot set searching: entry is in state '${current}', expected 'queued'`
					: `Search registry entry ${searchRegistryId} not found`
			};
		}

		return {
			success: true,
			searchRegistryId,
			previousState: 'queued',
			newState: 'searching'
		};
	} catch (error) {
		return {
			success: false,
			searchRegistryId,
			previousState: 'queued',
			newState: 'queued',
			error: error instanceof Error ? error.message : String(error)
		};
	}
}

export async function markSearchDispatched(
	searchRegistryId: number
): Promise<StateTransitionResult> {
	try {
		const current = await db
			.select({
				id: searchRegistry.id,
				state: searchRegistry.state
			})
			.from(searchRegistry)
			.where(eq(searchRegistry.id, searchRegistryId))
			.limit(1);

		if (current.length === 0) {
			return {
				success: false,
				searchRegistryId,
				previousState: 'searching',
				newState: 'searching',
				error: `Search registry entry ${searchRegistryId} not found`
			};
		}

		const entry = current[0]!;
		const previousState = entry.state as SearchState;

		if (previousState !== 'searching') {
			return {
				success: false,
				searchRegistryId,
				previousState,
				newState: previousState,
				error: `Cannot mark dispatched: entry is in state '${previousState}', expected 'searching'`
			};
		}

		await db.delete(searchRegistry).where(eq(searchRegistry.id, searchRegistryId));

		return {
			success: true,
			searchRegistryId,
			previousState: 'searching',
			newState: 'searching'
		};
	} catch (error) {
		return {
			success: false,
			searchRegistryId,
			previousState: 'searching',
			newState: 'searching',
			error: error instanceof Error ? error.message : String(error)
		};
	}
}

export async function revertToQueued(searchRegistryIds: number[]): Promise<RevertToQueuedResult> {
	if (searchRegistryIds.length === 0) {
		return { success: true, reverted: 0, requeued: 0 };
	}

	try {
		const now = new Date();

		const toHandle = await db
			.select({
				id: searchRegistry.id,
				connectorId: searchRegistry.connectorId,
				priority: searchRegistry.priority,
				state: searchRegistry.state
			})
			.from(searchRegistry)
			.where(inArray(searchRegistry.id, searchRegistryIds));

		if (toHandle.length === 0) {
			return { success: true, reverted: 0, requeued: 0 };
		}

		const searchingItems = toHandle.filter((r) => r.state === 'searching');
		const queuedItems = toHandle.filter((r) => r.state === 'queued');

		if (searchingItems.length > 0) {
			await db
				.update(searchRegistry)
				.set({
					state: 'queued',
					updatedAt: now
				})
				.where(
					inArray(
						searchRegistry.id,
						searchingItems.map((r) => r.id)
					)
				);
		}

		const allToRequeue = [...searchingItems, ...queuedItems];
		if (allToRequeue.length > 0) {
			await db
				.insert(requestQueue)
				.values(
					allToRequeue.map((r) => ({
						searchRegistryId: r.id,
						connectorId: r.connectorId,
						priority: r.priority,
						scheduledAt: now
					}))
				)
				.onConflictDoNothing();
		}

		return {
			success: true,
			reverted: searchingItems.length,
			requeued: allToRequeue.length
		};
	} catch (error) {
		return {
			success: false,
			reverted: 0,
			requeued: 0,
			error: error instanceof Error ? error.message : String(error)
		};
	}
}

export async function cleanupOrphanedSearchingItems(
	maxAgeMinutes: number = 10
): Promise<RevertToQueuedResult> {
	try {
		const cutoff = new Date(Date.now() - maxAgeMinutes * 60 * 1000);
		const now = new Date();

		const orphaned = await db
			.select({
				id: searchRegistry.id,
				connectorId: searchRegistry.connectorId,
				priority: searchRegistry.priority
			})
			.from(searchRegistry)
			.where(and(eq(searchRegistry.state, 'searching'), lte(searchRegistry.updatedAt, cutoff)));

		if (orphaned.length === 0) {
			return { success: true, reverted: 0, requeued: 0 };
		}

		const orphanedIds = orphaned.map((r) => r.id);

		await db
			.update(searchRegistry)
			.set({
				state: 'queued',
				updatedAt: now
			})
			.where(inArray(searchRegistry.id, orphanedIds));

		await db
			.insert(requestQueue)
			.values(
				orphaned.map((r) => ({
					searchRegistryId: r.id,
					connectorId: r.connectorId,
					priority: r.priority,
					scheduledAt: now
				}))
			)
			.onConflictDoNothing();

		return {
			success: true,
			reverted: orphaned.length,
			requeued: orphaned.length
		};
	} catch (error) {
		return {
			success: false,
			reverted: 0,
			requeued: 0,
			error: error instanceof Error ? error.message : String(error)
		};
	}
}
