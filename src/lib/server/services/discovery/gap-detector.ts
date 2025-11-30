/**
 * Gap detector service for identifying missing content.
 *
 * Queries the content mirror for monitored items with hasFile=false
 * and creates search registry entries for new gaps. Also cleans up
 * gap registries when content has been successfully downloaded.
 *
 * @module services/discovery/gap-detector
 * @requirements 3.1, 3.2, 3.3, 3.4
 */

import { db } from '$lib/server/db';
import { connectors, episodes, movies, searchRegistry } from '$lib/server/db/schema';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { GapDiscoveryResult, DiscoveryOptions, DiscoveryStats } from './types';
import { cleanupResolvedGapRegistries } from '../sync/search-state-cleanup';

/**
 * Default batch size for inserting search registry entries.
 */
const DEFAULT_BATCH_SIZE = 1000;

/**
 * Discovers content gaps for a connector and creates search registry entries.
 *
 * Gap discovery:
 * 1. Queries episodes/movies where monitored=true AND hasFile=false
 * 2. Excludes items that already have a search registry entry
 * 3. Creates new search registry entries with state='pending' and searchType='gap'
 *
 * The function is idempotent - running it multiple times won't create duplicate entries.
 *
 * @param connectorId - The connector ID to discover gaps for
 * @param options - Optional configuration for discovery behavior
 * @returns Discovery result with statistics about gaps found and registries created
 *
 * @example
 * ```typescript
 * const result = await discoverGaps(1);
 * console.log(`Found ${result.gapsFound} gaps, created ${result.registriesCreated} registries`);
 * ```
 *
 * @requirements 3.1, 3.2, 3.3
 */
export async function discoverGaps(
	connectorId: number,
	options: DiscoveryOptions = {}
): Promise<GapDiscoveryResult> {
	const startTime = Date.now();
	const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;

	try {
		// Get connector to verify it exists and get its type
		const connector = await db
			.select({ id: connectors.id, type: connectors.type })
			.from(connectors)
			.where(eq(connectors.id, connectorId))
			.limit(1);

		if (connector.length === 0) {
			return {
				success: false,
				connectorId,
				connectorType: 'sonarr', // Default, won't be used on error
				gapsFound: 0,
				registriesCreated: 0,
				registriesSkipped: 0,
				registriesResolved: 0,
				durationMs: Date.now() - startTime,
				error: `Connector ${connectorId} not found`
			};
		}

		const connectorType = connector[0]!.type as 'sonarr' | 'radarr' | 'whisparr';

		// Clean up gap registries where content now has hasFile=true
		// This handles requirement 3.4: delete registry when hasFile becomes true
		const registriesResolved = await cleanupResolvedGapRegistries(connectorId);

		// Discover gaps based on connector type
		let stats: DiscoveryStats;
		if (connectorType === 'radarr') {
			// Radarr only has movies
			stats = await discoverMovieGaps(connectorId, batchSize);
		} else {
			// Sonarr and Whisparr have episodes (and could potentially have movies in future)
			stats = await discoverEpisodeGaps(connectorId, batchSize);
		}

		const gapsFound = stats.episodeCount + stats.movieCount;
		const registriesCreated = stats.episodeRegistriesCreated + stats.movieRegistriesCreated;
		const registriesSkipped = gapsFound - registriesCreated;

		return {
			success: true,
			connectorId,
			connectorType,
			gapsFound,
			registriesCreated,
			registriesSkipped,
			registriesResolved,
			durationMs: Date.now() - startTime
		};
	} catch (error) {
		return {
			success: false,
			connectorId,
			connectorType: 'sonarr', // Default, won't be used on error
			gapsFound: 0,
			registriesCreated: 0,
			registriesSkipped: 0,
			registriesResolved: 0,
			durationMs: Date.now() - startTime,
			error: error instanceof Error ? error.message : String(error)
		};
	}
}

/**
 * Discovers episode gaps and creates search registry entries.
 *
 * Uses a LEFT JOIN to efficiently find episodes that:
 * - Are monitored (monitored=true)
 * - Don't have a file (hasFile=false)
 * - Don't already have a search registry entry
 *
 * @param connectorId - The connector ID to discover episode gaps for
 * @param batchSize - Batch size for inserting registries
 * @returns Statistics about discovered gaps
 *
 * @requirements 3.1, 3.3
 */
