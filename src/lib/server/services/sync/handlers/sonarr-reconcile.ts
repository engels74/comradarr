// Unlike incremental sync which only upserts, reconciliation also deletes removed content

import { and, eq, inArray, sql } from 'drizzle-orm';
import type { SonarrClient } from '$lib/server/connectors/sonarr/client';
import type { SonarrSeries } from '$lib/server/connectors/sonarr/types';
import type { WhisparrClient } from '$lib/server/connectors/whisparr/client';
import { db } from '$lib/server/db';
import { episodes, seasons, series } from '$lib/server/db/schema';
import { mapEpisodeToDb, mapSeasonToDb, mapSeriesToDb } from '../mappers';
import { deleteSearchRegistryForEpisodes } from '../search-state-cleanup';
import type { SyncOptions } from '../types';

const DEFAULT_CONCURRENCY = 5;
const DEFAULT_REQUEST_DELAY_MS = 100;

type SeriesClient = SonarrClient | WhisparrClient;

export interface SonarrReconcileResult {
	seriesCreated: number;
	seriesUpdated: number;
	seriesDeleted: number;
	episodesCreated: number;
	episodesUpdated: number;
	episodesDeleted: number;
	searchStateDeleted: number;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

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

export async function reconcileSonarrContent(
	client: SeriesClient,
	connectorId: number,
	options?: SyncOptions
): Promise<SonarrReconcileResult> {
	const concurrency = options?.concurrency ?? DEFAULT_CONCURRENCY;
	const requestDelayMs = options?.requestDelayMs ?? DEFAULT_REQUEST_DELAY_MS;

	const result: SonarrReconcileResult = {
		seriesCreated: 0,
		seriesUpdated: 0,
		seriesDeleted: 0,
		episodesCreated: 0,
		episodesUpdated: 0,
		episodesDeleted: 0,
		searchStateDeleted: 0
	};

	// Phase 1: Fetch all series from API
	const apiSeriesList = await client.getSeries();
	const apiSeriesArrIds = new Set(apiSeriesList.map((s) => s.id));

	// Phase 2: Get existing series from DB
	const existingSeries = await db
		.select({ id: series.id, arrId: series.arrId })
		.from(series)
		.where(eq(series.connectorId, connectorId));

	const existingSeriesMap = new Map(existingSeries.map((s) => [s.arrId, s.id]));

	// Phase 3: Identify and delete series that no longer exist in API
	const seriesArrIdsToDelete = existingSeries
		.filter((s) => !apiSeriesArrIds.has(s.arrId))
		.map((s) => s.arrId);

	if (seriesArrIdsToDelete.length > 0) {
		// Get all episode IDs for series being deleted (need DB IDs for search registry cleanup)
		const episodesToDelete = await db
			.select({ id: episodes.id })
			.from(episodes)
			.innerJoin(seasons, eq(episodes.seasonId, seasons.id))
			.innerJoin(series, eq(seasons.seriesId, series.id))
			.where(and(eq(series.connectorId, connectorId), inArray(series.arrId, seriesArrIdsToDelete)));

		const episodeIdsToDelete = episodesToDelete.map((e) => e.id);

		// Delete search registry entries for episodes being removed
		if (episodeIdsToDelete.length > 0) {
			result.searchStateDeleted += await deleteSearchRegistryForEpisodes(
				connectorId,
				episodeIdsToDelete
			);
		}

		// Delete series (cascades to seasons and episodes via FK)
		await db
			.delete(series)
			.where(and(eq(series.connectorId, connectorId), inArray(series.arrId, seriesArrIdsToDelete)));

		result.seriesDeleted = seriesArrIdsToDelete.length;
		result.episodesDeleted = episodeIdsToDelete.length;
	}

	// Phase 4: Upsert series and track created vs updated
	if (apiSeriesList.length > 0) {
		const { seriesIdMap, created, updated } = await upsertSeriesWithTracking(
			connectorId,
			apiSeriesList,
			existingSeriesMap
		);

		result.seriesCreated = created;
		result.seriesUpdated = updated;

		// Phase 5: Upsert seasons
		const seasonIdMap = await upsertSeasons(apiSeriesList, seriesIdMap);

		// Phase 6: Fetch and reconcile episodes per series
		const episodeResults = await parallelLimit(
			apiSeriesList,
			concurrency,
			async (apiSeries) => {
				const seriesDbId = seriesIdMap.get(apiSeries.id);
				if (seriesDbId === undefined) {
					return { seriesArrId: apiSeries.id, episodes: [], dbId: undefined };
				}
				return {
					seriesArrId: apiSeries.id,
					episodes: await client.getEpisodes(apiSeries.id),
					dbId: seriesDbId
				};
			},
			requestDelayMs
		);

		// Phase 7: Reconcile episodes (delete removed, upsert existing/new)
		for (const episodeResult of episodeResults) {
			if (episodeResult.dbId === undefined) continue;

			const episodeReconcileResult = await reconcileEpisodesForSeries(
				connectorId,
				episodeResult.dbId,
				episodeResult.seriesArrId,
				episodeResult.episodes,
				seriesIdMap,
				seasonIdMap
			);

			result.episodesCreated += episodeReconcileResult.created;
			result.episodesUpdated += episodeReconcileResult.updated;
			result.episodesDeleted += episodeReconcileResult.deleted;
			result.searchStateDeleted += episodeReconcileResult.searchStateDeleted;
		}
	}

	return result;
}

async function upsertSeriesWithTracking(
	connectorId: number,
	apiSeriesList: SonarrSeries[],
	existingSeriesMap: Map<number, number>
): Promise<{ seriesIdMap: Map<number, number>; created: number; updated: number }> {
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
	let created = 0;
	let updated = 0;

	for (const result of results) {
		seriesIdMap.set(result.arrId, result.id);
		if (existingSeriesMap.has(result.arrId)) {
			updated++;
		} else {
			created++;
		}
	}

	return { seriesIdMap, created, updated };
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

async function reconcileEpisodesForSeries(
	connectorId: number,
	seriesDbId: number,
	_seriesArrId: number,
	apiEpisodes: Awaited<ReturnType<SeriesClient['getEpisodes']>>,
	_seriesIdMap: Map<number, number>,
	seasonIdMap: Map<string, number>
): Promise<{ created: number; updated: number; deleted: number; searchStateDeleted: number }> {
	const result = { created: 0, updated: 0, deleted: 0, searchStateDeleted: 0 };

	// Get existing episodes for this series
	const existingEpisodes = await db
		.select({ id: episodes.id, arrId: episodes.arrId })
		.from(episodes)
		.innerJoin(seasons, eq(episodes.seasonId, seasons.id))
		.where(eq(seasons.seriesId, seriesDbId));

	const existingEpisodeMap = new Map(existingEpisodes.map((e) => [e.arrId, e.id]));
	const apiEpisodeArrIds = new Set(apiEpisodes.map((e) => e.id));

	// Identify episodes to delete (exist in DB but not in API for this series)
	const episodesToDelete = existingEpisodes.filter((e) => !apiEpisodeArrIds.has(e.arrId));

	if (episodesToDelete.length > 0) {
		const episodeIdsToDelete = episodesToDelete.map((e) => e.id);

		// Delete search registry entries first
		result.searchStateDeleted = await deleteSearchRegistryForEpisodes(
			connectorId,
			episodeIdsToDelete
		);

		// Delete the episodes
		await db
			.delete(episodes)
			.where(and(eq(episodes.connectorId, connectorId), inArray(episodes.id, episodeIdsToDelete)));

		result.deleted = episodesToDelete.length;
	}

	// Upsert remaining episodes
	if (apiEpisodes.length > 0) {
		const episodeRecords: ReturnType<typeof mapEpisodeToDb>[] = [];

		for (const apiEpisode of apiEpisodes) {
			const seasonKey = `${seriesDbId}-${apiEpisode.seasonNumber}`;
			const seasonDbId = seasonIdMap.get(seasonKey);
			if (seasonDbId === undefined) continue;

			episodeRecords.push(mapEpisodeToDb(connectorId, seasonDbId, apiEpisode));
		}

		if (episodeRecords.length > 0) {
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

			// Count created vs updated
			for (const apiEpisode of apiEpisodes) {
				if (existingEpisodeMap.has(apiEpisode.id)) {
					result.updated++;
				} else {
					result.created++;
				}
			}
		}
	}

	return result;
}
