/**
 * Integration tests for gap discovery service.
 *
 * Validates requirements:
 * - 3.1: Identify all monitored items where hasFile equals false
 * - 3.3: Create search registry entry with state "pending" and search type "gap"
 * - 3.4: Delete search registry entry when hasFile becomes true
 *
 * Property 2: Gap Discovery Correctness
 * - For any content mirror state, gap discovery should return exactly the set
 *   of items where monitored=true AND hasFile=false
 * - No monitored missing items should be excluded (no false negatives)
 * - No unmonitored or present items should be included (no false positives)
 *
 * NOTE: These tests require a running PostgreSQL database with DATABASE_URL set.
 * Run with: bun test tests/integration/gap-discovery.test.ts
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { and, eq, sql } from 'drizzle-orm';
import * as fc from 'fast-check';
import { db } from '../../src/lib/server/db';
import {
	connectors,
	episodes,
	movies,
	searchRegistry,
	seasons,
	series
} from '../../src/lib/server/db/schema';
import { discoverGaps, getGapStats } from '../../src/lib/server/services/discovery';

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
			apiKeyEncrypted: 'testencryptedkey',
			enabled: true
		})
		.returning({ id: connectors.id });

	return result[0]!.id;
}

/**
 * Clean up all test data for a connector
 */
async function cleanupConnectorData(connectorId: number): Promise<void> {
	await db.delete(searchRegistry).where(eq(searchRegistry.connectorId, connectorId));
	await db.delete(episodes).where(eq(episodes.connectorId, connectorId));
	await db.delete(movies).where(eq(movies.connectorId, connectorId));
	// Delete seasons that belong to series of this connector
	const seriesForConnector = await db
		.select({ id: series.id })
		.from(series)
		.where(eq(series.connectorId, connectorId));
	for (const s of seriesForConnector) {
		await db.delete(seasons).where(eq(seasons.seriesId, s.id));
	}
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
	episodeNumber: number,
	monitored: boolean = true,
	hasFile: boolean = false
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
			monitored,
			hasFile,
			qualityCutoffNotMet: false
		})
		.returning({ id: episodes.id });

	return result[0]!.id;
}

/**
 * Insert test movie into database
 */
async function insertTestMovie(
	connectorId: number,
	arrId: number,
	title: string,
	monitored: boolean = true,
	hasFile: boolean = false
): Promise<number> {
	const result = await db
		.insert(movies)
		.values({
			connectorId,
			arrId,
			title,
			year: 2024,
			monitored,
			hasFile,
			qualityCutoffNotMet: false
		})
		.returning({ id: movies.id });

	return result[0]!.id;
}

/**
 * Count search registry entries for a connector
 */
async function countSearchRegistry(
	connectorId: number,
	searchType?: 'gap' | 'upgrade'
): Promise<number> {
	const conditions = [eq(searchRegistry.connectorId, connectorId)];
	if (searchType) {
		conditions.push(eq(searchRegistry.searchType, searchType));
	}

	const result = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(searchRegistry)
		.where(and(...conditions));

	return result[0]?.count ?? 0;
}

/**
 * Get all search registry entries for a connector
 */
async function getSearchRegistries(connectorId: number) {
	return db.select().from(searchRegistry).where(eq(searchRegistry.connectorId, connectorId));
}

// ============================================================================
// Test Setup and Teardown
// ============================================================================

beforeAll(async () => {
	// Set test SECRET_KEY
	process.env.SECRET_KEY = TEST_SECRET_KEY;

	// Create test connectors
	testSonarrConnectorId = await createTestConnector('sonarr', 'Test Sonarr Gap Discovery');
	testRadarrConnectorId = await createTestConnector('radarr', 'Test Radarr Gap Discovery');
});

afterAll(async () => {
	// Clean up test data
	await cleanupConnectorData(testSonarrConnectorId);
	await cleanupConnectorData(testRadarrConnectorId);

	// Delete test connectors
	await db.delete(connectors).where(eq(connectors.id, testSonarrConnectorId));
	await db.delete(connectors).where(eq(connectors.id, testRadarrConnectorId));

	// Restore original SECRET_KEY
	if (originalSecretKey !== undefined) {
		process.env.SECRET_KEY = originalSecretKey;
	} else {
		delete process.env.SECRET_KEY;
	}
});

beforeEach(async () => {
	// Clean up data before each test for isolation
	await cleanupConnectorData(testSonarrConnectorId);
	await cleanupConnectorData(testRadarrConnectorId);
});

