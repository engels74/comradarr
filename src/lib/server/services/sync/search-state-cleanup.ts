// contentId is not a FK so won't cascade delete; must clean up search registry manually

import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { searchRegistry } from '$lib/server/db/schema';

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

export async function deleteSearchRegistryForEpisodes(
	connectorId: number,
	episodeIds: number[]
): Promise<number> {
	return deleteSearchRegistryForContent(connectorId, 'episode', episodeIds);
}

export async function deleteSearchRegistryForMovies(
	connectorId: number,
	movieIds: number[]
): Promise<number> {
	return deleteSearchRegistryForContent(connectorId, 'movie', movieIds);
}

// Deletes gap registries where hasFile is now true (gap resolved)
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

// Deletes upgrade registries where qualityCutoffNotMet is now false (upgrade achieved)
// Only cleans up items that have been searched at least once (lastSearched IS NOT NULL)
export async function cleanupResolvedUpgradeRegistries(connectorId: number): Promise<number> {
	let totalDeleted = 0;

	// Clean up episode upgrade registries where qualityCutoffNotMet is now false
	// AND the item has been searched at least once
	const episodeResult = await db.execute(sql`
		DELETE FROM search_registry sr
		WHERE sr.connector_id = ${connectorId}
		  AND sr.search_type = 'upgrade'
		  AND sr.content_type = 'episode'
		  AND sr.last_searched IS NOT NULL
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
	// AND the item has been searched at least once
	const movieResult = await db.execute(sql`
		DELETE FROM search_registry sr
		WHERE sr.connector_id = ${connectorId}
		  AND sr.search_type = 'upgrade'
		  AND sr.content_type = 'movie'
		  AND sr.last_searched IS NOT NULL
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
