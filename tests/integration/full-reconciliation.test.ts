/**
 * Integration tests for full reconciliation logic.
 *
 * Validates requirements:
 * - 2.2: Full reconciliation with deletion of removed items and cascade to search state
 *
 * Property 18: Sync Reconciliation Correctness
 * - All items in API response should exist in content mirror with matching data
 * - All items in content mirror not in API response should be deleted
 * - No orphaned search state entries should exist for deleted content
 *
 * NOTE: These tests require a running PostgreSQL database with DATABASE_URL set.
 * Run with: bun test tests/integration/full-reconciliation.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { db } from '../../src/lib/server/db';
import {
	connectors,
	series,
	seasons,
	episodes,
	movies,
	searchRegistry
} from '../../src/lib/server/db/schema';
import { eq, and, sql, inArray } from 'drizzle-orm';
import {
	deleteSearchRegistryForContent,
	deleteSearchRegistryForEpisodes,
	deleteSearchRegistryForMovies
} from '../../src/lib/server/services/sync/search-state-cleanup';
import { reconcileRadarrMovies } from '../../src/lib/server/services/sync/handlers/radarr-reconcile';
import { reconcileSonarrContent } from '../../src/lib/server/services/sync/handlers/sonarr-reconcile';

// Store original SECRET_KEY to restore after tests
const originalSecretKey = process.env.SECRET_KEY;

// Valid test SECRET_KEY (64 hex chars = 32 bytes = 256 bits)
const TEST_SECRET_KEY = 'a'.repeat(64);

// Test connector IDs
let testSonarrConnectorId: number;
let testRadarrConnectorId: number;

/**
 * Create a test connector in the database
 */
async function createTestConnector(
	type: 'sonarr' | 'radarr' | 'whisparr',
	name: string
): Promise<number> {
	const result = await db
		.insert(connectors)
		.values({
			type,
			name,
			url: `http://test-${type}.local:8989`,
			apiKeyEncrypted: 'testencryptedkey', // Not actually encrypted for tests
			enabled: true
		})
		.returning({ id: connectors.id });

	return result[0]!.id;
}

/**
 * Clean up all test data for a connector
 */
async function cleanupConnectorData(connectorId: number): Promise<void> {
	// Search registry will cascade delete when content is deleted
	// Delete in reverse dependency order
	await db.delete(searchRegistry).where(eq(searchRegistry.connectorId, connectorId));
	await db.delete(episodes).where(eq(episodes.connectorId, connectorId));
	await db.delete(movies).where(eq(movies.connectorId, connectorId));
	await db.delete(series).where(eq(series.connectorId, connectorId));
}

/**
 * Insert test series into database
 */
async function insertTestSeries(
	connectorId: number,
	arrId: number,
	title: string
): Promise<number> {
	const result = await db
		.insert(series)
		.values({
			connectorId,
			arrId,
			title,
			status: 'continuing',
			monitored: true
		})
		.returning({ id: series.id });

	return result[0]!.id;
}

/**
 * Insert test season into database
 */
async function insertTestSeason(seriesId: number, seasonNumber: number): Promise<number> {
	const result = await db
		.insert(seasons)
		.values({
			seriesId,
			seasonNumber,
			monitored: true,
			totalEpisodes: 10,
			downloadedEpisodes: 5
		})
		.returning({ id: seasons.id });

	return result[0]!.id;
}

/**
 * Insert test episode into database
 */
async function insertTestEpisode(
	connectorId: number,
	seasonId: number,
	arrId: number,
	seasonNumber: number,
	episodeNumber: number
): Promise<number> {
	const result = await db
		.insert(episodes)
		.values({
			connectorId,
			seasonId,
			arrId,
			seasonNumber,
			episodeNumber,
			title: `Episode ${episodeNumber}`,
			monitored: true,
			hasFile: false,
			qualityCutoffNotMet: false
		})
		.returning({ id: episodes.id });

	return result[0]!.id;
}

