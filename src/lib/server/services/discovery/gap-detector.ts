import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { connectors, episodes, movies, searchRegistry } from '$lib/server/db/schema';
import { createLogger } from '$lib/server/logger';
import { cleanupResolvedGapRegistries } from '../sync/search-state-cleanup';
import type { DiscoveryOptions, DiscoveryStats, GapDiscoveryResult } from './types';

const logger = createLogger('gap-detector');
const DEFAULT_BATCH_SIZE = 1000;

/** Idempotent - uses onConflictDoNothing so running multiple times won't create duplicates. */
export async function discoverGaps(
	connectorId: number,
	options: DiscoveryOptions = {}
): Promise<GapDiscoveryResult> {
	const startTime = Date.now();
	const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;

	logger.info('Gap discovery started', { connectorId, batchSize });

	try {
		const connector = await db
			.select({ id: connectors.id, type: connectors.type })
			.from(connectors)
			.where(eq(connectors.id, connectorId))
			.limit(1);

		if (connector.length === 0) {
			logger.warn('Connector not found for gap discovery', { connectorId });
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

		const registriesResolved = await cleanupResolvedGapRegistries(connectorId);
		if (registriesResolved > 0) {
			logger.debug('Resolved gap registries cleaned up', { connectorId, registriesResolved });
		}

		let stats: DiscoveryStats;
		if (connectorType === 'radarr') {
			stats = await discoverMovieGaps(connectorId, batchSize);
		} else {
			stats = await discoverEpisodeGaps(connectorId, batchSize);
		}

		const gapsFound = stats.episodeCount + stats.movieCount;
		const registriesCreated = stats.episodeRegistriesCreated + stats.movieRegistriesCreated;
		const registriesSkipped = gapsFound - registriesCreated;

		logger.info('Gap discovery completed', {
			connectorId,
			connectorType,
			gapsFound,
			registriesCreated,
			registriesSkipped,
			registriesResolved,
			durationMs: Date.now() - startTime
		});

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
		const errorMessage = error instanceof Error ? error.message : String(error);
		logger.error('Gap discovery failed', {
			connectorId,
			error: errorMessage,
			durationMs: Date.now() - startTime
		});
		return {
			success: false,
			connectorId,
			connectorType: 'sonarr', // Default, won't be used on error
			gapsFound: 0,
			registriesCreated: 0,
			registriesSkipped: 0,
			registriesResolved: 0,
			durationMs: Date.now() - startTime,
			error: errorMessage
		};
	}
}

async function discoverEpisodeGaps(
	connectorId: number,
	batchSize: number
): Promise<DiscoveryStats> {
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
				isNull(searchRegistry.id)
			)
		);

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

		// Progress logging for large batches
		const processedCount = i + batch.length;
		if (processedCount > 0 && processedCount % 500 === 0 && processedCount < episodeGaps.length) {
			logger.info('Gap discovery progress', {
				connectorId,
				processedItems: processedCount,
				totalItems: episodeGaps.length
			});
		}
	}

	return {
		episodeCount: totalEpisodeGaps,
		movieCount: 0,
		episodeRegistriesCreated: registriesCreated,
		movieRegistriesCreated: 0
	};
}

async function discoverMovieGaps(connectorId: number, batchSize: number): Promise<DiscoveryStats> {
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
				isNull(searchRegistry.id)
			)
		);

	const totalMovieGapsResult = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(movies)
		.where(
			and(
				eq(movies.connectorId, connectorId),
				eq(movies.monitored, true),
				eq(movies.hasFile, false)
			)
		);

	const totalMovieGaps = totalMovieGapsResult[0]?.count ?? 0;

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

		// Progress logging for large batches
		const processedCount = i + batch.length;
		if (processedCount > 0 && processedCount % 500 === 0 && processedCount < movieGaps.length) {
			logger.info('Gap discovery progress', {
				connectorId,
				processedItems: processedCount,
				totalItems: movieGaps.length
			});
		}
	}

	return {
		episodeCount: 0,
		movieCount: totalMovieGaps,
		episodeRegistriesCreated: 0,
		movieRegistriesCreated: registriesCreated
	};
}

export async function getGapStats(
	connectorId: number
): Promise<{ episodeGaps: number; movieGaps: number }> {
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

	const movieGapsResult = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(movies)
		.where(
			and(
				eq(movies.connectorId, connectorId),
				eq(movies.monitored, true),
				eq(movies.hasFile, false)
			)
		);

	return {
		episodeGaps: episodeGapsResult[0]?.count ?? 0,
		movieGaps: movieGapsResult[0]?.count ?? 0
	};
}
