import { sql } from 'drizzle-orm';
import type { SonarrClient } from '$lib/server/connectors/sonarr/client';
import type { SonarrSeries } from '$lib/server/connectors/sonarr/types';
import type { WhisparrClient } from '$lib/server/connectors/whisparr/client';
import { db } from '$lib/server/db';
import { episodes, seasons, series } from '$lib/server/db/schema';
import { createLogger } from '$lib/server/logger';
import { mapEpisodeToDb, mapSeasonToDb, mapSeriesToDb } from '../mappers';
import type { SyncOptions } from '../types';

const logger = createLogger('sync-sonarr');

const DEFAULT_CONCURRENCY = 5;
const DEFAULT_REQUEST_DELAY_MS = 100;

type SeriesClient = SonarrClient | WhisparrClient;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// Worker pool pattern: N workers pull from shared queue with optional delay between requests
async function parallelLimit<T, R>(
	items: T[],
	limit: number,
	fn: (item: T) => Promise<R>,
	delayMs?: number
): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let index = 0;
	let startCount = 0;

	async function worker(): Promise<void> {
		while (index < items.length) {
			const currentIndex = index++;
			const item = items[currentIndex];
			if (item === undefined) continue;

			// Apply delay between starting requests to avoid rate limiting
			if (delayMs && startCount > 0) {
				await sleep(delayMs);
			}
			startCount++;

			results[currentIndex] = await fn(item);
		}
	}

	const workerCount = Math.min(limit, items.length);
	const workers = Array.from({ length: workerCount }, () => worker());
	await Promise.all(workers);

	return results;
}

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

	const totalEpisodes = await upsertEpisodes(connectorId, episodeResults, seriesIdMap, seasonIdMap);

	const durationMs = Date.now() - startTime;
	logger.info('Sonarr sync completed', {
		connectorId,
		seriesCount: apiSeriesList.length,
		episodeCount: totalEpisodes,
		durationMs
	});

	return totalEpisodes;
}

async function upsertSeries(
	connectorId: number,
	apiSeriesList: SonarrSeries[]
): Promise<Map<number, number>> {
	const seriesRecords = apiSeriesList.map((s) => mapSeriesToDb(connectorId, s));

	const results = await db
		.insert(series)
		.values(seriesRecords)
		.onConflictDoUpdate({
			target: [series.connectorId, series.arrId],
			set: {
				tvdbId: sql`excluded.tvdb_id`,
				title: sql`excluded.title`,
				status: sql`excluded.status`,
				monitored: sql`excluded.monitored`,
				qualityProfileId: sql`excluded.quality_profile_id`,
				updatedAt: sql`now()`
			}
		})
		.returning({ id: series.id, arrId: series.arrId });

	const seriesIdMap = new Map<number, number>();
	for (const result of results) {
		seriesIdMap.set(result.arrId, result.id);
	}

	return seriesIdMap;
}

async function upsertSeasons(
	apiSeriesList: SonarrSeries[],
	seriesIdMap: Map<number, number>
): Promise<Map<string, number>> {
	const seasonRecords: ReturnType<typeof mapSeasonToDb>[] = [];

	for (const apiSeries of apiSeriesList) {
		const seriesDbId = seriesIdMap.get(apiSeries.id);
		if (seriesDbId === undefined) continue;

		for (const apiSeason of apiSeries.seasons) {
			seasonRecords.push(mapSeasonToDb(seriesDbId, apiSeason));
		}
	}

	if (seasonRecords.length === 0) {
		return new Map();
	}

	const results = await db
		.insert(seasons)
		.values(seasonRecords)
		.onConflictDoUpdate({
			target: [seasons.seriesId, seasons.seasonNumber],
			set: {
				monitored: sql`excluded.monitored`,
				totalEpisodes: sql`excluded.total_episodes`,
				downloadedEpisodes: sql`excluded.downloaded_episodes`,
				updatedAt: sql`now()`
			}
		})
		.returning({
			id: seasons.id,
			seriesId: seasons.seriesId,
			seasonNumber: seasons.seasonNumber
		});

	const seasonIdMap = new Map<string, number>();
	for (const result of results) {
		const key = `${result.seriesId}-${result.seasonNumber}`;
		seasonIdMap.set(key, result.id);
	}

	return seasonIdMap;
}

interface EpisodeFetchResult {
	seriesArrId: number;
	episodes: Awaited<ReturnType<SeriesClient['getEpisodes']>>;
}

async function upsertEpisodes(
	connectorId: number,
	episodeResults: EpisodeFetchResult[],
	seriesIdMap: Map<number, number>,
	seasonIdMap: Map<string, number>
): Promise<number> {
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
		return 0;
	}

	await db
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
		});

	return episodeRecords.length;
}