/**
 * Insert test movie into database
 */
async function insertTestMovie(connectorId: number, arrId: number, title: string): Promise<number> {
	const result = await db
		.insert(movies)
		.values({
			connectorId,
			arrId,
			title,
			year: 2024,
			monitored: true,
			hasFile: false,
			qualityCutoffNotMet: false
		})
		.returning({ id: movies.id });

	return result[0]!.id;
}

/**
 * Insert test search registry entry
 */
async function insertTestSearchRegistry(
	connectorId: number,
	contentType: 'episode' | 'movie',
	contentId: number,
	searchType: 'gap' | 'upgrade'
): Promise<number> {
	const result = await db
		.insert(searchRegistry)
		.values({
			connectorId,
			contentType,
			contentId,
			searchType,
			state: 'pending',
			priority: 100
		})
		.returning({ id: searchRegistry.id });

	return result[0]!.id;
}

/**
 * Count search registry entries for a connector
 */
async function countSearchRegistry(connectorId: number): Promise<number> {
	const result = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(searchRegistry)
		.where(eq(searchRegistry.connectorId, connectorId));

	return result[0]?.count ?? 0;
}

/**
 * Count episodes for a connector
 */
async function countEpisodes(connectorId: number): Promise<number> {
	const result = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(episodes)
		.where(eq(episodes.connectorId, connectorId));

	return result[0]?.count ?? 0;
}

/**
 * Count movies for a connector
 */
async function countMovies(connectorId: number): Promise<number> {
	const result = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(movies)
		.where(eq(movies.connectorId, connectorId));

	return result[0]?.count ?? 0;
}

