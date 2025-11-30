/**
 * Search state cleanup utilities for full reconciliation.
 *
 * When content is removed from the *arr application during reconciliation,
 * we need to clean up the associated search registry entries since contentId
 * is not a foreign key and won't cascade delete automatically.
 *
 * @module services/sync/search-state-cleanup
 * @requirements 2.2
 */

import { db } from '$lib/server/db';
import { searchRegistry } from '$lib/server/db/schema';
import { and, eq, inArray } from 'drizzle-orm';

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
