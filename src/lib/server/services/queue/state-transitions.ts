// State machine: pending → queued → searching → cooldown → pending (retry) or exhausted

import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { episodes, searchRegistry } from '$lib/server/db/schema';
import { calculateNextEligibleTime, shouldMarkExhausted } from './backoff';
import type {
	MarkSearchFailedInput,
	ReenqueueCooldownResult,
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
		// Fetch current registry entry with content info for season pack fallback
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

		// Validate current state is 'searching'
		if (previousState !== 'searching') {
			return {
				success: false,
				searchRegistryId,
				previousState,
				newState: previousState,
				error: `Cannot mark failed: entry is in state '${previousState}', expected 'searching'`
			};
		}

		// Increment attempt count
		const newAttemptCount = entry.attemptCount + 1;
		const now = new Date();

		// If season pack search failed with no_results,
		// mark all episodes in the season for EpisodeSearch fallback
		if (
			wasSeasonPackSearch === true &&
			failureCategory === 'no_results' &&
			entry.contentType === 'episode'
		) {
			await markSeasonPackFailedForSeason(entry.contentId, entry.connectorId, now);
		}

		// Check if max attempts reached
		if (shouldMarkExhausted(newAttemptCount)) {
			// Transition to exhausted
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

		// Transition to cooldown with calculated next eligible time
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
	// Look up the episode's seasonId
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

	// Find all episode IDs in the same season
	const seasonEpisodes = await db
		.select({ id: episodes.id })
		.from(episodes)
		.where(eq(episodes.seasonId, seasonId));

	if (seasonEpisodes.length === 0) {
		return;
	}

	const episodeIds = seasonEpisodes.map((e) => e.id);

	// Update all search registry entries for these episodes to mark season pack failed
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
		// Fetch current registry entry
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

		// Validate current state is 'searching' or 'cooldown'
		if (previousState !== 'searching' && previousState !== 'cooldown') {
			return {
				success: false,
				searchRegistryId,
				previousState,
				newState: previousState,
				error: `Cannot mark exhausted: entry is in state '${previousState}', expected 'searching' or 'cooldown'`
			};
		}

		// Transition to exhausted
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

		// Build where conditions
		const conditions = [
			eq(searchRegistry.state, 'cooldown'),
			lte(searchRegistry.nextEligible, now)
		];

		if (connectorId !== undefined) {
			conditions.push(eq(searchRegistry.connectorId, connectorId));
		}

		// Count total items in cooldown (for skipped calculation)
		const cooldownConditions = [eq(searchRegistry.state, 'cooldown')];
		if (connectorId !== undefined) {
			cooldownConditions.push(eq(searchRegistry.connectorId, connectorId));
		}

		const totalInCooldown = await db
			.select({ count: sql<number>`count(*)::int` })
			.from(searchRegistry)
			.where(and(...cooldownConditions));

		const totalCount = totalInCooldown[0]?.count ?? 0;

		// Update eligible items to 'pending'
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