describe('Search State Cleanup (Requirement 2.2)', () => {
	beforeAll(async () => {
		process.env.SECRET_KEY = TEST_SECRET_KEY;
		testSonarrConnectorId = await createTestConnector('sonarr', 'Test Sonarr');
		testRadarrConnectorId = await createTestConnector('radarr', 'Test Radarr');
	});

	afterAll(async () => {
		// Clean up test connectors
		await cleanupConnectorData(testSonarrConnectorId);
		await cleanupConnectorData(testRadarrConnectorId);
		await db.delete(connectors).where(eq(connectors.id, testSonarrConnectorId));
		await db.delete(connectors).where(eq(connectors.id, testRadarrConnectorId));

		if (originalSecretKey !== undefined) {
			process.env.SECRET_KEY = originalSecretKey;
		} else {
			delete process.env.SECRET_KEY;
		}
	});

	beforeEach(async () => {
		// Clean up data before each test
		await cleanupConnectorData(testSonarrConnectorId);
		await cleanupConnectorData(testRadarrConnectorId);
	});

	describe('deleteSearchRegistryForContent', () => {
		it('should delete search registry entries for specified content IDs', async () => {
			// Set up: Create movies and search registry entries
			const movie1Id = await insertTestMovie(testRadarrConnectorId, 1001, 'Movie 1');
			const movie2Id = await insertTestMovie(testRadarrConnectorId, 1002, 'Movie 2');
			const movie3Id = await insertTestMovie(testRadarrConnectorId, 1003, 'Movie 3');

			await insertTestSearchRegistry(testRadarrConnectorId, 'movie', movie1Id, 'gap');
			await insertTestSearchRegistry(testRadarrConnectorId, 'movie', movie2Id, 'gap');
			await insertTestSearchRegistry(testRadarrConnectorId, 'movie', movie3Id, 'upgrade');

			// Verify setup
			expect(await countSearchRegistry(testRadarrConnectorId)).toBe(3);

			// Delete search registry for movie1 and movie2
			const deleted = await deleteSearchRegistryForContent(testRadarrConnectorId, 'movie', [
				movie1Id,
				movie2Id
			]);

			// Verify results
			expect(deleted).toBe(2);
			expect(await countSearchRegistry(testRadarrConnectorId)).toBe(1);
		});

		it('should return 0 when content IDs array is empty', async () => {
			const deleted = await deleteSearchRegistryForContent(testRadarrConnectorId, 'movie', []);
			expect(deleted).toBe(0);
		});

		it('should not delete entries for other connectors', async () => {
			// Set up: Create movies in both connectors
			const sonarrSeriesId = await insertTestSeries(testSonarrConnectorId, 2001, 'Series 1');
			const sonarrSeasonId = await insertTestSeason(sonarrSeriesId, 1);
			const episodeId = await insertTestEpisode(testSonarrConnectorId, sonarrSeasonId, 3001, 1, 1);
			const movieId = await insertTestMovie(testRadarrConnectorId, 1001, 'Movie 1');

			await insertTestSearchRegistry(testSonarrConnectorId, 'episode', episodeId, 'gap');
			await insertTestSearchRegistry(testRadarrConnectorId, 'movie', movieId, 'gap');

			// Delete for Radarr connector only
			const deleted = await deleteSearchRegistryForMovies(testRadarrConnectorId, [movieId]);

			// Verify Sonarr entry still exists
			expect(deleted).toBe(1);
			expect(await countSearchRegistry(testSonarrConnectorId)).toBe(1);
			expect(await countSearchRegistry(testRadarrConnectorId)).toBe(0);
		});
	});

	describe('deleteSearchRegistryForEpisodes', () => {
		it('should delete search registry entries for episodes', async () => {
			// Set up: Create series, season, episodes, and search registry entries
			const seriesId = await insertTestSeries(testSonarrConnectorId, 2001, 'Test Series');
			const seasonId = await insertTestSeason(seriesId, 1);

			const ep1Id = await insertTestEpisode(testSonarrConnectorId, seasonId, 3001, 1, 1);
			const ep2Id = await insertTestEpisode(testSonarrConnectorId, seasonId, 3002, 1, 2);
			const ep3Id = await insertTestEpisode(testSonarrConnectorId, seasonId, 3003, 1, 3);

			await insertTestSearchRegistry(testSonarrConnectorId, 'episode', ep1Id, 'gap');
			await insertTestSearchRegistry(testSonarrConnectorId, 'episode', ep2Id, 'gap');
			await insertTestSearchRegistry(testSonarrConnectorId, 'episode', ep3Id, 'upgrade');

			// Delete search registry for ep1 and ep2
			const deleted = await deleteSearchRegistryForEpisodes(testSonarrConnectorId, [ep1Id, ep2Id]);

			expect(deleted).toBe(2);
			expect(await countSearchRegistry(testSonarrConnectorId)).toBe(1);
		});
	});

	describe('deleteSearchRegistryForMovies', () => {
		it('should delete search registry entries for movies', async () => {
			const movie1Id = await insertTestMovie(testRadarrConnectorId, 1001, 'Movie 1');
			const movie2Id = await insertTestMovie(testRadarrConnectorId, 1002, 'Movie 2');

			await insertTestSearchRegistry(testRadarrConnectorId, 'movie', movie1Id, 'gap');
			await insertTestSearchRegistry(testRadarrConnectorId, 'movie', movie2Id, 'upgrade');

			const deleted = await deleteSearchRegistryForMovies(testRadarrConnectorId, [movie1Id]);

			expect(deleted).toBe(1);
			expect(await countSearchRegistry(testRadarrConnectorId)).toBe(1);
		});
	});
});