// ============================================================================
// Unit Tests
// ============================================================================

describe('Gap Discovery Service', () => {
	describe('discoverGaps - Basic Functionality', () => {
		it('should return empty result when no content exists', async () => {
			const result = await discoverGaps(testSonarrConnectorId);

			expect(result.success).toBe(true);
			expect(result.gapsFound).toBe(0);
			expect(result.registriesCreated).toBe(0);
			expect(result.registriesSkipped).toBe(0);
		});

		it('should detect episode gaps (monitored=true, hasFile=false)', async () => {
			// Create test series and season
			const seriesId = await insertTestSeries(testSonarrConnectorId, 1, 'Test Series');
			const seasonId = await insertTestSeason(seriesId, 1);

			// Create episodes - 3 gaps (monitored, no file)
			await insertTestEpisode(testSonarrConnectorId, seasonId, 101, 1, 1, true, false); // Gap
			await insertTestEpisode(testSonarrConnectorId, seasonId, 102, 1, 2, true, false); // Gap
			await insertTestEpisode(testSonarrConnectorId, seasonId, 103, 1, 3, true, false); // Gap

			const result = await discoverGaps(testSonarrConnectorId);

			expect(result.success).toBe(true);
			expect(result.connectorType).toBe('sonarr');
			expect(result.gapsFound).toBe(3);
			expect(result.registriesCreated).toBe(3);
			expect(result.registriesSkipped).toBe(0);
		});

		it('should detect movie gaps (monitored=true, hasFile=false)', async () => {
			// Create movies - 2 gaps
			await insertTestMovie(testRadarrConnectorId, 201, 'Missing Movie 1', true, false); // Gap
			await insertTestMovie(testRadarrConnectorId, 202, 'Missing Movie 2', true, false); // Gap

			const result = await discoverGaps(testRadarrConnectorId);

			expect(result.success).toBe(true);
			expect(result.connectorType).toBe('radarr');
			expect(result.gapsFound).toBe(2);
			expect(result.registriesCreated).toBe(2);
			expect(result.registriesSkipped).toBe(0);
		});

		it('should NOT detect items with hasFile=true', async () => {
			const seriesId = await insertTestSeries(testSonarrConnectorId, 1, 'Test Series');
			const seasonId = await insertTestSeason(seriesId, 1);

			// Create episodes with files (not gaps)
			await insertTestEpisode(testSonarrConnectorId, seasonId, 101, 1, 1, true, true);
			await insertTestEpisode(testSonarrConnectorId, seasonId, 102, 1, 2, true, true);

			const result = await discoverGaps(testSonarrConnectorId);

			expect(result.success).toBe(true);
			expect(result.gapsFound).toBe(0);
			expect(result.registriesCreated).toBe(0);
		});

		it('should NOT detect items with monitored=false', async () => {
			const seriesId = await insertTestSeries(testSonarrConnectorId, 1, 'Test Series');
			const seasonId = await insertTestSeason(seriesId, 1);

			// Create unmonitored episodes without files (not gaps because not monitored)
			await insertTestEpisode(testSonarrConnectorId, seasonId, 101, 1, 1, false, false);
			await insertTestEpisode(testSonarrConnectorId, seasonId, 102, 1, 2, false, false);

			const result = await discoverGaps(testSonarrConnectorId);

			expect(result.success).toBe(true);
			expect(result.gapsFound).toBe(0);
			expect(result.registriesCreated).toBe(0);
		});

		it('should create registry entries with correct state and type', async () => {
			const seriesId = await insertTestSeries(testSonarrConnectorId, 1, 'Test Series');
			const seasonId = await insertTestSeason(seriesId, 1);

			await insertTestEpisode(testSonarrConnectorId, seasonId, 101, 1, 1, true, false);

			await discoverGaps(testSonarrConnectorId);

			const registries = await getSearchRegistries(testSonarrConnectorId);

			expect(registries.length).toBe(1);
			expect(registries[0]!.state).toBe('pending');
			expect(registries[0]!.searchType).toBe('gap');
			expect(registries[0]!.contentType).toBe('episode');
		});

		it('should return error for non-existent connector', async () => {
			const result = await discoverGaps(999999);

			expect(result.success).toBe(false);
			expect(result.error).toContain('not found');
		});
	});

	describe('discoverGaps - Idempotency', () => {
		it('should be idempotent - running twice creates no duplicates', async () => {
			const seriesId = await insertTestSeries(testSonarrConnectorId, 1, 'Test Series');
			const seasonId = await insertTestSeason(seriesId, 1);

			await insertTestEpisode(testSonarrConnectorId, seasonId, 101, 1, 1, true, false);
			await insertTestEpisode(testSonarrConnectorId, seasonId, 102, 1, 2, true, false);

			// First discovery
			const result1 = await discoverGaps(testSonarrConnectorId);
			expect(result1.gapsFound).toBe(2);
			expect(result1.registriesCreated).toBe(2);
			expect(result1.registriesSkipped).toBe(0);

			// Second discovery - should skip existing registries
			const result2 = await discoverGaps(testSonarrConnectorId);
			expect(result2.gapsFound).toBe(2);
			expect(result2.registriesCreated).toBe(0);
			expect(result2.registriesSkipped).toBe(2);

			// Verify only 2 registry entries exist
			const registryCount = await countSearchRegistry(testSonarrConnectorId, 'gap');
			expect(registryCount).toBe(2);
		});

		it('should only create registries for new gaps', async () => {
			const seriesId = await insertTestSeries(testSonarrConnectorId, 1, 'Test Series');
			const seasonId = await insertTestSeason(seriesId, 1);

			// Create initial gap
			await insertTestEpisode(testSonarrConnectorId, seasonId, 101, 1, 1, true, false);

			// First discovery
			const result1 = await discoverGaps(testSonarrConnectorId);
			expect(result1.registriesCreated).toBe(1);

			// Add another gap
			await insertTestEpisode(testSonarrConnectorId, seasonId, 102, 1, 2, true, false);

			// Second discovery - should only create registry for new gap
			const result2 = await discoverGaps(testSonarrConnectorId);
			expect(result2.gapsFound).toBe(2);
			expect(result2.registriesCreated).toBe(1); // Only the new gap
			expect(result2.registriesSkipped).toBe(1); // The existing gap
		});
	});

	describe('discoverGaps - Mixed Content States', () => {
		it('should only detect gaps among mixed content states', async () => {
			const seriesId = await insertTestSeries(testSonarrConnectorId, 1, 'Test Series');
			const seasonId = await insertTestSeason(seriesId, 1);

			// Mix of states
			await insertTestEpisode(testSonarrConnectorId, seasonId, 101, 1, 1, true, false); // Gap
			await insertTestEpisode(testSonarrConnectorId, seasonId, 102, 1, 2, true, true); // Has file
			await insertTestEpisode(testSonarrConnectorId, seasonId, 103, 1, 3, false, false); // Unmonitored
			await insertTestEpisode(testSonarrConnectorId, seasonId, 104, 1, 4, false, true); // Unmonitored + has file
			await insertTestEpisode(testSonarrConnectorId, seasonId, 105, 1, 5, true, false); // Gap

			const result = await discoverGaps(testSonarrConnectorId);

			expect(result.success).toBe(true);
			expect(result.gapsFound).toBe(2); // Only episodes 1 and 5
			expect(result.registriesCreated).toBe(2);
		});
	});

	describe('getGapStats', () => {
		it('should return correct gap counts without creating registries', async () => {
			const seriesId = await insertTestSeries(testSonarrConnectorId, 1, 'Test Series');
			const seasonId = await insertTestSeason(seriesId, 1);

			await insertTestEpisode(testSonarrConnectorId, seasonId, 101, 1, 1, true, false);
			await insertTestEpisode(testSonarrConnectorId, seasonId, 102, 1, 2, true, false);

			const stats = await getGapStats(testSonarrConnectorId);

			expect(stats.episodeGaps).toBe(2);
			expect(stats.movieGaps).toBe(0);

			// Verify no registries were created
			const registryCount = await countSearchRegistry(testSonarrConnectorId);
			expect(registryCount).toBe(0);
		});

		it('should return movie gap counts for radarr', async () => {
			await insertTestMovie(testRadarrConnectorId, 201, 'Missing Movie 1', true, false);
			await insertTestMovie(testRadarrConnectorId, 202, 'Missing Movie 2', true, false);
			await insertTestMovie(testRadarrConnectorId, 203, 'Has File Movie', true, true);

			const stats = await getGapStats(testRadarrConnectorId);

			expect(stats.episodeGaps).toBe(0);
			expect(stats.movieGaps).toBe(2);
		});
	});
});

