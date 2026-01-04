/**
 * Integration tests for upgrade discovery service.
 *
 * Validates requirements:
 * - 4.1: Identify all monitored items where qualityCutoffNotMet equals true
 * - 4.3: Create search registry entry with state "pending" and search type "upgrade"
 * - 4.4: Delete search registry entry when qualityCutoffNotMet becomes false
 *
 * Property 3: Upgrade Discovery Correctness
 * - For any content mirror state, upgrade discovery should return exactly the set
 *   of items where monitored=true AND hasFile=true AND qualityCutoffNotMet=true
 * - No upgrade candidates should be excluded (no false negatives)
 * - No non-upgradeable items should be included (no false positives)
 *
 * NOTE: These tests require a running PostgreSQL database with DATABASE_URL set.
 * Run with: bun test tests/integration/upgrade-discovery.test.ts
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
import { eq, and, sql } from 'drizzle-orm';
import { discoverUpgrades, getUpgradeStats } from '../../src/lib/server/services/discovery';

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
	hasFile: boolean = true,
	qualityCutoffNotMet: boolean = false
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
			qualityCutoffNotMet
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
	hasFile: boolean = true,
	qualityCutoffNotMet: boolean = false
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
			qualityCutoffNotMet
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
	testSonarrConnectorId = await createTestConnector('sonarr', 'Test Sonarr Upgrade Discovery');
	testRadarrConnectorId = await createTestConnector('radarr', 'Test Radarr Upgrade Discovery');
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

describe('Upgrade Discovery Service', () => {
	describe('discoverUpgrades - Basic Functionality', () => {
		it('should return empty result when no content exists', async () => {
			const result = await discoverUpgrades(testSonarrConnectorId);

			expect(result.success).toBe(true);
			expect(result.upgradesFound).toBe(0);
			expect(result.registriesCreated).toBe(0);
			expect(result.registriesSkipped).toBe(0);
		});

		it('should detect episode upgrades (monitored=true, hasFile=true, qualityCutoffNotMet=true)', async () => {
			// Create test series and season
			const seriesId = await insertTestSeries(testSonarrConnectorId, 1, 'Test Series');
			const seasonId = await insertTestSeason(seriesId, 1);

			// Create episodes - 3 upgrade candidates
			await insertTestEpisode(testSonarrConnectorId, seasonId, 101, 1, 1, true, true, true); // Upgrade
			await insertTestEpisode(testSonarrConnectorId, seasonId, 102, 1, 2, true, true, true); // Upgrade
			await insertTestEpisode(testSonarrConnectorId, seasonId, 103, 1, 3, true, true, true); // Upgrade

			const result = await discoverUpgrades(testSonarrConnectorId);

			expect(result.success).toBe(true);
			expect(result.connectorType).toBe('sonarr');
			expect(result.upgradesFound).toBe(3);
			expect(result.registriesCreated).toBe(3);
			expect(result.registriesSkipped).toBe(0);
		});

		it('should detect movie upgrades (monitored=true, hasFile=true, qualityCutoffNotMet=true)', async () => {
			// Create movies - 2 upgrade candidates
			await insertTestMovie(testRadarrConnectorId, 201, 'Upgrade Movie 1', true, true, true); // Upgrade
			await insertTestMovie(testRadarrConnectorId, 202, 'Upgrade Movie 2', true, true, true); // Upgrade

			const result = await discoverUpgrades(testRadarrConnectorId);

			expect(result.success).toBe(true);
			expect(result.connectorType).toBe('radarr');
			expect(result.upgradesFound).toBe(2);
			expect(result.registriesCreated).toBe(2);
			expect(result.registriesSkipped).toBe(0);
		});

		it('should NOT detect items without files (those are gaps, not upgrades)', async () => {
			const seriesId = await insertTestSeries(testSonarrConnectorId, 1, 'Test Series');
			const seasonId = await insertTestSeason(seriesId, 1);

			// Create episodes without files - these are gaps, not upgrades
			await insertTestEpisode(testSonarrConnectorId, seasonId, 101, 1, 1, true, false, true);
			await insertTestEpisode(testSonarrConnectorId, seasonId, 102, 1, 2, true, false, true);

			const result = await discoverUpgrades(testSonarrConnectorId);

			expect(result.success).toBe(true);
			expect(result.upgradesFound).toBe(0);
			expect(result.registriesCreated).toBe(0);
		});

		it('should NOT detect items with qualityCutoffNotMet=false', async () => {
			const seriesId = await insertTestSeries(testSonarrConnectorId, 1, 'Test Series');
			const seasonId = await insertTestSeason(seriesId, 1);

			// Create episodes at quality cutoff (not upgradeable)
			await insertTestEpisode(testSonarrConnectorId, seasonId, 101, 1, 1, true, true, false);
			await insertTestEpisode(testSonarrConnectorId, seasonId, 102, 1, 2, true, true, false);

			const result = await discoverUpgrades(testSonarrConnectorId);

			expect(result.success).toBe(true);
			expect(result.upgradesFound).toBe(0);
			expect(result.registriesCreated).toBe(0);
		});

		it('should NOT detect items with monitored=false', async () => {
			const seriesId = await insertTestSeries(testSonarrConnectorId, 1, 'Test Series');
			const seasonId = await insertTestSeason(seriesId, 1);

			// Create unmonitored episodes that would otherwise be upgradeable
			await insertTestEpisode(testSonarrConnectorId, seasonId, 101, 1, 1, false, true, true);
			await insertTestEpisode(testSonarrConnectorId, seasonId, 102, 1, 2, false, true, true);

			const result = await discoverUpgrades(testSonarrConnectorId);

			expect(result.success).toBe(true);
			expect(result.upgradesFound).toBe(0);
			expect(result.registriesCreated).toBe(0);
		});

		it('should create registry entries with correct state and type', async () => {
			const seriesId = await insertTestSeries(testSonarrConnectorId, 1, 'Test Series');
			const seasonId = await insertTestSeason(seriesId, 1);

			await insertTestEpisode(testSonarrConnectorId, seasonId, 101, 1, 1, true, true, true);

			await discoverUpgrades(testSonarrConnectorId);

			const registries = await getSearchRegistries(testSonarrConnectorId);

			expect(registries.length).toBe(1);
			expect(registries[0]!.state).toBe('pending');
			expect(registries[0]!.searchType).toBe('upgrade');
			expect(registries[0]!.contentType).toBe('episode');
		});

		it('should return error for non-existent connector', async () => {
			const result = await discoverUpgrades(999999);

			expect(result.success).toBe(false);
			expect(result.error).toContain('not found');
		});
	});

	describe('discoverUpgrades - Idempotency', () => {
		it('should be idempotent - running twice creates no duplicates', async () => {
			const seriesId = await insertTestSeries(testSonarrConnectorId, 1, 'Test Series');
			const seasonId = await insertTestSeason(seriesId, 1);

			await insertTestEpisode(testSonarrConnectorId, seasonId, 101, 1, 1, true, true, true);
			await insertTestEpisode(testSonarrConnectorId, seasonId, 102, 1, 2, true, true, true);

			// First discovery
			const result1 = await discoverUpgrades(testSonarrConnectorId);
			expect(result1.upgradesFound).toBe(2);
			expect(result1.registriesCreated).toBe(2);
			expect(result1.registriesSkipped).toBe(0);

			// Second discovery - should skip existing registries
			const result2 = await discoverUpgrades(testSonarrConnectorId);
			expect(result2.upgradesFound).toBe(2);
			expect(result2.registriesCreated).toBe(0);
			expect(result2.registriesSkipped).toBe(2);

			// Verify only 2 registry entries exist
			const registryCount = await countSearchRegistry(testSonarrConnectorId, 'upgrade');
			expect(registryCount).toBe(2);
		});

		it('should only create registries for new upgrade candidates', async () => {
			const seriesId = await insertTestSeries(testSonarrConnectorId, 1, 'Test Series');
			const seasonId = await insertTestSeason(seriesId, 1);

			// Create initial upgrade candidate
			await insertTestEpisode(testSonarrConnectorId, seasonId, 101, 1, 1, true, true, true);

			// First discovery
			const result1 = await discoverUpgrades(testSonarrConnectorId);
			expect(result1.registriesCreated).toBe(1);

			// Add another upgrade candidate
			await insertTestEpisode(testSonarrConnectorId, seasonId, 102, 1, 2, true, true, true);

			// Second discovery - should only create registry for new candidate
			const result2 = await discoverUpgrades(testSonarrConnectorId);
			expect(result2.upgradesFound).toBe(2);
			expect(result2.registriesCreated).toBe(1); // Only the new upgrade
			expect(result2.registriesSkipped).toBe(1); // The existing upgrade
		});
	});

	describe('discoverUpgrades - Mixed Content States', () => {
		it('should only detect upgrades among mixed content states', async () => {
			const seriesId = await insertTestSeries(testSonarrConnectorId, 1, 'Test Series');
			const seasonId = await insertTestSeason(seriesId, 1);

			// Mix of states
			await insertTestEpisode(testSonarrConnectorId, seasonId, 101, 1, 1, true, true, true); // Upgrade
			await insertTestEpisode(testSonarrConnectorId, seasonId, 102, 1, 2, true, true, false); // At cutoff
			await insertTestEpisode(testSonarrConnectorId, seasonId, 103, 1, 3, true, false, true); // No file (gap)
			await insertTestEpisode(testSonarrConnectorId, seasonId, 104, 1, 4, false, true, true); // Unmonitored
			await insertTestEpisode(testSonarrConnectorId, seasonId, 105, 1, 5, true, true, true); // Upgrade

			const result = await discoverUpgrades(testSonarrConnectorId);

			expect(result.success).toBe(true);
			expect(result.upgradesFound).toBe(2); // Only episodes 1 and 5
			expect(result.registriesCreated).toBe(2);
		});
	});

	describe('getUpgradeStats', () => {
		it('should return correct upgrade counts without creating registries', async () => {
			const seriesId = await insertTestSeries(testSonarrConnectorId, 1, 'Test Series');
			const seasonId = await insertTestSeason(seriesId, 1);

			await insertTestEpisode(testSonarrConnectorId, seasonId, 101, 1, 1, true, true, true);
			await insertTestEpisode(testSonarrConnectorId, seasonId, 102, 1, 2, true, true, true);

			const stats = await getUpgradeStats(testSonarrConnectorId);

			expect(stats.episodeUpgrades).toBe(2);
			expect(stats.movieUpgrades).toBe(0);

			// Verify no registries were created
			const registryCount = await countSearchRegistry(testSonarrConnectorId);
			expect(registryCount).toBe(0);
		});

		it('should return movie upgrade counts for radarr', async () => {
			await insertTestMovie(testRadarrConnectorId, 201, 'Upgrade Movie 1', true, true, true);
			await insertTestMovie(testRadarrConnectorId, 202, 'Upgrade Movie 2', true, true, true);
			await insertTestMovie(testRadarrConnectorId, 203, 'At Cutoff Movie', true, true, false);

			const stats = await getUpgradeStats(testRadarrConnectorId);

			expect(stats.episodeUpgrades).toBe(0);
			expect(stats.movieUpgrades).toBe(2);
		});
	});
});

// ============================================================================
// Property-Based Tests
// ============================================================================

describe('Property 3: Upgrade Discovery Correctness - Property-Based Tests', () => {
	// Arbitrary for episode data
	const episodeDataArbitrary = fc.record({
		arrId: fc.integer({ min: 1, max: 100000 }),
		seasonNumber: fc.integer({ min: 0, max: 50 }),
		episodeNumber: fc.integer({ min: 1, max: 100 }),
		monitored: fc.boolean(),
		hasFile: fc.boolean(),
		qualityCutoffNotMet: fc.boolean()
	});

	// Arbitrary for movie data
	const movieDataArbitrary = fc.record({
		arrId: fc.integer({ min: 1, max: 100000 }),
		title: fc.string({ minLength: 1, maxLength: 50 }),
		monitored: fc.boolean(),
		hasFile: fc.boolean(),
		qualityCutoffNotMet: fc.boolean()
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

	describe('Episode Upgrade Detection', () => {
		it('should detect exactly the episodes where monitored=true AND hasFile=true AND qualityCutoffNotMet=true', async () => {
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
								qualityCutoffNotMet: ep.qualityCutoffNotMet
							});
						}

						// Calculate expected upgrades (all three conditions must be true)
						const expectedUpgrades = episodeData.filter(
							(ep) => ep.monitored && ep.hasFile && ep.qualityCutoffNotMet
						).length;

						// Run discovery
						const result = await discoverUpgrades(testSonarrConnectorId);

						// Verify
						expect(result.success).toBe(true);
						expect(result.upgradesFound).toBe(expectedUpgrades);
						expect(result.registriesCreated).toBe(expectedUpgrades);

						// Verify all created registries have correct state and type
						if (expectedUpgrades > 0) {
							const registries = await getSearchRegistries(testSonarrConnectorId);
							for (const reg of registries) {
								expect(reg.state).toBe('pending');
								expect(reg.searchType).toBe('upgrade');
								expect(reg.contentType).toBe('episode');
							}
						}
					}
				),
				{ numRuns: 50 } // Reduced iterations for database tests
			);
		});
	});

	describe('Movie Upgrade Detection', () => {
		it('should detect exactly the movies where monitored=true AND hasFile=true AND qualityCutoffNotMet=true', async () => {
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
								qualityCutoffNotMet: movie.qualityCutoffNotMet
							});
						}

						// Calculate expected upgrades (all three conditions must be true)
						const expectedUpgrades = movieData.filter(
							(m) => m.monitored && m.hasFile && m.qualityCutoffNotMet
						).length;

						// Run discovery
						const result = await discoverUpgrades(testRadarrConnectorId);

						// Verify
						expect(result.success).toBe(true);
						expect(result.upgradesFound).toBe(expectedUpgrades);
						expect(result.registriesCreated).toBe(expectedUpgrades);

						// Verify all created registries have correct state and type
						if (expectedUpgrades > 0) {
							const registries = await getSearchRegistries(testRadarrConnectorId);
							for (const reg of registries) {
								expect(reg.state).toBe('pending');
								expect(reg.searchType).toBe('upgrade');
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
								qualityCutoffNotMet: movie.qualityCutoffNotMet
							});
						}

						// First discovery
						const result1 = await discoverUpgrades(testRadarrConnectorId);
						const countAfterFirst = await countSearchRegistry(testRadarrConnectorId, 'upgrade');

						// Second discovery
						const result2 = await discoverUpgrades(testRadarrConnectorId);
						const countAfterSecond = await countSearchRegistry(testRadarrConnectorId, 'upgrade');

						// Registry count should be the same after both runs
						expect(countAfterSecond).toBe(countAfterFirst);

						// Second run should create no new registries
						expect(result2.registriesCreated).toBe(0);

						// Second run should skip all upgrades (they already have registries)
						expect(result2.registriesSkipped).toBe(result1.upgradesFound);
					}
				),
				{ numRuns: 30 }
			);
		});
	});
});

// ============================================================================
// Registry Cleanup on Success Tests (Requirement 4.4)
// ============================================================================

describe('Upgrade Registry Cleanup on Success', () => {
	describe('Episode Upgrade Cleanup', () => {
		it('should delete upgrade registry when qualityCutoffNotMet becomes false', async () => {
			// Create test series and season
			const seriesId = await insertTestSeries(testSonarrConnectorId, 1, 'Test Series');
			const seasonId = await insertTestSeason(seriesId, 1);

			// Create episode with qualityCutoffNotMet=true (upgrade candidate)
			const episodeId = await insertTestEpisode(
				testSonarrConnectorId,
				seasonId,
				101,
				1,
				1,
				true,
				true,
				true
			);

			// Run discovery - creates registry
			const result1 = await discoverUpgrades(testSonarrConnectorId);
			expect(result1.registriesCreated).toBe(1);
			expect(result1.registriesResolved).toBe(0);

			// Verify registry was created
			let registryCount = await countSearchRegistry(testSonarrConnectorId, 'upgrade');
			expect(registryCount).toBe(1);

			// Update episode qualityCutoffNotMet to false (simulating successful upgrade)
			await db
				.update(episodes)
				.set({ qualityCutoffNotMet: false })
				.where(eq(episodes.id, episodeId));

			// Run discovery again - should clean up resolved registry
			const result2 = await discoverUpgrades(testSonarrConnectorId);
			expect(result2.registriesResolved).toBe(1);
			expect(result2.upgradesFound).toBe(0);

			// Verify registry was deleted
			registryCount = await countSearchRegistry(testSonarrConnectorId, 'upgrade');
			expect(registryCount).toBe(0);
		});

		it('should NOT delete upgrade registry while qualityCutoffNotMet is still true', async () => {
			// Create test series and season
			const seriesId = await insertTestSeries(testSonarrConnectorId, 1, 'Test Series');
			const seasonId = await insertTestSeason(seriesId, 1);

			// Create episode with qualityCutoffNotMet=true (upgrade candidate)
			await insertTestEpisode(testSonarrConnectorId, seasonId, 101, 1, 1, true, true, true);

			// Run discovery - creates registry
			const result1 = await discoverUpgrades(testSonarrConnectorId);
			expect(result1.registriesCreated).toBe(1);

			// Run discovery again without changing qualityCutoffNotMet
			const result2 = await discoverUpgrades(testSonarrConnectorId);
			expect(result2.registriesResolved).toBe(0);
			expect(result2.registriesSkipped).toBe(1);

			// Verify registry still exists
			const registryCount = await countSearchRegistry(testSonarrConnectorId, 'upgrade');
			expect(registryCount).toBe(1);
		});
	});

	describe('Movie Upgrade Cleanup', () => {
		it('should delete upgrade registry when qualityCutoffNotMet becomes false', async () => {
			// Create movie with qualityCutoffNotMet=true (upgrade candidate)
			const movieId = await insertTestMovie(
				testRadarrConnectorId,
				201,
				'Upgrade Movie',
				true,
				true,
				true
			);

			// Run discovery - creates registry
			const result1 = await discoverUpgrades(testRadarrConnectorId);
			expect(result1.registriesCreated).toBe(1);
			expect(result1.registriesResolved).toBe(0);

			// Verify registry was created
			let registryCount = await countSearchRegistry(testRadarrConnectorId, 'upgrade');
			expect(registryCount).toBe(1);

			// Update movie qualityCutoffNotMet to false (simulating successful upgrade)
			await db.update(movies).set({ qualityCutoffNotMet: false }).where(eq(movies.id, movieId));

			// Run discovery again - should clean up resolved registry
			const result2 = await discoverUpgrades(testRadarrConnectorId);
			expect(result2.registriesResolved).toBe(1);
			expect(result2.upgradesFound).toBe(0);

			// Verify registry was deleted
			registryCount = await countSearchRegistry(testRadarrConnectorId, 'upgrade');
			expect(registryCount).toBe(0);
		});

		it('should handle mixed resolved and unresolved upgrades', async () => {
			// Create two movies with qualityCutoffNotMet=true (upgrade candidates)
			const movieId1 = await insertTestMovie(
				testRadarrConnectorId,
				201,
				'Movie 1',
				true,
				true,
				true
			);
			await insertTestMovie(testRadarrConnectorId, 202, 'Movie 2', true, true, true);

			// Run discovery - creates 2 registries
			const result1 = await discoverUpgrades(testRadarrConnectorId);
			expect(result1.registriesCreated).toBe(2);

			// Verify registries were created
			let registryCount = await countSearchRegistry(testRadarrConnectorId, 'upgrade');
			expect(registryCount).toBe(2);

			// Update only one movie qualityCutoffNotMet to false
			await db.update(movies).set({ qualityCutoffNotMet: false }).where(eq(movies.id, movieId1));

			// Run discovery again
			const result2 = await discoverUpgrades(testRadarrConnectorId);
			expect(result2.registriesResolved).toBe(1); // One resolved
			expect(result2.upgradesFound).toBe(1); // One still an upgrade candidate
			expect(result2.registriesSkipped).toBe(1); // One already has registry

			// Verify only one registry remains
			registryCount = await countSearchRegistry(testRadarrConnectorId, 'upgrade');
			expect(registryCount).toBe(1);
		});
	});
});

// ============================================================================
// Property 4: Search Registry Cleanup on Success - Property-Based Tests
// ============================================================================

describe('Property 4: Upgrade Registry Cleanup on Success - Property-Based Tests', () => {
	const movieCleanupArbitrary = fc.record({
		arrId: fc.integer({ min: 1, max: 100000 }),
		title: fc.string({ minLength: 1, maxLength: 50 }),
		resolveAfterFirstDiscovery: fc.boolean()
	});

	describe('Movie Upgrade Cleanup Property', () => {
		it('upgrade registries should be deleted exactly when qualityCutoffNotMet becomes false', async () => {
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

						// Insert all movies as upgrade candidates (hasFile=true, qualityCutoffNotMet=true, monitored=true)
						const movieIds: number[] = [];
						for (const movie of uniqueMovies) {
							const id = await insertTestMovie(
								testRadarrConnectorId,
								movie.arrId,
								movie.title,
								true,
								true,
								true
							);
							movieIds.push(id);
						}

						// First discovery - creates registries for all upgrade candidates
						const result1 = await discoverUpgrades(testRadarrConnectorId);
						expect(result1.registriesCreated).toBe(uniqueMovies.length);

						// Determine which movies to "resolve" (set qualityCutoffNotMet=false)
						const moviesToResolve = uniqueMovies.filter((m) => m.resolveAfterFirstDiscovery);
						const movieIdsToResolve = moviesToResolve.map(
							(m) => movieIds[uniqueMovies.findIndex((x) => x.arrId === m.arrId)]!
						);

						// Resolve the selected movies
						for (const movieId of movieIdsToResolve) {
							await db
								.update(movies)
								.set({ qualityCutoffNotMet: false })
								.where(eq(movies.id, movieId));
						}

						// Run discovery again
						const result2 = await discoverUpgrades(testRadarrConnectorId);

						// Verify correct number resolved
						expect(result2.registriesResolved).toBe(moviesToResolve.length);

						// Verify remaining upgrade count
						const remainingUpgrades = uniqueMovies.length - moviesToResolve.length;
						expect(result2.upgradesFound).toBe(remainingUpgrades);

						// Verify registry count matches remaining upgrades
						const registryCount = await countSearchRegistry(testRadarrConnectorId, 'upgrade');
						expect(registryCount).toBe(remainingUpgrades);
					}
				),
				{ numRuns: 50 }
			);
		});
	});
});
