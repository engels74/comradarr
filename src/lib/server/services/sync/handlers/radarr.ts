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
				updatedAt: sql`now()`
			}
		});

	const durationMs = Date.now() - startTime;
	logger.info('Radarr sync completed', { connectorId, movieCount: apiMovies.length, durationMs });

	return apiMovies.length;
}
