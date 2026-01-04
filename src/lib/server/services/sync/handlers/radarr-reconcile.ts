/**
 * Radarr full reconciliation handler
 *
 * Performs full reconciliation for Radarr movie libraries.
 * Unlike incremental sync which only upserts, this also deletes movies
 * that no longer exist in the *arr application.
 *
 * @module services/sync/handlers/radarr-reconcile

 */

import { db } from '$lib/server/db';
import { movies } from '$lib/server/db/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { RadarrClient } from '$lib/server/connectors/radarr/client';
import { mapMovieToDb } from '../mappers';
import { deleteSearchRegistryForMovies } from '../search-state-cleanup';

/**
 * Result of the Radarr reconciliation operation
 */
export interface RadarrReconcileResult {
	moviesCreated: number;
	moviesUpdated: number;
	moviesDeleted: number;
	searchStateDeleted: number;
}

/**
 * Perform full reconciliation for Radarr movie content.
 *
 * This function:
 * 1. Fetches all movies from the API
 * 2. Gets existing movies from the database
 * 3. Identifies and deletes movies that no longer exist (with search state cleanup)
 * 4. Upserts existing/new movies
 *
 * @param client - RadarrClient instance
 * @param connectorId - The database ID of the connector being reconciled
 * @returns Detailed result of the reconciliation operation
 *

 */
export async function reconcileRadarrMovies(
	client: RadarrClient,
	connectorId: number
): Promise<RadarrReconcileResult> {
	const result: RadarrReconcileResult = {
		moviesCreated: 0,
		moviesUpdated: 0,
		moviesDeleted: 0,
		searchStateDeleted: 0
	};

	// Phase 1: Fetch all movies from API
	const apiMovies = await client.getMovies();
	const apiMovieArrIds = new Set(apiMovies.map((m) => m.id));

	// Phase 2: Get existing movies from DB
	const existingMovies = await db
		.select({ id: movies.id, arrId: movies.arrId })
		.from(movies)
		.where(eq(movies.connectorId, connectorId));

	const existingMovieMap = new Map(existingMovies.map((m) => [m.arrId, m.id]));

	// Phase 3: Identify and delete movies that no longer exist in API
	const moviesToDelete = existingMovies.filter((m) => !apiMovieArrIds.has(m.arrId));

	if (moviesToDelete.length > 0) {
		const movieIdsToDelete = moviesToDelete.map((m) => m.id);
		const movieArrIdsToDelete = moviesToDelete.map((m) => m.arrId);

		// Delete search registry entries first
		result.searchStateDeleted = await deleteSearchRegistryForMovies(connectorId, movieIdsToDelete);

		// Delete the movies
		await db
			.delete(movies)
			.where(and(eq(movies.connectorId, connectorId), inArray(movies.arrId, movieArrIdsToDelete)));

		result.moviesDeleted = moviesToDelete.length;
	}

	// Phase 4: Upsert remaining movies
	if (apiMovies.length > 0) {
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

		// Count created vs updated
		for (const apiMovie of apiMovies) {
			if (existingMovieMap.has(apiMovie.id)) {
				result.moviesUpdated++;
			} else {
				result.moviesCreated++;
			}
		}
	}

	return result;
}
