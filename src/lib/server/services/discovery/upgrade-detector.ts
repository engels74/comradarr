// qualityCutoffNotMet flag comes from *arr API and already accounts for Custom Format scores

import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { connectors, episodes, movies, searchRegistry } from '$lib/server/db/schema';
import { cleanupResolvedUpgradeRegistries } from '../sync/search-state-cleanup';
import type { DiscoveryOptions, DiscoveryStats, UpgradeDiscoveryResult } from './types';

const DEFAULT_BATCH_SIZE = 1000;

export async function discoverUpgrades(
	connectorId: number,
	options: DiscoveryOptions = {}
): Promise<UpgradeDiscoveryResult> {
	const startTime = Date.now();
	const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;

	try {
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

		// Clean up registries where qualityCutoffNotMet became false (requirement 4.4)
		const registriesResolved = await cleanupResolvedUpgradeRegistries(connectorId);

		let stats: DiscoveryStats;
		if (connectorType === 'radarr') {
			stats = await discoverMovieUpgrades(connectorId, batchSize);
		} else {
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

async function discoverEpisodeUpgrades(
	connectorId: number,
	batchSize: number
): Promise<DiscoveryStats> {
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

async function discoverMovieUpgrades(
	connectorId: number,
	batchSize: number
): Promise<DiscoveryStats> {
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

export async function getUpgradeStats(
	connectorId: number
): Promise<{ episodeUpgrades: number; movieUpgrades: number }> {
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
