/**
 * Search state cleanup utilities for full reconciliation and success detection.
 *
 * When content is removed from the *arr application during reconciliation,
 * we need to clean up the associated search registry entries since contentId
 * is not a foreign key and won't cascade delete automatically.
 *
 * Also handles cleanup when content status changes indicate success:
 * - Gap registries cleaned when hasFile becomes true
 * - Upgrade registries cleaned when qualityCutoffNotMet becomes false
 *
 * @module services/sync/search-state-cleanup

 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { searchRegistry } from '$lib/server/db/schema';

/**
 * Delete search registry entries for content being removed.
 *
 * This function handles the cascade delete of search state that doesn't
 * happen automatically since searchRegistry.contentId is not a foreign key
 * (it can reference either episodes.id or movies.id based on contentType).
 *
 * @param connectorId - The connector ID to scope the deletion
 * @param contentType - The type of content being deleted ('episode' | 'movie')
 * @param contentIds - Array of content IDs (database IDs, not arrIds) to delete search state for
 * @returns The number of search registry entries deleted
 *
 * @example
 * ```typescript
 * // Before deleting movies from the content mirror
 * const moviesToDelete = [1, 5, 23];
 * const deleted = await deleteSearchRegistryForContent(connectorId, 'movie', moviesToDelete);
 * console.log(`Cleaned up ${deleted} search registry entries`);
 * ```
 */
export async function deleteSearchRegistryForContent(
	connectorId: number,
	contentType: 'episode' | 'movie',
	contentIds: number[]
): Promise<number> {
	if (contentIds.length === 0) {
		return 0;
	}

	const result = await db
		.delete(searchRegistry)
		.where(
			and(
				eq(searchRegistry.connectorId, connectorId),
				eq(searchRegistry.contentType, contentType),
				inArray(searchRegistry.contentId, contentIds)
			)
		)
		.returning({ id: searchRegistry.id });

	return result.length;
}

/**
 * Delete all search registry entries for a list of episodes.
 *
 * Convenience wrapper for deleteSearchRegistryForContent with contentType='episode'.
 *
 * @param connectorId - The connector ID to scope the deletion
 * @param episodeIds - Array of episode database IDs to delete search state for
 * @returns The number of search registry entries deleted
 */
export async function deleteSearchRegistryForEpisodes(
	connectorId: number,
	episodeIds: number[]
): Promise<number> {
	return deleteSearchRegistryForContent(connectorId, 'episode', episodeIds);
}

/**
 * Delete all search registry entries for a list of movies.
 *
 * Convenience wrapper for deleteSearchRegistryForContent with contentType='movie'.
 *
 * @param connectorId - The connector ID to scope the deletion
 * @param movieIds - Array of movie database IDs to delete search state for
 * @returns The number of search registry entries deleted
 */
export async function deleteSearchRegistryForMovies(
	connectorId: number,
	movieIds: number[]
): Promise<number> {
	return deleteSearchRegistryForContent(connectorId, 'movie', movieIds);
}

// =============================================================================
// Success-based cleanup functions (Requirements 3.4, 4.4)
// =============================================================================

/**
 * Delete gap registry entries where the content now has hasFile=true.
 *
 * When content is successfully downloaded (hasFile changes from false to true),
 * the corresponding gap search registry entry should be deleted since the gap
 * has been resolved.
 *
 * @param connectorId - The connector ID to scope the cleanup
 * @returns The total number of search registry entries deleted (episodes + movies)
 *

 *                     THEN the System SHALL delete the corresponding search registry entry
 *
 * @example
 * ```typescript
 * // During gap discovery, clean up resolved gaps first
 * const resolved = await cleanupResolvedGapRegistries(connectorId);
 * console.log(`Cleaned up ${resolved} resolved gap entries`);
 * ```
 */
export async function cleanupResolvedGapRegistries(connectorId: number): Promise<number> {
	let totalDeleted = 0;

	// Clean up episode gap registries where hasFile is now true
	const episodeResult = await db.execute(sql`
		DELETE FROM search_registry sr
		WHERE sr.connector_id = ${connectorId}
		  AND sr.search_type = 'gap'
		  AND sr.content_type = 'episode'
		  AND EXISTS (
			SELECT 1 FROM episodes e
			WHERE e.id = sr.content_id
			  AND e.connector_id = sr.connector_id
			  AND e.has_file = true
		  )
		RETURNING sr.id
	`);
	totalDeleted += episodeResult.length;

	// Clean up movie gap registries where hasFile is now true
	const movieResult = await db.execute(sql`
		DELETE FROM search_registry sr
		WHERE sr.connector_id = ${connectorId}
		  AND sr.search_type = 'gap'
		  AND sr.content_type = 'movie'
		  AND EXISTS (
			SELECT 1 FROM movies m
			WHERE m.id = sr.content_id
			  AND m.connector_id = sr.connector_id
			  AND m.has_file = true
		  )
		RETURNING sr.id
	`);
	totalDeleted += movieResult.length;

	return totalDeleted;
}

/**
 * Delete upgrade registry entries where the content now has qualityCutoffNotMet=false.
 *
 * When content quality reaches or exceeds the cutoff (qualityCutoffNotMet changes
 * from true to false), the corresponding upgrade search registry entry should be
 * deleted since the upgrade goal has been achieved.
 *
 * @param connectorId - The connector ID to scope the cleanup
 * @returns The total number of search registry entries deleted (episodes + movies)
 *

 *                     THEN the System SHALL delete the corresponding search registry entry
 *
 * @example
 * ```typescript
 * // During upgrade discovery, clean up resolved upgrades first
 * const resolved = await cleanupResolvedUpgradeRegistries(connectorId);
 * console.log(`Cleaned up ${resolved} resolved upgrade entries`);
 * ```
 */
export async function cleanupResolvedUpgradeRegistries(connectorId: number): Promise<number> {
	let totalDeleted = 0;

	// Clean up episode upgrade registries where qualityCutoffNotMet is now false
	const episodeResult = await db.execute(sql`
		DELETE FROM search_registry sr
		WHERE sr.connector_id = ${connectorId}
		  AND sr.search_type = 'upgrade'
		  AND sr.content_type = 'episode'
		  AND EXISTS (
			SELECT 1 FROM episodes e
			WHERE e.id = sr.content_id
			  AND e.connector_id = sr.connector_id
			  AND e.quality_cutoff_not_met = false
		  )
		RETURNING sr.id
	`);
	totalDeleted += episodeResult.length;

	// Clean up movie upgrade registries where qualityCutoffNotMet is now false
	const movieResult = await db.execute(sql`
		DELETE FROM search_registry sr
		WHERE sr.connector_id = ${connectorId}
		  AND sr.search_type = 'upgrade'
		  AND sr.content_type = 'movie'
		  AND EXISTS (
			SELECT 1 FROM movies m
			WHERE m.id = sr.content_id
			  AND m.connector_id = sr.connector_id
			  AND m.quality_cutoff_not_met = false
		  )
		RETURNING sr.id
	`);
	totalDeleted += movieResult.length;

	return totalDeleted;
}