// ============================================================================
// Property-Based Tests
// ============================================================================

describe('Property 2: Gap Discovery Correctness - Property-Based Tests', () => {
	// Arbitrary for episode data
	const episodeDataArbitrary = fc.record({
		arrId: fc.integer({ min: 1, max: 100000 }),
		seasonNumber: fc.integer({ min: 0, max: 50 }),
		episodeNumber: fc.integer({ min: 1, max: 100 }),
		monitored: fc.boolean(),
		hasFile: fc.boolean()
	});

	// Arbitrary for movie data
	const movieDataArbitrary = fc.record({
		arrId: fc.integer({ min: 1, max: 100000 }),
		title: fc.string({ minLength: 1, maxLength: 50 }),
		monitored: fc.boolean(),
		hasFile: fc.boolean()
	});

	// Deduplicate by arrId
	function deduplicateByArrId<T extends { arrId: number }>(items: T[]): T[] {
		const seen = new Set<number>();
		return items.filter((item) => {
			if (seen.has(item.arrId)) return false;
			seen.add(item.arrId);
			return true;
		});
	}

	describe('Episode Gap Detection', () => {
		it('should detect exactly the episodes where monitored=true AND hasFile=false', async () => {
			await fc.assert(
				fc.asyncProperty(
					fc.array(episodeDataArbitrary, { minLength: 1, maxLength: 20 }).map(deduplicateByArrId),
					async (episodeData) => {
						// Clean up before each iteration
						await cleanupConnectorData(testSonarrConnectorId);

						// Create series and season
						const seriesId = await insertTestSeries(
							testSonarrConnectorId,
							1,
							'Property Test Series'
						);
						const seasonId = await insertTestSeason(seriesId, 1);

						// Insert episodes
						for (const ep of episodeData) {
							await db.insert(episodes).values({
								connectorId: testSonarrConnectorId,
								seasonId,
								arrId: ep.arrId,
								seasonNumber: ep.seasonNumber,
								episodeNumber: ep.episodeNumber,
								title: `Episode ${ep.episodeNumber}`,
								monitored: ep.monitored,
								hasFile: ep.hasFile,
								qualityCutoffNotMet: false
							});
						}

						// Calculate expected gaps
						const expectedGaps = episodeData.filter((ep) => ep.monitored && !ep.hasFile).length;

						// Run discovery
						const result = await discoverGaps(testSonarrConnectorId);

						// Verify
						expect(result.success).toBe(true);
						expect(result.gapsFound).toBe(expectedGaps);
						expect(result.registriesCreated).toBe(expectedGaps);

						// Verify all created registries have correct state and type
						if (expectedGaps > 0) {
							const registries = await getSearchRegistries(testSonarrConnectorId);
							for (const reg of registries) {
								expect(reg.state).toBe('pending');
								expect(reg.searchType).toBe('gap');
								expect(reg.contentType).toBe('episode');
							}
						}
					}
				),
				{ numRuns: 50 } // Reduced iterations for database tests
			);
		});
	});

	describe('Movie Gap Detection', () => {
		it('should detect exactly the movies where monitored=true AND hasFile=false', async () => {
			await fc.assert(
				fc.asyncProperty(
					fc.array(movieDataArbitrary, { minLength: 1, maxLength: 20 }).map(deduplicateByArrId),
					async (movieData) => {
						// Clean up before each iteration
						await cleanupConnectorData(testRadarrConnectorId);

						// Insert movies
						for (const movie of movieData) {
							await db.insert(movies).values({
								connectorId: testRadarrConnectorId,
								arrId: movie.arrId,
								title: movie.title,
								year: 2024,
								monitored: movie.monitored,
								hasFile: movie.hasFile,
								qualityCutoffNotMet: false
							});
						}

						// Calculate expected gaps
						const expectedGaps = movieData.filter((m) => m.monitored && !m.hasFile).length;

						// Run discovery
						const result = await discoverGaps(testRadarrConnectorId);

						// Verify
						expect(result.success).toBe(true);
						expect(result.gapsFound).toBe(expectedGaps);
						expect(result.registriesCreated).toBe(expectedGaps);

						// Verify all created registries have correct state and type
						if (expectedGaps > 0) {
							const registries = await getSearchRegistries(testRadarrConnectorId);
							for (const reg of registries) {
								expect(reg.state).toBe('pending');
								expect(reg.searchType).toBe('gap');
								expect(reg.contentType).toBe('movie');
							}
						}
					}
				),
				{ numRuns: 50 } // Reduced iterations for database tests
			);
		});
	});

	describe('Idempotency Property', () => {
		it('running discovery twice should not change total registry count', async () => {
			await fc.assert(
				fc.asyncProperty(
					fc.array(movieDataArbitrary, { minLength: 1, maxLength: 10 }).map(deduplicateByArrId),
					async (movieData) => {
						// Clean up before each iteration
						await cleanupConnectorData(testRadarrConnectorId);

						// Insert movies
						for (const movie of movieData) {
							await db.insert(movies).values({
								connectorId: testRadarrConnectorId,
								arrId: movie.arrId,
								title: movie.title,
								year: 2024,
								monitored: movie.monitored,
								hasFile: movie.hasFile,
								qualityCutoffNotMet: false
							});
						}

						// First discovery
						const result1 = await discoverGaps(testRadarrConnectorId);
						const countAfterFirst = await countSearchRegistry(testRadarrConnectorId, 'gap');

						// Second discovery
						const result2 = await discoverGaps(testRadarrConnectorId);
						const countAfterSecond = await countSearchRegistry(testRadarrConnectorId, 'gap');

						// Registry count should be the same after both runs
						expect(countAfterSecond).toBe(countAfterFirst);

						// Second run should create no new registries
						expect(result2.registriesCreated).toBe(0);

						// Second run should skip all gaps (they already have registries)
						expect(result2.registriesSkipped).toBe(result1.gapsFound);
					}
				),
				{ numRuns: 30 }
			);
		});
	});
});

