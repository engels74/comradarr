import { sql } from 'drizzle-orm';
import type { SonarrClient } from '$lib/server/connectors/sonarr/client';
import type { SonarrSeries } from '$lib/server/connectors/sonarr/types';
import type { WhisparrClient } from '$lib/server/connectors/whisparr/client';
import { db } from '$lib/server/db';
import { seasons, series } from '$lib/server/db/schema';
import { mapSeasonToDb, mapSeriesToDb } from '../mappers';

export const DEFAULT_CONCURRENCY = 5;
export const DEFAULT_REQUEST_DELAY_MS = 100;

export type SeriesClient = SonarrClient | WhisparrClient;

export async function upsertSeries(
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

export async function upsertSeasons(
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

export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function parallelLimit<T, R>(
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
