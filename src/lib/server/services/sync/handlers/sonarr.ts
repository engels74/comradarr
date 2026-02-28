import { and, eq, inArray, sql } from 'drizzle-orm';
import type { SonarrSeries } from '$lib/server/connectors/sonarr/types';
import { db } from '$lib/server/db';
import {
	getOldestPendingCommandForContent,
	markCommandFileAcquired
} from '$lib/server/db/queries/pending-commands';
import { episodes } from '$lib/server/db/schema';
import { createLogger } from '$lib/server/logger';
import { analyticsCollector } from '$lib/server/services/analytics';
import { mapEpisodeToDb } from '../mappers';
import type { SyncOptions } from '../types';
import {
	DEFAULT_CONCURRENCY,
	DEFAULT_REQUEST_DELAY_MS,
	parallelLimit,
	type SeriesClient,
	upsertSeasons,
	upsertSeries
} from './shared';

const logger = createLogger('sync-sonarr');

export async function syncSonarrContent(
	client: SeriesClient,
	connectorId: number,
	options?: SyncOptions
): Promise<number> {
	const startTime = Date.now();
	const concurrency = options?.concurrency ?? DEFAULT_CONCURRENCY;
	const requestDelayMs = options?.requestDelayMs ?? DEFAULT_REQUEST_DELAY_MS;

	const apiSeriesList = await client.getSeries();

	if (apiSeriesList.length === 0) {
		return 0;
	}

	logger.info('Syncing series from Sonarr', { connectorId, seriesCount: apiSeriesList.length });

	const seriesIdMap = await upsertSeries(connectorId, apiSeriesList);
	const seasonIdMap = await upsertSeasons(apiSeriesList, seriesIdMap);

	const episodeFetcher = async (apiSeries: SonarrSeries) => {
		return {
			seriesArrId: apiSeries.id,
			episodes: await client.getEpisodes(apiSeries.id)
		};
	};

	const episodeResults = await parallelLimit(
		apiSeriesList,
		concurrency,
		episodeFetcher,
		requestDelayMs
	);

	const { totalEpisodes, acquiredEpisodeIds } = await upsertEpisodes(
		connectorId,
		episodeResults,
		seriesIdMap,
		seasonIdMap
	);

	if (acquiredEpisodeIds.length > 0) {
		await recordFileAcquisitions(connectorId, acquiredEpisodeIds);
	}

	const durationMs = Date.now() - startTime;
	logger.info('Sonarr sync completed', {
		connectorId,
		seriesCount: apiSeriesList.length,
		episodeCount: totalEpisodes,
		filesAcquired: acquiredEpisodeIds.length,
		durationMs
	});

	return totalEpisodes;
}

interface EpisodeFetchResult {
	seriesArrId: number;
	episodes: Awaited<ReturnType<SeriesClient['getEpisodes']>>;
}

interface UpsertEpisodesResult {
	totalEpisodes: number;
	acquiredEpisodeIds: number[];
}

async function upsertEpisodes(
	connectorId: number,
	episodeResults: EpisodeFetchResult[],
	seriesIdMap: Map<number, number>,
	seasonIdMap: Map<string, number>
): Promise<UpsertEpisodesResult> {
	const episodeRecords: ReturnType<typeof mapEpisodeToDb>[] = [];

	for (const { seriesArrId, episodes: seriesEpisodes } of episodeResults) {
		const seriesDbId = seriesIdMap.get(seriesArrId);
		if (seriesDbId === undefined) continue;

		for (const apiEpisode of seriesEpisodes) {
			const seasonKey = `${seriesDbId}-${apiEpisode.seasonNumber}`;
			const seasonDbId = seasonIdMap.get(seasonKey);
			if (seasonDbId === undefined) continue;

			episodeRecords.push(mapEpisodeToDb(connectorId, seasonDbId, apiEpisode));
		}
	}

	if (episodeRecords.length === 0) {
		return { totalEpisodes: 0, acquiredEpisodeIds: [] };
	}

	// Query episodes that currently don't have files (before upsert)
	const arrIds = episodeRecords.map((r) => r.arrId);
	const episodesWithoutFiles = await db
		.select({ id: episodes.id, arrId: episodes.arrId })
		.from(episodes)
		.where(
			and(
				eq(episodes.connectorId, connectorId),
				inArray(episodes.arrId, arrIds),
				eq(episodes.hasFile, false)
			)
		);
	const arrIdsWithoutFiles = new Set(episodesWithoutFiles.map((e) => e.arrId));

	const result = await db
		.insert(episodes)
		.values(episodeRecords)
		.onConflictDoUpdate({
			target: [episodes.connectorId, episodes.arrId],
			set: {
				seasonId: sql`excluded.season_id`,
				seasonNumber: sql`excluded.season_number`,
				episodeNumber: sql`excluded.episode_number`,
				title: sql`excluded.title`,
				airDate: sql`excluded.air_date`,
				monitored: sql`excluded.monitored`,
				hasFile: sql`excluded.has_file`,
				quality: sql`excluded.quality`,
				qualityCutoffNotMet: sql`excluded.quality_cutoff_not_met`,
				episodeFileId: sql`excluded.episode_file_id`,
				// File tracking: set firstDownloadedAt when file first appears
				firstDownloadedAt: sql`CASE
					WHEN ${episodes.hasFile} = false AND excluded.has_file = true
						THEN COALESCE(${episodes.firstDownloadedAt}, now())
					ELSE ${episodes.firstDownloadedAt}
				END`,
				// File tracking: set fileLostAt and increment count when file disappears
				fileLostAt: sql`CASE
					WHEN ${episodes.hasFile} = true AND excluded.has_file = false
						THEN now()
					WHEN excluded.has_file = true
						THEN NULL
					ELSE ${episodes.fileLostAt}
				END`,
				fileLossCount: sql`CASE
					WHEN ${episodes.hasFile} = true AND excluded.has_file = false
						THEN ${episodes.fileLossCount} + 1
					ELSE ${episodes.fileLossCount}
				END`,
				updatedAt: sql`now()`
			}
		})
		.returning({
			id: episodes.id,
			arrId: episodes.arrId,
			hasFile: episodes.hasFile
		});

	// Detect file acquisitions: episodes that didn't have files before but now do
	const acquiredEpisodeIds = result
		.filter((r) => r.hasFile && arrIdsWithoutFiles.has(r.arrId))
		.map((r) => r.id);

	return { totalEpisodes: episodeRecords.length, acquiredEpisodeIds };
}

async function recordFileAcquisitions(
	connectorId: number,
	acquiredEpisodeIds: number[]
): Promise<void> {
	for (const episodeId of acquiredEpisodeIds) {
		try {
			const pendingCommand = await getOldestPendingCommandForContent('episode', episodeId);

			if (pendingCommand) {
				const timeSinceDispatchMs = Date.now() - pendingCommand.dispatchedAt.getTime();

				await markCommandFileAcquired(pendingCommand.id);

				await analyticsCollector.recordSearchSuccessful(
					connectorId,
					pendingCommand.searchRegistryId,
					'episode',
					pendingCommand.searchType as 'gap' | 'upgrade',
					pendingCommand.commandId,
					timeSinceDispatchMs
				);

				logger.debug('File acquisition recorded for episode', {
					episodeId,
					connectorId,
					commandId: pendingCommand.commandId,
					timeSinceDispatchMs
				});
			}
		} catch (error) {
			logger.warn('Failed to record file acquisition', {
				episodeId,
				connectorId,
				error: error instanceof Error ? error.message : String(error)
			});
		}
	}
}