// ============================================================================
// Registry Cleanup on Success Tests (Requirement 3.4)
// ============================================================================

describe('Gap Registry Cleanup on Success', () => {
	describe('Episode Gap Cleanup', () => {
		it('should delete gap registry when hasFile becomes true', async () => {
			// Create test series and season
			const seriesId = await insertTestSeries(testSonarrConnectorId, 1, 'Test Series');
			const seasonId = await insertTestSeason(seriesId, 1);

			// Create episode with hasFile=false (gap)
			const episodeId = await insertTestEpisode(
				testSonarrConnectorId,
				seasonId,
				101,
				1,
				1,
				true,
				false
			);

			// Run discovery - creates registry
			const result1 = await discoverGaps(testSonarrConnectorId);
			expect(result1.registriesCreated).toBe(1);
			expect(result1.registriesResolved).toBe(0);

			// Verify registry was created
			let registryCount = await countSearchRegistry(testSonarrConnectorId, 'gap');
			expect(registryCount).toBe(1);

			// Update episode hasFile to true (simulating successful download)
			await db.update(episodes).set({ hasFile: true }).where(eq(episodes.id, episodeId));

			// Run discovery again - should clean up resolved registry
			const result2 = await discoverGaps(testSonarrConnectorId);
			expect(result2.registriesResolved).toBe(1);
			expect(result2.gapsFound).toBe(0);

			// Verify registry was deleted
			registryCount = await countSearchRegistry(testSonarrConnectorId, 'gap');
			expect(registryCount).toBe(0);
		});

		it('should NOT delete gap registry while hasFile is still false', async () => {
			// Create test series and season
			const seriesId = await insertTestSeries(testSonarrConnectorId, 1, 'Test Series');
			const seasonId = await insertTestSeason(seriesId, 1);

			// Create episode with hasFile=false (gap)
			await insertTestEpisode(testSonarrConnectorId, seasonId, 101, 1, 1, true, false);

			// Run discovery - creates registry
			const result1 = await discoverGaps(testSonarrConnectorId);
			expect(result1.registriesCreated).toBe(1);

			// Run discovery again without changing hasFile
			const result2 = await discoverGaps(testSonarrConnectorId);
			expect(result2.registriesResolved).toBe(0);
			expect(result2.registriesSkipped).toBe(1);

			// Verify registry still exists
			const registryCount = await countSearchRegistry(testSonarrConnectorId, 'gap');
			expect(registryCount).toBe(1);
		});
	});

	describe('Movie Gap Cleanup', () => {
		it('should delete gap registry when hasFile becomes true', async () => {
			// Create movie with hasFile=false (gap)
			const movieId = await insertTestMovie(
				testRadarrConnectorId,
				201,
				'Missing Movie',
				true,
				false
			);

			// Run discovery - creates registry
			const result1 = await discoverGaps(testRadarrConnectorId);
			expect(result1.registriesCreated).toBe(1);
			expect(result1.registriesResolved).toBe(0);

			// Verify registry was created
			let registryCount = await countSearchRegistry(testRadarrConnectorId, 'gap');
			expect(registryCount).toBe(1);

			// Update movie hasFile to true (simulating successful download)
			await db.update(movies).set({ hasFile: true }).where(eq(movies.id, movieId));

			// Run discovery again - should clean up resolved registry
			const result2 = await discoverGaps(testRadarrConnectorId);
			expect(result2.registriesResolved).toBe(1);
			expect(result2.gapsFound).toBe(0);

			// Verify registry was deleted
			registryCount = await countSearchRegistry(testRadarrConnectorId, 'gap');
			expect(registryCount).toBe(0);
		});

		it('should handle mixed resolved and unresolved gaps', async () => {
			// Create two movies with hasFile=false (gaps)
			const movieId1 = await insertTestMovie(testRadarrConnectorId, 201, 'Movie 1', true, false);
			await insertTestMovie(testRadarrConnectorId, 202, 'Movie 2', true, false);

			// Run discovery - creates 2 registries
			const result1 = await discoverGaps(testRadarrConnectorId);
			expect(result1.registriesCreated).toBe(2);

			// Verify registries were created
			let registryCount = await countSearchRegistry(testRadarrConnectorId, 'gap');
			expect(registryCount).toBe(2);

			// Update only one movie hasFile to true
			await db.update(movies).set({ hasFile: true }).where(eq(movies.id, movieId1));

			// Run discovery again
			const result2 = await discoverGaps(testRadarrConnectorId);
			expect(result2.registriesResolved).toBe(1); // One resolved
			expect(result2.gapsFound).toBe(1); // One still a gap
			expect(result2.registriesSkipped).toBe(1); // One already has registry

			// Verify only one registry remains
			registryCount = await countSearchRegistry(testRadarrConnectorId, 'gap');
			expect(registryCount).toBe(1);
		});
	});
});