describe('Property 18: Sync Reconciliation Correctness', () => {
	beforeAll(async () => {
		process.env.SECRET_KEY = TEST_SECRET_KEY;
		testSonarrConnectorId = await createTestConnector('sonarr', 'Test Sonarr Reconcile');
		testRadarrConnectorId = await createTestConnector('radarr', 'Test Radarr Reconcile');
	});

	afterAll(async () => {
		await cleanupConnectorData(testSonarrConnectorId);
		await cleanupConnectorData(testRadarrConnectorId);
		await db.delete(connectors).where(eq(connectors.id, testSonarrConnectorId));
		await db.delete(connectors).where(eq(connectors.id, testRadarrConnectorId));

		if (originalSecretKey !== undefined) {
			process.env.SECRET_KEY = originalSecretKey;
		} else {
			delete process.env.SECRET_KEY;
		}
	});

	beforeEach(async () => {
		await cleanupConnectorData(testSonarrConnectorId);
		await cleanupConnectorData(testRadarrConnectorId);
	});

	describe('Cascade Delete: Content removal cleans up search state', () => {
		it('should delete search registry entries when movies are deleted', async () => {
			// Set up: Create movies and search registry entries
			const movie1Id = await insertTestMovie(testRadarrConnectorId, 1001, 'Movie to Delete');
			const movie2Id = await insertTestMovie(testRadarrConnectorId, 1002, 'Movie to Keep');

			await insertTestSearchRegistry(testRadarrConnectorId, 'movie', movie1Id, 'gap');
			await insertTestSearchRegistry(testRadarrConnectorId, 'movie', movie2Id, 'gap');

			// Verify setup
			expect(await countMovies(testRadarrConnectorId)).toBe(2);
			expect(await countSearchRegistry(testRadarrConnectorId)).toBe(2);

			// Simulate reconciliation: delete movie1 and its search state
			await deleteSearchRegistryForMovies(testRadarrConnectorId, [movie1Id]);
			await db
				.delete(movies)
				.where(and(eq(movies.connectorId, testRadarrConnectorId), eq(movies.id, movie1Id)));

			// Verify: movie1 deleted, movie2 and its search state remain
			expect(await countMovies(testRadarrConnectorId)).toBe(1);
			expect(await countSearchRegistry(testRadarrConnectorId)).toBe(1);

			// Verify the remaining search registry entry is for movie2
			const remainingRegistry = await db
				.select()
				.from(searchRegistry)
				.where(eq(searchRegistry.connectorId, testRadarrConnectorId));

			expect(remainingRegistry[0]?.contentId).toBe(movie2Id);
		});

		it('should delete search registry entries when episodes are deleted', async () => {
			// Set up: Create series, season, episodes, and search registry entries
			const seriesId = await insertTestSeries(testSonarrConnectorId, 2001, 'Test Series');
			const seasonId = await insertTestSeason(seriesId, 1);

			const ep1Id = await insertTestEpisode(testSonarrConnectorId, seasonId, 3001, 1, 1);
			const ep2Id = await insertTestEpisode(testSonarrConnectorId, seasonId, 3002, 1, 2);

			await insertTestSearchRegistry(testSonarrConnectorId, 'episode', ep1Id, 'gap');
			await insertTestSearchRegistry(testSonarrConnectorId, 'episode', ep2Id, 'upgrade');

			// Verify setup
			expect(await countEpisodes(testSonarrConnectorId)).toBe(2);
			expect(await countSearchRegistry(testSonarrConnectorId)).toBe(2);

			// Simulate reconciliation: delete ep1 and its search state
			await deleteSearchRegistryForEpisodes(testSonarrConnectorId, [ep1Id]);
			await db
				.delete(episodes)
				.where(and(eq(episodes.connectorId, testSonarrConnectorId), eq(episodes.id, ep1Id)));

			// Verify
			expect(await countEpisodes(testSonarrConnectorId)).toBe(1);
			expect(await countSearchRegistry(testSonarrConnectorId)).toBe(1);
		});

		it('should handle deletion of content with no search registry entries', async () => {
			// Set up: Create movie without search registry entry
			const movieId = await insertTestMovie(testRadarrConnectorId, 1001, 'Movie No Registry');

			// Verify setup
			expect(await countMovies(testRadarrConnectorId)).toBe(1);
			expect(await countSearchRegistry(testRadarrConnectorId)).toBe(0);

			// Delete should succeed even with no search registry entries
			const deleted = await deleteSearchRegistryForMovies(testRadarrConnectorId, [movieId]);

			expect(deleted).toBe(0);

			// Can still delete the movie
			await db
				.delete(movies)
				.where(and(eq(movies.connectorId, testRadarrConnectorId), eq(movies.id, movieId)));

			expect(await countMovies(testRadarrConnectorId)).toBe(0);
		});
	});

	describe('No Orphaned Search State', () => {
		it('should not leave orphaned search registry entries after bulk deletion', async () => {
			// Set up: Create multiple movies with search registry entries
			const movieIds: number[] = [];
			for (let i = 1; i <= 5; i++) {
				const id = await insertTestMovie(testRadarrConnectorId, 1000 + i, `Movie ${i}`);
				movieIds.push(id);
				await insertTestSearchRegistry(testRadarrConnectorId, 'movie', id, 'gap');
			}

			// Verify setup
			expect(await countMovies(testRadarrConnectorId)).toBe(5);
			expect(await countSearchRegistry(testRadarrConnectorId)).toBe(5);

			// Delete movies 1, 3, 5 (odd indices)
			const idsToDelete = [movieIds[0]!, movieIds[2]!, movieIds[4]!];

			// Clean up search state first
			const registryDeleted = await deleteSearchRegistryForMovies(
				testRadarrConnectorId,
				idsToDelete
			);
			expect(registryDeleted).toBe(3);

			// Then delete movies
			await db
				.delete(movies)
				.where(
					and(
						eq(movies.connectorId, testRadarrConnectorId),
						sql`${movies.id} = ANY(ARRAY[${idsToDelete[0]}, ${idsToDelete[1]}, ${idsToDelete[2]}]::int[])`
					)
				);

			// Verify: 2 movies remain, 2 search registry entries remain
			expect(await countMovies(testRadarrConnectorId)).toBe(2);
			expect(await countSearchRegistry(testRadarrConnectorId)).toBe(2);

			// Verify no orphaned entries (all remaining entries have valid content)
			const remainingRegistry = await db
				.select({ contentId: searchRegistry.contentId })
				.from(searchRegistry)
				.where(eq(searchRegistry.connectorId, testRadarrConnectorId));

			const remainingMovieIds = [movieIds[1]!, movieIds[3]!];
			for (const entry of remainingRegistry) {
				expect(remainingMovieIds).toContain(entry.contentId);
			}
		});
	});
});