async function discoverEpisodeGaps(connectorId: number, batchSize: number): Promise<DiscoveryStats> {
	// Find all episode gaps (monitored=true AND hasFile=false)
	// Uses LEFT JOIN to check for existing search registry entries
	const episodeGaps = await db
		.select({
			id: episodes.id,
			connectorId: episodes.connectorId
		})
		.from(episodes)
		.leftJoin(
			searchRegistry,
			and(
				eq(searchRegistry.connectorId, episodes.connectorId),
				eq(searchRegistry.contentType, 'episode'),
				eq(searchRegistry.contentId, episodes.id)
			)
		)
		.where(
			and(
				eq(episodes.connectorId, connectorId),
				eq(episodes.monitored, true),
				eq(episodes.hasFile, false),
				isNull(searchRegistry.id) // No existing registry entry
			)
		);

	// Count total episode gaps for statistics (including those with existing registries)
	const totalEpisodeGapsResult = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(episodes)
		.where(
			and(
				eq(episodes.connectorId, connectorId),
				eq(episodes.monitored, true),
				eq(episodes.hasFile, false)
			)
		);

	const totalEpisodeGaps = totalEpisodeGapsResult[0]?.count ?? 0;

	// Create search registry entries in batches
	let registriesCreated = 0;

	for (let i = 0; i < episodeGaps.length; i += batchSize) {
		const batch = episodeGaps.slice(i, i + batchSize);

		if (batch.length > 0) {
			const inserted = await db
				.insert(searchRegistry)
				.values(
					batch.map((gap) => ({
						connectorId: gap.connectorId,
						contentType: 'episode' as const,
						contentId: gap.id,
						searchType: 'gap' as const,
						state: 'pending' as const,
						priority: 0
					}))
				)
				.onConflictDoNothing({
					target: [searchRegistry.connectorId, searchRegistry.contentType, searchRegistry.contentId]
				})
				.returning({ id: searchRegistry.id });

			registriesCreated += inserted.length;
		}
	}

	return {
		episodeCount: totalEpisodeGaps,
		movieCount: 0,
		episodeRegistriesCreated: registriesCreated,
		movieRegistriesCreated: 0
	};
}

/**
 * Discovers movie gaps and creates search registry entries.
 *
 * Uses a LEFT JOIN to efficiently find movies that:
 * - Are monitored (monitored=true)
 * - Don't have a file (hasFile=false)
 * - Don't already have a search registry entry
 *
 * @param connectorId - The connector ID to discover movie gaps for
 * @param batchSize - Batch size for inserting registries
 * @returns Statistics about discovered gaps
 *
 * @requirements 3.1, 3.3
 */
async function discoverMovieGaps(connectorId: number, batchSize: number): Promise<DiscoveryStats> {
	// Find all movie gaps (monitored=true AND hasFile=false)
	// Uses LEFT JOIN to check for existing search registry entries
	const movieGaps = await db
		.select({
			id: movies.id,
			connectorId: movies.connectorId
		})
		.from(movies)
		.leftJoin(
			searchRegistry,
			and(
				eq(searchRegistry.connectorId, movies.connectorId),
				eq(searchRegistry.contentType, 'movie'),
				eq(searchRegistry.contentId, movies.id)
			)
		)
		.where(
			and(
				eq(movies.connectorId, connectorId),
				eq(movies.monitored, true),
				eq(movies.hasFile, false),
				isNull(searchRegistry.id) // No existing registry entry
			)
		);

	// Count total movie gaps for statistics (including those with existing registries)
	const totalMovieGapsResult = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(movies)
		.where(
			and(eq(movies.connectorId, connectorId), eq(movies.monitored, true), eq(movies.hasFile, false))
		);

	const totalMovieGaps = totalMovieGapsResult[0]?.count ?? 0;

	// Create search registry entries in batches
	let registriesCreated = 0;

	for (let i = 0; i < movieGaps.length; i += batchSize) {
		const batch = movieGaps.slice(i, i + batchSize);

		if (batch.length > 0) {
			const inserted = await db
				.insert(searchRegistry)
				.values(
					batch.map((gap) => ({
						connectorId: gap.connectorId,
						contentType: 'movie' as const,
						contentId: gap.id,
						searchType: 'gap' as const,
						state: 'pending' as const,
						priority: 0
					}))
				)
				.onConflictDoNothing({
					target: [searchRegistry.connectorId, searchRegistry.contentType, searchRegistry.contentId]
				})
				.returning({ id: searchRegistry.id });

			registriesCreated += inserted.length;
		}
	}

	return {
		episodeCount: 0,
		movieCount: totalMovieGaps,
		episodeRegistriesCreated: 0,
		movieRegistriesCreated: registriesCreated
	};
}

/**
 * Gets gap statistics for a connector without creating registry entries.
 *
 * Useful for reporting and dashboard display without triggering discovery.
 *
 * @param connectorId - The connector ID to get gap stats for
 * @returns Object with episode and movie gap counts
 */
export async function getGapStats(
	connectorId: number
): Promise<{ episodeGaps: number; movieGaps: number }> {
	// Count episode gaps
	const episodeGapsResult = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(episodes)
		.where(
			and(
				eq(episodes.connectorId, connectorId),
				eq(episodes.monitored, true),
				eq(episodes.hasFile, false)
			)
		);

	// Count movie gaps
	const movieGapsResult = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(movies)
		.where(
			and(eq(movies.connectorId, connectorId), eq(movies.monitored, true), eq(movies.hasFile, false))
		);

	return {
		episodeGaps: episodeGapsResult[0]?.count ?? 0,
		movieGaps: movieGapsResult[0]?.count ?? 0
	};
}
