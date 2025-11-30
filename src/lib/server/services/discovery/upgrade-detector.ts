/**
 * Upgrade detector service for identifying content that can be upgraded.
 *
 * Queries the content mirror for monitored items with hasFile=true AND
 * qualityCutoffNotMet=true and creates search registry entries for new
 * upgrade candidates. Also cleans up upgrade registries when content quality
 * has reached the cutoff.
 *
 * The qualityCutoffNotMet flag comes from the *arr API and already accounts
 * for Custom Format scores in Radarr/Sonarr v3+.
 *
 * @module services/discovery/upgrade-detector
 * @requirements 4.1, 4.2, 4.3, 4.4
 */

import { db } from '$lib/server/db';
import { connectors, episodes, movies, searchRegistry } from '$lib/server/db/schema';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { UpgradeDiscoveryResult, DiscoveryOptions, DiscoveryStats } from './types';
import { cleanupResolvedUpgradeRegistries } from '../sync/search-state-cleanup';

/**
 * Default batch size for inserting search registry entries.
 */
const DEFAULT_BATCH_SIZE = 1000;

/**
 * Discovers upgrade candidates for a connector and creates search registry entries.
 *
 * Upgrade discovery:
 * 1. Queries episodes/movies where monitored=true AND hasFile=true AND qualityCutoffNotMet=true
 * 2. Excludes items that already have a search registry entry
 * 3. Creates new search registry entries with state='pending' and searchType='upgrade'
 *
 * The function is idempotent - running it multiple times won't create duplicate entries.
 *
 * @param connectorId - The connector ID to discover upgrades for
 * @param options - Optional configuration for discovery behavior
 * @returns Discovery result with statistics about upgrades found and registries created
 *
 * @example
 * ```typescript
 * const result = await discoverUpgrades(1);
 * console.log(`Found ${result.upgradesFound} upgrades, created ${result.registriesCreated} registries`);
 * ```
 *
 * @requirements 4.1, 4.2, 4.3
 */
export async function discoverUpgrades(
	connectorId: number,
	options: DiscoveryOptions = {}
): Promise<UpgradeDiscoveryResult> {
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
				upgradesFound: 0,
				registriesCreated: 0,
				registriesSkipped: 0,
				registriesResolved: 0,
				durationMs: Date.now() - startTime,
				error: `Connector ${connectorId} not found`
			};
		}

		const connectorType = connector[0]!.type as 'sonarr' | 'radarr' | 'whisparr';

		// Clean up upgrade registries where content now has qualityCutoffNotMet=false
		// This handles requirement 4.4: delete registry when qualityCutoffNotMet becomes false
		const registriesResolved = await cleanupResolvedUpgradeRegistries(connectorId);

		// Discover upgrades based on connector type
		let stats: DiscoveryStats;
		if (connectorType === 'radarr') {
			// Radarr only has movies
			stats = await discoverMovieUpgrades(connectorId, batchSize);
		} else {
			// Sonarr and Whisparr have episodes
			stats = await discoverEpisodeUpgrades(connectorId, batchSize);
		}

		const upgradesFound = stats.episodeCount + stats.movieCount;
		const registriesCreated = stats.episodeRegistriesCreated + stats.movieRegistriesCreated;
		const registriesSkipped = upgradesFound - registriesCreated;

		return {
			success: true,
			connectorId,
			connectorType,
			upgradesFound,
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
			upgradesFound: 0,
			registriesCreated: 0,
			registriesSkipped: 0,
			registriesResolved: 0,
			durationMs: Date.now() - startTime,
			error: error instanceof Error ? error.message : String(error)
		};
	}
}

/**
 * Discovers episode upgrade candidates and creates search registry entries.
 *
 * Uses a LEFT JOIN to efficiently find episodes that:
 * - Are monitored (monitored=true)
 * - Have a file (hasFile=true)
 * - Are below quality cutoff (qualityCutoffNotMet=true)
 * - Don't already have a search registry entry
 *
 * @param connectorId - The connector ID to discover episode upgrades for
 * @param batchSize - Batch size for inserting registries
 * @returns Statistics about discovered upgrade candidates
 *
 * @requirements 4.1, 4.3
 */