// ============================================================================
// Property-Based Tests for Sync Reconciliation
// ============================================================================

/**
 * Movie data structure for property testing
 */
interface MovieData {
	arrId: number;
	title: string;
	year: number;
	hasFile: boolean;
	qualityCutoffNotMet: boolean;
}

/**
 * Arbitrary for generating movie data with unique arrIds in property-safe range
 */
const movieDataArbitrary: fc.Arbitrary<MovieData> = fc.record({
	arrId: fc.integer({ min: 10000, max: 99999 }),
	title: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
	year: fc.integer({ min: 1900, max: 2030 }),
	hasFile: fc.boolean(),
	qualityCutoffNotMet: fc.boolean()
});

/**
 * Deduplicate movies by arrId, keeping first occurrence
 */
function deduplicateByArrId(items: MovieData[]): MovieData[] {
	const seen = new Set<number>();
	return items.filter((item) => {
		if (seen.has(item.arrId)) {
			return false;
		}
		seen.add(item.arrId);
		return true;
	});
}

/**
 * Insert movies from property test data
 */
async function insertMoviesFromData(
	connectorId: number,
	moviesData: MovieData[]
): Promise<Map<number, number>> {
	const arrIdToDbId = new Map<number, number>();

	for (const movieData of moviesData) {
		const result = await db
			.insert(movies)
			.values({
				connectorId,
				arrId: movieData.arrId,
				title: movieData.title,
				year: movieData.year,
				monitored: true,
				hasFile: movieData.hasFile,
				qualityCutoffNotMet: movieData.qualityCutoffNotMet
			})
			.returning({ id: movies.id });

		arrIdToDbId.set(movieData.arrId, result[0]!.id);
	}

	return arrIdToDbId;
}

