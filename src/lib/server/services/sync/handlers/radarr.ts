import { and, eq, inArray, sql } from 'drizzle-orm';
import type { RadarrClient } from '$lib/server/connectors/radarr/client';
import { db } from '$lib/server/db';
import {
	getOldestPendingCommandForContent,
	markCommandFileAcquired
} from '$lib/server/db/queries/pending-commands';
import { movies } from '$lib/server/db/schema';
import { createLogger } from '$lib/server/logger';
import { analyticsCollector } from '$lib/server/services/analytics';
import { mapMovieToDb } from '../mappers';

const logger = createLogger('sync-radarr');

export async function syncRadarrMovies(client: RadarrClient, connectorId: number): Promise<number> {
	const startTime = Date.now();
	const apiMovies = await client.getMovies();

	if (apiMovies.length === 0) {
		return 0;
	}

	logger.info('Syncing movies from Radarr', { connectorId, movieCount: apiMovies.length });

	const movieRecords = apiMovies.map((movie) => mapMovieToDb(connectorId, movie));

	// Query movies that currently don't have files (before upsert)
	const arrIds = movieRecords.map((r) => r.arrId);
	const moviesWithoutFiles = await db
		.select({ id: movies.id, arrId: movies.arrId })
		.from(movies)
		.where(
			and(
				eq(movies.connectorId, connectorId),
				inArray(movies.arrId, arrIds),
				eq(movies.hasFile, false)
			)
		);
	const arrIdsWithoutFiles = new Set(moviesWithoutFiles.map((m) => m.arrId));

	const result = await db
		.insert(movies)
		.values(movieRecords)
		.onConflictDoUpdate({
			target: [movies.connectorId, movies.arrId],
			set: {
				tmdbId: sql`excluded.tmdb_id`,
				imdbId: sql`excluded.imdb_id`,
				title: sql`excluded.title`,
				year: sql`excluded.year`,
				monitored: sql`excluded.monitored`,
				hasFile: sql`excluded.has_file`,
				quality: sql`excluded.quality`,
				qualityCutoffNotMet: sql`excluded.quality_cutoff_not_met`,
				movieFileId: sql`excluded.movie_file_id`,
				// File tracking: set firstDownloadedAt when file first appears
				firstDownloadedAt: sql`CASE
					WHEN ${movies.hasFile} = false AND excluded.has_file = true
						THEN COALESCE(${movies.firstDownloadedAt}, now())
					ELSE ${movies.firstDownloadedAt}
				END`,
				// File tracking: set fileLostAt and increment count when file disappears
				fileLostAt: sql`CASE
					WHEN ${movies.hasFile} = true AND excluded.has_file = false
						THEN now()
					WHEN excluded.has_file = true
						THEN NULL
					ELSE ${movies.fileLostAt}
				END`,
				fileLossCount: sql`CASE
					WHEN ${movies.hasFile} = true AND excluded.has_file = false
						THEN ${movies.fileLossCount} + 1
					ELSE ${movies.fileLossCount}
				END`,
				updatedAt: sql`now()`
			}
		})
		.returning({
			id: movies.id,
			arrId: movies.arrId,
			hasFile: movies.hasFile
		});

	// Detect file acquisitions: movies that didn't have files before but now do
	const acquiredMovieIds = result
		.filter((r) => r.hasFile && arrIdsWithoutFiles.has(r.arrId))
		.map((r) => r.id);

	if (acquiredMovieIds.length > 0) {
		await recordFileAcquisitions(connectorId, acquiredMovieIds);
	}

	const durationMs = Date.now() - startTime;
	logger.info('Radarr sync completed', {
		connectorId,
		movieCount: apiMovies.length,
		filesAcquired: acquiredMovieIds.length,
		durationMs
	});

	return apiMovies.length;
}

async function recordFileAcquisitions(
	connectorId: number,
	acquiredMovieIds: number[]
): Promise<void> {
	for (const movieId of acquiredMovieIds) {
		try {
			const pendingCommand = await getOldestPendingCommandForContent('movie', movieId);

			if (pendingCommand) {
				const timeSinceDispatchMs = Date.now() - pendingCommand.dispatchedAt.getTime();

				await markCommandFileAcquired(pendingCommand.id);

				await analyticsCollector.recordSearchSuccessful(
					connectorId,
					pendingCommand.searchRegistryId,
					'movie',
					pendingCommand.searchType as 'gap' | 'upgrade',
					pendingCommand.commandId,
					timeSinceDispatchMs
				);

				logger.debug('File acquisition recorded for movie', {
					movieId,
					connectorId,
					commandId: pendingCommand.commandId,
					timeSinceDispatchMs
				});
			}
		} catch (error) {
			logger.warn('Failed to record file acquisition', {
				movieId,
				connectorId,
				error: error instanceof Error ? error.message : String(error)
			});
		}
	}
}
