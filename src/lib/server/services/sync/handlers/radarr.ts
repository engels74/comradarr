import { sql } from 'drizzle-orm';
import type { RadarrClient } from '$lib/server/connectors/radarr/client';
import { db } from '$lib/server/db';
import { movies } from '$lib/server/db/schema';
import { mapMovieToDb } from '../mappers';

export async function syncRadarrMovies(client: RadarrClient, connectorId: number): Promise<number> {
	const apiMovies = await client.getMovies();

	if (apiMovies.length === 0) {
		return 0;
	}

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

	return apiMovies.length;
}