// ============================================================================
// Property 4: Search Registry Cleanup on Success - Property-Based Tests
// ============================================================================

describe('Property 4: Gap Registry Cleanup on Success - Property-Based Tests', () => {
	const movieCleanupArbitrary = fc.record({
		arrId: fc.integer({ min: 1, max: 100000 }),
		title: fc.string({ minLength: 1, maxLength: 50 }),
		resolveAfterFirstDiscovery: fc.boolean()
	});

	describe('Movie Gap Cleanup Property', () => {
		it('gap registries should be deleted exactly when hasFile becomes true', async () => {
			await fc.assert(
				fc.asyncProperty(
					fc.array(movieCleanupArbitrary, { minLength: 1, maxLength: 10 }),
					async (moviesData) => {
						// Deduplicate by arrId
						const uniqueMovies = moviesData.filter(
							(m, i, arr) => arr.findIndex((x) => x.arrId === m.arrId) === i
						);

						// Clean up before each iteration
						await cleanupConnectorData(testRadarrConnectorId);

						// Insert all movies as gaps (hasFile=false, monitored=true)
						const movieIds: number[] = [];
						for (const movie of uniqueMovies) {
							const id = await insertTestMovie(
								testRadarrConnectorId,
								movie.arrId,
								movie.title,
								true,
								false
							);
							movieIds.push(id);
						}

						// First discovery - creates registries for all gaps
						const result1 = await discoverGaps(testRadarrConnectorId);
						expect(result1.registriesCreated).toBe(uniqueMovies.length);

						// Determine which movies to "resolve" (set hasFile=true)
						const moviesToResolve = uniqueMovies.filter((m) => m.resolveAfterFirstDiscovery);
						const movieIdsToResolve = moviesToResolve.map(
							(m) => movieIds[uniqueMovies.findIndex((x) => x.arrId === m.arrId)]!
						);

						// Resolve the selected movies
						for (const movieId of movieIdsToResolve) {
							await db.update(movies).set({ hasFile: true }).where(eq(movies.id, movieId));
						}

						// Run discovery again
						const result2 = await discoverGaps(testRadarrConnectorId);

						// Verify correct number resolved
						expect(result2.registriesResolved).toBe(moviesToResolve.length);

						// Verify remaining gap count
						const remainingGaps = uniqueMovies.length - moviesToResolve.length;
						expect(result2.gapsFound).toBe(remainingGaps);

						// Verify registry count matches remaining gaps
						const registryCount = await countSearchRegistry(testRadarrConnectorId, 'gap');
						expect(registryCount).toBe(remainingGaps);
					}
				),
				{ numRuns: 50 }
			);
		});
	});
});
