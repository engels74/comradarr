/**
 * Search state transition functions.
 *
 * Handles transitions between search states in the state machine:
 * - searching → cooldown (on failure, with exponential backoff)
 * - searching → exhausted (on max attempts reached)
 * - cooldown → pending (when eligible time passes, for re-enqueue)
 *
 * State Machine:
 * ```
 * pending → queued → searching → cooldown → pending (retry)
 *                              ↘ exhausted (max attempts)
 * ```
 *
 * @module services/queue/state-transitions
 * @requirements 5.5, 5.6
 */

import { db } from '$lib/server/db';
import { searchRegistry } from '$lib/server/db/schema';
import { and, eq, lte, sql } from 'drizzle-orm';
import type {
	MarkSearchFailedInput,
	ReenqueueCooldownResult,
	SearchState,
	StateTransitionResult
} from './types';
import { STATE_TRANSITION_CONFIG } from './config';
import { calculateNextEligibleTime, shouldMarkExhausted } from './backoff';

// Re-export for convenience
export { calculateNextEligibleTime, shouldMarkExhausted } from './backoff';

/**
 * Mark a search as failed and transition to cooldown or exhausted state.
 *
 * This function:
 * 1. Validates the current state is 'searching'
 * 2. Increments the attempt count
 * 3. If max attempts reached: transitions to 'exhausted'
 * 4. Otherwise: calculates next eligible time and transitions to 'cooldown'
 *
 * @param input - The search registry ID and failure category
 * @returns State transition result with new state and timing info
 *
 * @example
 * ```typescript
 * const result = await markSearchFailed({
 *   searchRegistryId: 123,
 *   failureCategory: 'no_results'
 * });
 *
 * if (result.success) {
 *   if (result.newState === 'exhausted') {
 *     console.log('Item exhausted after', result.attemptCount, 'attempts');
 *   } else {
 *     console.log('Item in cooldown until', result.nextEligible);
 *   }
 * }
 * ```
 *
 * @requirements 5.5, 5.6
 */
export async function markSearchFailed(
	input: MarkSearchFailedInput
): Promise<StateTransitionResult> {
	const { searchRegistryId, failureCategory } = input;

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

/**
 * Mark a search as exhausted (terminal state).
 *
 * This function manually transitions an item to the exhausted state,
 * typically used when an item should no longer be retried regardless
 * of attempt count.
 *
 * Valid source states: 'searching', 'cooldown'
 *
 * @param searchRegistryId - ID of the search registry entry
 * @returns State transition result
 *
 * @requirements 5.6
 */
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

/**
 * Re-enqueue items whose cooldown period has expired.
 *
 * This function finds all items in 'cooldown' state where nextEligible <= now
 * and transitions them back to 'pending' so they can be picked up by
 * enqueuePendingItems() on the next queue processing cycle.
 *
 * @param connectorId - Optional connector ID to filter (undefined for all connectors)
 * @returns Result with count of items re-enqueued
 *
 * @example
 * ```typescript
 * // Re-enqueue all eligible cooldown items
 * const result = await reenqueueEligibleCooldownItems();
 *
 * // Re-enqueue only for a specific connector
 * const result = await reenqueueEligibleCooldownItems(1);
 * ```
 *
 * @requirements 5.5
 */
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

/**
 * Get the current state of a search registry entry.
 *
 * Utility function for checking state before operations.
 *
 * @param searchRegistryId - ID of the search registry entry
 * @returns Current state or null if not found
 */
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
