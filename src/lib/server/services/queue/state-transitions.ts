// State machine: pending → queued → searching → cooldown → pending (retry)
// Backlog system: After MAX_ATTEMPTS failures, items enter backlog tiers with extended delays
// instead of being permanently marked as exhausted. Items are never permanently abandoned.

import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { episodes, requestQueue, searchRegistry } from '$lib/server/db/schema';
import { createLogger } from '$lib/server/logger';
import {
	calculateBacklogNextEligibleTime,
	calculateNextEligibleTimeWithConfig,
	getNextBacklogTier,
	shouldEnterBacklog
} from './backoff';
import { getBacklogConfig, getStateTransitionConfig } from './config';
import type {
	MarkSearchFailedInput,
	ReenqueueCooldownResult,
	RevertToQueuedResult,
	SearchState,
	StateTransitionResult
} from './types';

const logger = createLogger('state-transitions');

export { calculateNextEligibleTimeWithConfig, shouldMarkExhausted } from './backoff';

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
				backlogTier: searchRegistry.backlogTier,
				contentType: searchRegistry.contentType,
				contentId: searchRegistry.contentId,
				connectorId: searchRegistry.connectorId
			})
			.from(searchRegistry)
			.where(eq(searchRegistry.id, searchRegistryId))
			.limit(1);

		if (current.length === 0) {
			logger.warn('Search registry entry not found', { searchRegistryId });
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
			logger.warn('Invalid state transition attempt', {
				searchRegistryId,
				currentState: previousState,
				expectedState: 'searching'
			});
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

		// Get config to determine behavior
		const stateConfig = await getStateTransitionConfig();
		const backlogConfig = await getBacklogConfig();

		// Check if item should enter backlog (exhausted normal retries)
		if (shouldEnterBacklog(newAttemptCount, stateConfig.MAX_ATTEMPTS)) {
			if (!backlogConfig.enabled) {
				// Backlog disabled - use original exhausted behavior (terminal state)
				await db
					.update(searchRegistry)
					.set({
						state: 'exhausted',
						attemptCount: newAttemptCount,
						failureCategory,
						nextEligible: null,
						updatedAt: now
					})
					.where(eq(searchRegistry.id, searchRegistryId));

				logger.info('Search marked exhausted', {
					searchRegistryId,
					attemptCount: newAttemptCount,
					failureCategory
				});

				return {
					success: true,
					searchRegistryId,
					previousState,
					newState: 'exhausted',
					attemptCount: newAttemptCount
				};
			}

			// Backlog enabled - enter extended cooldown with next tier
			const newTier = getNextBacklogTier(entry.backlogTier, backlogConfig.maxTier);
			const nextEligible = calculateBacklogNextEligibleTime(
				newTier,
				backlogConfig.tierDelaysDays,
				now
			);

			await db
				.update(searchRegistry)
				.set({
					state: 'cooldown',
					attemptCount: 0, // Reset attempt count for next retry cycle
					backlogTier: newTier,
					failureCategory,
					nextEligible,
					updatedAt: now
				})
				.where(eq(searchRegistry.id, searchRegistryId));

			logger.info('Search entered backlog tier', {
				searchRegistryId,
				backlogTier: newTier,
				nextEligible: nextEligible.toISOString(),
				failureCategory
			});

			return {
				success: true,
				searchRegistryId,
				previousState,
				newState: 'cooldown',
				attemptCount: 0,
				nextEligible,
				backlogTier: newTier
			};
		}

		// Normal cooldown with exponential backoff (uses DB-backed config)
		const nextEligible = await calculateNextEligibleTimeWithConfig(newAttemptCount, now);

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

		logger.debug('Search marked failed, entering cooldown', {
			searchRegistryId,
			attemptCount: newAttemptCount,
			failureCategory,
			nextEligible: nextEligible.toISOString()
		});

		return {
			success: true,
			searchRegistryId,
			previousState,
			newState: 'cooldown',
			attemptCount: newAttemptCount,
			nextEligible
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		logger.error('Mark search failed error', { searchRegistryId, error: errorMessage });
		return {
			success: false,
			searchRegistryId,
			previousState: 'searching',
			newState: 'searching',
			error: errorMessage
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

		logger.info('Search marked exhausted', { searchRegistryId, previousState });

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

		if (itemsReenqueued > 0) {
			logger.info('Cooldown items re-enqueued', {
				connectorId: connectorId ?? 'all',
				itemsReenqueued,
				itemsStillCooling: itemsSkipped
			});
		}

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
		const errorMessage = error instanceof Error ? error.message : String(error);
		logger.error('Re-enqueue cooldown items failed', {
			connectorId: connectorId ?? 'all',
			error: errorMessage
		});

		const result: ReenqueueCooldownResult = {
			success: false,
			itemsReenqueued: 0,
			itemsSkipped: 0,
			durationMs: Date.now() - startTime,
			error: errorMessage
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
			logger.debug('Failed to set searching state', {
				searchRegistryId,
				currentState: current ?? 'not found'
			});
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

		logger.debug('Search state set to searching', { searchRegistryId });
		return {
			success: true,
			searchRegistryId,
			previousState: 'queued',
			newState: 'searching'
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		logger.error('Set searching state failed', { searchRegistryId, error: errorMessage });
		return {
			success: false,
			searchRegistryId,
			previousState: 'queued',
			newState: 'queued',
			error: errorMessage
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
			logger.warn('Search registry entry not found for dispatch', { searchRegistryId });
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
			logger.warn('Invalid state for mark dispatched', {
				searchRegistryId,
				currentState: previousState
			});
			return {
				success: false,
				searchRegistryId,
				previousState,
				newState: previousState,
				error: `Cannot mark dispatched: entry is in state '${previousState}', expected 'searching'`
			};
		}

		// Enter backlog tier 1 for continuous upgrade searching instead of deleting.
		// Items will be re-searched after the backlog delay. Cleanup will remove items
		// where qualityCutoffNotMet=false (after sync updates the value).
		const now = new Date();
		const backlogConfig = await getBacklogConfig();
		const nextEligible = calculateBacklogNextEligibleTime(1, backlogConfig.tierDelaysDays, now);

		await db
			.update(searchRegistry)
			.set({
				state: 'cooldown',
				backlogTier: 1,
				attemptCount: 0,
				nextEligible,
				updatedAt: now
			})
			.where(eq(searchRegistry.id, searchRegistryId));

		logger.debug('Search marked as dispatched, entering backlog tier 1', {
			searchRegistryId,
			nextEligible: nextEligible.toISOString()
		});
		return {
			success: true,
			searchRegistryId,
			previousState: 'searching',
			newState: 'cooldown',
			backlogTier: 1,
			nextEligible
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		logger.error('Mark search dispatched failed', { searchRegistryId, error: errorMessage });
		return {
			success: false,
			searchRegistryId,
			previousState: 'searching',
			newState: 'searching',
			error: errorMessage
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

		if (searchingItems.length > 0 || allToRequeue.length > 0) {
			logger.debug('Items reverted to queued', {
				reverted: searchingItems.length,
				requeued: allToRequeue.length
			});
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

		logger.info('Orphaned searching items cleaned up', {
			reverted: orphaned.length,
			maxAgeMinutes
		});

		return {
			success: true,
			reverted: orphaned.length,
			requeued: orphaned.length
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		logger.error('Cleanup orphaned items failed', { error: errorMessage });
		return {
			success: false,
			reverted: 0,
			requeued: 0,
			error: errorMessage
		};
	}
}
