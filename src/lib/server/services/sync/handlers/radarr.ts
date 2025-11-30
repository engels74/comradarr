/**
 * Radarr sync handler
 *
 * Handles incremental sync for Radarr movie libraries.
 * Fetches all movies from the Radarr API and upserts them into the content mirror.
 *
 * @module services/sync/handlers/radarr
 * @requirements 2.1, 2.4
 */

import { db } from '$lib/server/db';
import { movies } from '$lib/server/db/schema';
import { sql } from 'drizzle-orm';
import type { RadarrClient } from '$lib/server/connectors/radarr/client';
import { mapMovieToDb } from '../mappers';

/**
 * Sync all movies from a Radarr instance.
 *
 * 1. Fetches all movies from the Radarr API (single API call)
 * 2. Maps each movie to the database format
 * 3. Upserts all movies using ON CONFLICT DO UPDATE
 *
 * @param client - RadarrClient instance configured with baseUrl and apiKey
 * @param connectorId - The database ID of the connector being synced
 * @returns The number of movies processed
 *
 * @requirements 2.4 - Store movies with tmdbId, imdbId, year, hasFile, movieFileId, qualityCutoffNotMet
 */
export async function syncRadarrMovies(client: RadarrClient, connectorId: number): Promise<number> {
	// Fetch all movies from Radarr (single API call)
	const apiMovies = await client.getMovies();

	if (apiMovies.length === 0) {
		return 0;
	}

	// Map all movies to database format
	const movieRecords = apiMovies.map((movie) => mapMovieToDb(connectorId, movie));

	// Upsert all movies using ON CONFLICT DO UPDATE
	// Uses the unique index on (connectorId, arrId)
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
