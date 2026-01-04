/**
 * Sonarr/Whisparr sync handler
 *
 * Handles incremental sync for Sonarr and Whisparr TV series libraries.
 * Fetches all series, seasons, and episodes from the API and upserts them into the content mirror.
 *
 * @module services/sync/handlers/sonarr

 */

import { sql } from 'drizzle-orm';
import type { SonarrClient } from '$lib/server/connectors/sonarr/client';
import type { SonarrSeries } from '$lib/server/connectors/sonarr/types';
import type { WhisparrClient } from '$lib/server/connectors/whisparr/client';
import { db } from '$lib/server/db';
import { episodes, seasons, series } from '$lib/server/db/schema';
import { mapEpisodeToDb, mapSeasonToDb, mapSeriesToDb } from '../mappers';
import type { SyncOptions } from '../types';

/** Default concurrency for parallel episode fetching */
const DEFAULT_CONCURRENCY = 5;

/** Default delay between API requests in milliseconds */
const DEFAULT_REQUEST_DELAY_MS = 100;

/**
 * Type representing either SonarrClient or WhisparrClient
 * Both have identical APIs for series/episode management
 */
type SeriesClient = SonarrClient | WhisparrClient;

/**
 * Sleep for a specified number of milliseconds
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute async functions with limited concurrency and optional delay between requests.
 *
 * This prevents overwhelming the *arr API while still providing parallelization benefits.
 * Uses a worker pool pattern where N workers pull from a shared queue.
 *
 * @param items - Items to process
 * @param limit - Maximum concurrent operations
 * @param fn - Async function to execute for each item
 * @param delayMs - Optional delay between starting each request
 * @returns Array of results in the same order as input items
 */
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

	// Create workers up to the limit
	const workerCount = Math.min(limit, items.length);
	const workers = Array.from({ length: workerCount }, () => worker());
	await Promise.all(workers);

	return results;
}

/**
 * Sync all series, seasons, and episodes from a Sonarr or Whisparr instance.
 *
 * Process:
 * 1. Fetch all series via getSeries() (single API call)
 * 2. Upsert series to DB, build arrId → dbId map
 * 3. Extract and upsert seasons from series response
 * 4. Fetch episodes per series with parallelization (limit 5, 100ms delay)
 * 5. Upsert all episodes using ON CONFLICT DO UPDATE
 *
 * @param client - SonarrClient or WhisparrClient instance
 * @param connectorId - The database ID of the connector being synced
 * @param options - Sync options for concurrency and rate limiting
 * @returns The total number of episodes processed
 *

 */
export async function syncSonarrContent(
	client: SeriesClient,
	connectorId: number,
	options?: SyncOptions
): Promise<number> {
	const concurrency = options?.concurrency ?? DEFAULT_CONCURRENCY;
	const requestDelayMs = options?.requestDelayMs ?? DEFAULT_REQUEST_DELAY_MS;

	// Phase 1: Fetch all series (single API call)
	const apiSeriesList = await client.getSeries();

	if (apiSeriesList.length === 0) {
		return 0;
	}

	// Phase 2: Upsert series and build arrId → dbId map
	const seriesIdMap = await upsertSeries(connectorId, apiSeriesList);

	// Phase 3: Upsert seasons and build lookup map
	const seasonIdMap = await upsertSeasons(apiSeriesList, seriesIdMap);

	// Phase 4: Fetch episodes with parallelization
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

	// Phase 5: Collect and upsert all episodes
	const totalEpisodes = await upsertEpisodes(connectorId, episodeResults, seriesIdMap, seasonIdMap);

	return totalEpisodes;
}

/**
 * Upsert all series and return a map of arrId → dbId
 */
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

/**
 * Upsert all seasons and return a map of `${seriesDbId}-${seasonNumber}` → seasonDbId
 */
async function upsertSeasons(
	apiSeriesList: SonarrSeries[],
	seriesIdMap: Map<number, number>
): Promise<Map<string, number>> {
	// Collect all seasons from all series
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

/**
 * Result of fetching episodes for a series
 */
interface EpisodeFetchResult {
	seriesArrId: number;
	episodes: Awaited<ReturnType<SeriesClient['getEpisodes']>>;
}

/**
 * Upsert all episodes from the fetched results
 */
async function upsertEpisodes(
	connectorId: number,
	episodeResults: EpisodeFetchResult[],
	seriesIdMap: Map<number, number>,
	seasonIdMap: Map<string, number>
): Promise<number> {
	// Collect all episode records
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

	// Upsert all episodes
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
				updatedAt: sql`now()`
			}
		});

	return episodeRecords.length;
}