/**
 * Get all movies for a connector, mapped by arrId
 */
async function getMoviesByConnector(
	connectorId: number
): Promise<Map<number, { id: number; arrId: number; title: string; hasFile: boolean }>> {
	const result = await db
		.select({
			id: movies.id,
			arrId: movies.arrId,
			title: movies.title,
			hasFile: movies.hasFile
		})
		.from(movies)
		.where(eq(movies.connectorId, connectorId));

	const map = new Map<number, { id: number; arrId: number; title: string; hasFile: boolean }>();
	for (const row of result) {
		map.set(row.arrId, row);
	}
	return map;
}

/**
 * Simulate reconciliation upsert: insert new items, update existing ones
 */
async function simulateReconciliationUpsert(
	connectorId: number,
	apiItems: MovieData[]
): Promise<void> {
	for (const item of apiItems) {
		await db
			.insert(movies)
			.values({
				connectorId,
				arrId: item.arrId,
				title: item.title,
				year: item.year,
				monitored: true,
				hasFile: item.hasFile,
				qualityCutoffNotMet: item.qualityCutoffNotMet
			})
			.onConflictDoUpdate({
				target: [movies.connectorId, movies.arrId],
				set: {
					title: sql`excluded.title`,
					year: sql`excluded.year`,
					hasFile: sql`excluded.has_file`,
					qualityCutoffNotMet: sql`excluded.quality_cutoff_not_met`,
					updatedAt: sql`now()`
				}
			});
	}
}

/**
 * Simulate reconciliation delete: remove items not in API response
 */
async function simulateReconciliationDelete(
	connectorId: number,
	apiArrIds: Set<number>
): Promise<number[]> {
	// Get existing movies
	const existing = await db
		.select({ id: movies.id, arrId: movies.arrId })
		.from(movies)
		.where(eq(movies.connectorId, connectorId));

	// Find IDs to delete (in DB but not in API)
	const toDeleteDbIds: number[] = [];
	for (const movie of existing) {
		if (!apiArrIds.has(movie.arrId)) {
			toDeleteDbIds.push(movie.id);
		}
	}

	// Delete search state for movies being deleted
	if (toDeleteDbIds.length > 0) {
		await deleteSearchRegistryForMovies(connectorId, toDeleteDbIds);

		// Delete the movies using inArray for proper array handling
		await db
			.delete(movies)
			.where(and(eq(movies.connectorId, connectorId), inArray(movies.id, toDeleteDbIds)));
	}

	return toDeleteDbIds;
}

// Property test connector (separate from example tests)
let propertyTestConnectorId: number;

