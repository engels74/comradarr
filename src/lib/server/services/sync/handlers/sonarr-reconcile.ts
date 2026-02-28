// Unlike incremental sync which only upserts, reconciliation also deletes removed content

import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { episodes, seasons, series } from '$lib/server/db/schema';
import { mapEpisodeToDb } from '../mappers';
import { deleteSearchRegistryForEpisodes } from '../search-state-cleanup';
import type { SyncOptions } from '../types';
import {
	DEFAULT_CONCURRENCY,
	DEFAULT_REQUEST_DELAY_MS,
	parallelLimit,
	type SeriesClient,
	upsertSeasons,
	upsertSeries
} from './shared';

export interface SonarrReconcileResult {
	seriesCreated: number;
	seriesUpdated: number;
	seriesDeleted: number;
	episodesCreated: number;
	episodesUpdated: number;
	episodesDeleted: number;
	searchStateDeleted: number;
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

	const apiSeriesList = await client.getSeries();
	const apiSeriesArrIds = new Set(apiSeriesList.map((s) => s.id));

	const existingSeries = await db
		.select({ id: series.id, arrId: series.arrId })
		.from(series)
		.where(eq(series.connectorId, connectorId));

	const existingSeriesMap = new Map(existingSeries.map((s) => [s.arrId, s.id]));

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

	if (apiSeriesList.length > 0) {
		const seriesIdMap = await upsertSeries(connectorId, apiSeriesList);

		for (const [arrId] of seriesIdMap) {
			if (existingSeriesMap.has(arrId)) {
				result.seriesUpdated++;
			} else {
				result.seriesCreated++;
			}
		}

		const seasonIdMap = await upsertSeasons(apiSeriesList, seriesIdMap);

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

		for (const episodeResult of episodeResults) {
			if (episodeResult.dbId === undefined) continue;

			const episodeReconcileResult = await reconcileEpisodesForSeries(
				connectorId,
				episodeResult.dbId,
				episodeResult.episodes,
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

async function reconcileEpisodesForSeries(
	connectorId: number,
	seriesDbId: number,
	apiEpisodes: Awaited<ReturnType<SeriesClient['getEpisodes']>>,
	seasonIdMap: Map<string, number>
): Promise<{ created: number; updated: number; deleted: number; searchStateDeleted: number }> {
	const result = { created: 0, updated: 0, deleted: 0, searchStateDeleted: 0 };

	const existingEpisodes = await db
		.select({ id: episodes.id, arrId: episodes.arrId })
		.from(episodes)
		.innerJoin(seasons, eq(episodes.seasonId, seasons.id))
		.where(eq(seasons.seriesId, seriesDbId));

	const existingEpisodeMap = new Map(existingEpisodes.map((e) => [e.arrId, e.id]));
	const apiEpisodeArrIds = new Set(apiEpisodes.map((e) => e.id));

	const episodesToDelete = existingEpisodes.filter((e) => !apiEpisodeArrIds.has(e.arrId));

	if (episodesToDelete.length > 0) {
		const episodeIdsToDelete = episodesToDelete.map((e) => e.id);

		result.searchStateDeleted = await deleteSearchRegistryForEpisodes(
			connectorId,
			episodeIdsToDelete
		);

		await db
			.delete(episodes)
			.where(and(eq(episodes.connectorId, connectorId), inArray(episodes.id, episodeIdsToDelete)));

		result.deleted = episodesToDelete.length;
	}

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
