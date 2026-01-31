import { sql } from 'drizzle-orm';
import type { RadarrClient } from '$lib/server/connectors/radarr/client';
import { db } from '$lib/server/db';
import { movies } from '$lib/server/db/schema';
import { createLogger } from '$lib/server/logger';
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

	await db
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
		});

	const durationMs = Date.now() - startTime;
	logger.info('Radarr sync completed', { connectorId, movieCount: apiMovies.length, durationMs });

	return apiMovies.length;
}