describe('Property 18: Sync Reconciliation - Property-Based Tests (Requirement 2.2)', () => {
	beforeAll(async () => {
		process.env.SECRET_KEY = TEST_SECRET_KEY;
		propertyTestConnectorId = await createTestConnector('radarr', 'Property Test Radarr');
	});

	afterAll(async () => {
		await cleanupConnectorData(propertyTestConnectorId);
		await db.delete(connectors).where(eq(connectors.id, propertyTestConnectorId));

		if (originalSecretKey !== undefined) {
			process.env.SECRET_KEY = originalSecretKey;
		} else {
			delete process.env.SECRET_KEY;
		}
	});

	beforeEach(async () => {
		await cleanupConnectorData(propertyTestConnectorId);
	});

	describe('Property 18.1: All API items exist in content mirror after reconciliation', () => {
		it('should insert/update all items from API response with matching data', async () => {
			await fc.assert(
				fc.asyncProperty(
					fc.array(movieDataArbitrary, { minLength: 1, maxLength: 10 }).map(deduplicateByArrId),
					async (apiItems) => {
						// Clean up before each iteration
						await cleanupConnectorData(propertyTestConnectorId);

						// Execute: Simulate reconciliation upsert
						await simulateReconciliationUpsert(propertyTestConnectorId, apiItems);

						// Assert: All API items exist in content mirror
						const dbMovies = await getMoviesByConnector(propertyTestConnectorId);

						// Count should match
						expect(dbMovies.size).toBe(apiItems.length);

						// Each API item should exist with matching data
						for (const apiItem of apiItems) {
							const dbMovie = dbMovies.get(apiItem.arrId);
							expect(dbMovie).toBeDefined();
							expect(dbMovie!.title).toBe(apiItem.title);
							expect(dbMovie!.hasFile).toBe(apiItem.hasFile);
						}
					}
				),
				{ numRuns: 100 }
			);
		});

		it('should update existing items when API provides new data', async () => {
			await fc.assert(
				fc.asyncProperty(
					fc.array(movieDataArbitrary, { minLength: 1, maxLength: 5 }).map(deduplicateByArrId),
					fc.array(movieDataArbitrary, { minLength: 1, maxLength: 5 }).map(deduplicateByArrId),
					async (existingItems, apiUpdates) => {
						await cleanupConnectorData(propertyTestConnectorId);

						// Setup: Insert existing items
						await insertMoviesFromData(propertyTestConnectorId, existingItems);

						// Create API items with some overlapping arrIds (updates) and some new
						const apiItems: MovieData[] = [];
						const existingArrIds = new Set(existingItems.map((i) => i.arrId));

						// Add updates for some existing items
						for (const update of apiUpdates) {
							// Reuse some existing arrIds for updates
							if (existingItems.length > 0 && apiItems.length < existingItems.length) {
								const existingItem = existingItems[apiItems.length % existingItems.length]!;
								apiItems.push({
									...update,
									arrId: existingItem.arrId // Use existing arrId to force update
								});
							} else {
								// Use update's arrId if not already used
								if (!existingArrIds.has(update.arrId)) {
									apiItems.push(update);
								}
							}
						}

						if (apiItems.length === 0) return; // Skip if no valid items

						// Execute: Simulate reconciliation upsert
						await simulateReconciliationUpsert(propertyTestConnectorId, apiItems);

						// Assert: All API items exist with their new data
						const dbMovies = await getMoviesByConnector(propertyTestConnectorId);

						for (const apiItem of apiItems) {
							const dbMovie = dbMovies.get(apiItem.arrId);
							expect(dbMovie).toBeDefined();
							expect(dbMovie!.title).toBe(apiItem.title);
							expect(dbMovie!.hasFile).toBe(apiItem.hasFile);
						}
					}
				),
				{ numRuns: 100 }
			);
		});
	});

	describe('Property 18.2: Non-API items are deleted from content mirror', () => {
		it('items in mirror but not in API response should be deleted', async () => {
			await fc.assert(
				fc.asyncProperty(
					fc.array(movieDataArbitrary, { minLength: 2, maxLength: 10 }).map(deduplicateByArrId),
					fc.integer({ min: 0, max: 100 }), // percentage to keep
					async (existingItems, keepPercentage) => {
						await cleanupConnectorData(propertyTestConnectorId);

						if (existingItems.length === 0) return;

						// Setup: Insert existing items
						await insertMoviesFromData(propertyTestConnectorId, existingItems);

						// Determine which items to "keep" in API response
						const keepCount = Math.max(
							0,
							Math.floor((existingItems.length * keepPercentage) / 100)
						);
						const apiItems = existingItems.slice(0, keepCount);
						const apiArrIds = new Set(apiItems.map((i) => i.arrId));

						// Execute: Simulate reconciliation delete
						await simulateReconciliationDelete(propertyTestConnectorId, apiArrIds);

						// Assert: Only API items remain
						const dbMovies = await getMoviesByConnector(propertyTestConnectorId);
						expect(dbMovies.size).toBe(apiItems.length);

						// All remaining movies should be in API response
						for (const [arrId] of dbMovies) {
							expect(apiArrIds.has(arrId)).toBe(true);
						}
					}
				),
				{ numRuns: 100 }
			);
		});
	});

	describe('Property 18.3: No orphaned search state entries after reconciliation', () => {
		it('search registry entries should be deleted when content is deleted', async () => {
			await fc.assert(
				fc.asyncProperty(
					fc.array(movieDataArbitrary, { minLength: 2, maxLength: 10 }).map(deduplicateByArrId),
					fc.integer({ min: 20, max: 80 }), // percentage to keep (ensure some deletions)
					async (existingItems, keepPercentage) => {
						await cleanupConnectorData(propertyTestConnectorId);

						if (existingItems.length < 2) return;

						// Setup: Insert existing items with search registry entries
						const arrIdToDbId = await insertMoviesFromData(propertyTestConnectorId, existingItems);

						// Create search registry entries for all movies
						for (const [, dbId] of arrIdToDbId) {
							await insertTestSearchRegistry(propertyTestConnectorId, 'movie', dbId, 'gap');
						}

						// Determine which items to "keep" in API response
						const keepCount = Math.max(
							1,
							Math.floor((existingItems.length * keepPercentage) / 100)
						);
						const apiItems = existingItems.slice(0, keepCount);
						const apiArrIds = new Set(apiItems.map((i) => i.arrId));

						// Execute: Simulate reconciliation delete
						await simulateReconciliationDelete(propertyTestConnectorId, apiArrIds);

						// Assert: Search registry count matches remaining movies
						const remainingMovieCount = await countMovies(propertyTestConnectorId);
						const remainingRegistryCount = await countSearchRegistry(propertyTestConnectorId);

						expect(remainingMovieCount).toBe(apiItems.length);
						expect(remainingRegistryCount).toBe(apiItems.length);

						// Verify no orphaned entries: all registry entries reference existing movies
						const registryEntries = await db
							.select({ contentId: searchRegistry.contentId })
							.from(searchRegistry)
							.where(eq(searchRegistry.connectorId, propertyTestConnectorId));

						const remainingDbIds = await db
							.select({ id: movies.id })
							.from(movies)
							.where(eq(movies.connectorId, propertyTestConnectorId));

						const validDbIds = new Set(remainingDbIds.map((r) => r.id));

						for (const entry of registryEntries) {
							expect(validDbIds.has(entry.contentId)).toBe(true);
						}
					}
				),
				{ numRuns: 100 }
			);
		});

		it('should handle complete deletion (all items removed)', async () => {
			await fc.assert(
				fc.asyncProperty(
					fc.array(movieDataArbitrary, { minLength: 1, maxLength: 5 }).map(deduplicateByArrId),
					async (existingItems) => {
						await cleanupConnectorData(propertyTestConnectorId);

						// Setup: Insert existing items with search registry
						const arrIdToDbId = await insertMoviesFromData(propertyTestConnectorId, existingItems);

						for (const [, dbId] of arrIdToDbId) {
							await insertTestSearchRegistry(propertyTestConnectorId, 'movie', dbId, 'gap');
						}

						// Execute: Simulate reconciliation with empty API response
						await simulateReconciliationDelete(propertyTestConnectorId, new Set());

						// Assert: No movies or search registry entries remain
						expect(await countMovies(propertyTestConnectorId)).toBe(0);
						expect(await countSearchRegistry(propertyTestConnectorId)).toBe(0);
					}
				),
				{ numRuns: 100 }
			);
		});
	});
});
