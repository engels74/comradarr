import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { searchRegistry } from '$lib/server/db/schema';
import { calculateBacklogNextEligibleTime } from '$lib/server/services/queue/backoff';
import { getBacklogConfig } from '$lib/server/services/queue/config';
import type { BacklogRecoveryResult } from './types';

/**
 * Recovers exhausted items by transitioning them to backlog tier 1.
 * This function migrates existing exhausted items to use the new backlog system.
 * Should be run once after enabling backlog recovery, and optionally periodically
 * in the db-maintenance job.
 */
export async function recoverExhaustedItems(): Promise<BacklogRecoveryResult> {
	const startTime = Date.now();

	try {
		const backlogConfig = await getBacklogConfig();

		if (!backlogConfig.enabled) {
			return {
				success: true,
				itemsRecovered: 0,
				durationMs: Date.now() - startTime
			};
		}

		const now = new Date();

		// Find all exhausted items and transition them to backlog tier 1
		const exhaustedItems = await db
			.select({
				id: searchRegistry.id,
				backlogTier: searchRegistry.backlogTier
			})
			.from(searchRegistry)
			.where(eq(searchRegistry.state, 'exhausted'));

		if (exhaustedItems.length === 0) {
			return {
				success: true,
				itemsRecovered: 0,
				durationMs: Date.now() - startTime
			};
		}

		// Update each exhausted item to cooldown with backlog tier 1
		let itemsRecovered = 0;
		for (const item of exhaustedItems) {
			// Use existing tier or default to tier 1
			const newTier = item.backlogTier === 0 ? 1 : item.backlogTier;
			const nextEligible = calculateBacklogNextEligibleTime(
				newTier,
				backlogConfig.tierDelaysDays,
				now
			);

			await db
				.update(searchRegistry)
				.set({
					state: 'cooldown',
					backlogTier: newTier,
					attemptCount: 0,
					nextEligible,
					updatedAt: now
				})
				.where(eq(searchRegistry.id, item.id));

			itemsRecovered++;
		}

		return {
			success: true,
			itemsRecovered,
			durationMs: Date.now() - startTime
		};
	} catch (error) {
		return {
			success: false,
			itemsRecovered: 0,
			durationMs: Date.now() - startTime,
			error: error instanceof Error ? error.message : String(error)
		};
	}
}