async function discoverEpisodeUpgrades(
	connectorId: number,
	batchSize: number
): Promise<DiscoveryStats> {
	// Find all episode upgrade candidates (monitored=true AND hasFile=true AND qualityCutoffNotMet=true)
	// Uses LEFT JOIN to check for existing search registry entries
	const episodeUpgrades = await db
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
				eq(episodes.hasFile, true),
				eq(episodes.qualityCutoffNotMet, true),
				isNull(searchRegistry.id) // No existing registry entry
			)
		);

	// Count total episode upgrade candidates for statistics (including those with existing registries)
	const totalEpisodeUpgradesResult = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(episodes)
		.where(
			and(
				eq(episodes.connectorId, connectorId),
				eq(episodes.monitored, true),
				eq(episodes.hasFile, true),
				eq(episodes.qualityCutoffNotMet, true)
			)
		);

	const totalEpisodeUpgrades = totalEpisodeUpgradesResult[0]?.count ?? 0;

	// Create search registry entries in batches
	let registriesCreated = 0;

	for (let i = 0; i < episodeUpgrades.length; i += batchSize) {
		const batch = episodeUpgrades.slice(i, i + batchSize);

		if (batch.length > 0) {
			const inserted = await db
				.insert(searchRegistry)
				.values(
					batch.map((upgrade) => ({
						connectorId: upgrade.connectorId,
						contentType: 'episode' as const,
						contentId: upgrade.id,
						searchType: 'upgrade' as const,
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
		episodeCount: totalEpisodeUpgrades,
		movieCount: 0,
		episodeRegistriesCreated: registriesCreated,
		movieRegistriesCreated: 0
	};
}

/**
 * Discovers movie upgrade candidates and creates search registry entries.
 *
 * Uses a LEFT JOIN to efficiently find movies that:
 * - Are monitored (monitored=true)
 * - Have a file (hasFile=true)
 * - Are below quality cutoff (qualityCutoffNotMet=true)
 * - Don't already have a search registry entry
 *
 * @param connectorId - The connector ID to discover movie upgrades for
 * @param batchSize - Batch size for inserting registries
 * @returns Statistics about discovered upgrade candidates
 *
 * @requirements 4.1, 4.3
 */
async function discoverMovieUpgrades(
	connectorId: number,
	batchSize: number
): Promise<DiscoveryStats> {
	// Find all movie upgrade candidates (monitored=true AND hasFile=true AND qualityCutoffNotMet=true)
	// Uses LEFT JOIN to check for existing search registry entries
	const movieUpgrades = await db
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
				eq(movies.hasFile, true),
				eq(movies.qualityCutoffNotMet, true),
				isNull(searchRegistry.id) // No existing registry entry
			)
		);

	// Count total movie upgrade candidates for statistics (including those with existing registries)
	const totalMovieUpgradesResult = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(movies)
		.where(
			and(
				eq(movies.connectorId, connectorId),
				eq(movies.monitored, true),
				eq(movies.hasFile, true),
				eq(movies.qualityCutoffNotMet, true)
			)
		);

	const totalMovieUpgrades = totalMovieUpgradesResult[0]?.count ?? 0;

	// Create search registry entries in batches
	let registriesCreated = 0;

	for (let i = 0; i < movieUpgrades.length; i += batchSize) {
		const batch = movieUpgrades.slice(i, i + batchSize);

		if (batch.length > 0) {
			const inserted = await db
				.insert(searchRegistry)
				.values(
					batch.map((upgrade) => ({
						connectorId: upgrade.connectorId,
						contentType: 'movie' as const,
						contentId: upgrade.id,
						searchType: 'upgrade' as const,
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
		movieCount: totalMovieUpgrades,
		episodeRegistriesCreated: 0,
		movieRegistriesCreated: registriesCreated
	};
}

/**
 * Gets upgrade statistics for a connector without creating registry entries.
 *
 * Useful for reporting and dashboard display without triggering discovery.
 *
 * @param connectorId - The connector ID to get upgrade stats for
 * @returns Object with episode and movie upgrade counts
 */
export async function getUpgradeStats(
	connectorId: number
): Promise<{ episodeUpgrades: number; movieUpgrades: number }> {
	// Count episode upgrade candidates
	const episodeUpgradesResult = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(episodes)
		.where(
			and(
				eq(episodes.connectorId, connectorId),
				eq(episodes.monitored, true),
				eq(episodes.hasFile, true),
				eq(episodes.qualityCutoffNotMet, true)
			)
		);

	// Count movie upgrade candidates
	const movieUpgradesResult = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(movies)
		.where(
			and(
				eq(movies.connectorId, connectorId),
				eq(movies.monitored, true),
				eq(movies.hasFile, true),
				eq(movies.qualityCutoffNotMet, true)
			)
		);

	return {
		episodeUpgrades: episodeUpgradesResult[0]?.count ?? 0,
		movieUpgrades: movieUpgradesResult[0]?.count ?? 0
	};
}
