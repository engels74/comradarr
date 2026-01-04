/**
 * Integration tests for orphan cleanup service.
 *
 * Validates requirement:
 * - 13.2: WHEN orphan cleanup runs THEN the System SHALL delete search state
 *         entries without corresponding content mirror items
 *
 * NOTE: These tests require a running PostgreSQL database with DATABASE_URL set.
 * Run with: bun test tests/integration/orphan-cleanup.test.ts
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../src/lib/server/db';
import {
	connectors,
	episodes,
	movies,
	searchRegistry,
	seasons,
	series
} from '../../src/lib/server/db/schema';
import { cleanupOrphanedSearchState } from '../../src/lib/server/services/maintenance';

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
 * Insert an orphaned search registry entry (references non-existent content)
 */
async function insertOrphanedSearchRegistry(
	connectorId: number,
	contentType: 'episode' | 'movie',
	contentId: number // Non-existent ID
): Promise<number> {
	const result = await db
		.insert(searchRegistry)
		.values({
			connectorId,
			contentType,
			contentId,
			searchType: 'gap',
			state: 'pending',
			attemptCount: 0,
			priority: 100
		})
		.returning({ id: searchRegistry.id });

	return result[0]!.id;
}

/**
 * Insert a valid search registry entry (references existing content)
 */
async function insertValidSearchRegistry(
	connectorId: number,
	contentType: 'episode' | 'movie',
	contentId: number
): Promise<number> {
	const result = await db
		.insert(searchRegistry)
		.values({
			connectorId,
			contentType,
			contentId,
			searchType: 'gap',
			state: 'pending',
			attemptCount: 0,
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

// ============================================================================
// Test Setup and Teardown
// ============================================================================

beforeAll(async () => {
	// Set test SECRET_KEY
	process.env.SECRET_KEY = TEST_SECRET_KEY;

	// Create test connectors
	testSonarrConnectorId = await createTestConnector('sonarr', 'Test Sonarr Orphan Cleanup');
	testRadarrConnectorId = await createTestConnector('radarr', 'Test Radarr Orphan Cleanup');
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
// Tests
// ============================================================================

describe('Orphan Cleanup Service (Requirement 13.2)', () => {
	describe('cleanupOrphanedSearchState - Basic Functionality', () => {
		it('should return success with zero deletions when no orphans exist', async () => {
			const result = await cleanupOrphanedSearchState();

			expect(result.success).toBe(true);
			expect(result.episodeOrphansDeleted).toBe(0);
			expect(result.movieOrphansDeleted).toBe(0);
			expect(result.totalOrphansDeleted).toBe(0);
		});

		it('should delete orphaned episode search registries', async () => {
			// Create orphaned episode registries (contentId references non-existent episodes)
			// Use high contentId values that won't exist
			await insertOrphanedSearchRegistry(testSonarrConnectorId, 'episode', 999001);
			await insertOrphanedSearchRegistry(testSonarrConnectorId, 'episode', 999002);
			await insertOrphanedSearchRegistry(testSonarrConnectorId, 'episode', 999003);

			// Verify orphans exist
			const countBefore = await countSearchRegistry(testSonarrConnectorId);
			expect(countBefore).toBe(3);

			// Run cleanup
			const result = await cleanupOrphanedSearchState();

			expect(result.success).toBe(true);
			expect(result.episodeOrphansDeleted).toBe(3);
			expect(result.movieOrphansDeleted).toBe(0);
			expect(result.totalOrphansDeleted).toBe(3);

			// Verify orphans are deleted
			const countAfter = await countSearchRegistry(testSonarrConnectorId);
			expect(countAfter).toBe(0);
		});

		it('should delete orphaned movie search registries', async () => {
			// Create orphaned movie registries (contentId references non-existent movies)
			await insertOrphanedSearchRegistry(testRadarrConnectorId, 'movie', 999001);
			await insertOrphanedSearchRegistry(testRadarrConnectorId, 'movie', 999002);

			// Verify orphans exist
			const countBefore = await countSearchRegistry(testRadarrConnectorId);
			expect(countBefore).toBe(2);

			// Run cleanup
			const result = await cleanupOrphanedSearchState();

			expect(result.success).toBe(true);
			expect(result.episodeOrphansDeleted).toBe(0);
			expect(result.movieOrphansDeleted).toBe(2);
			expect(result.totalOrphansDeleted).toBe(2);

			// Verify orphans are deleted
			const countAfter = await countSearchRegistry(testRadarrConnectorId);
			expect(countAfter).toBe(0);
		});

		it('should delete both episode and movie orphans in same run', async () => {
			// Create orphaned episode registries
			await insertOrphanedSearchRegistry(testSonarrConnectorId, 'episode', 999001);
			await insertOrphanedSearchRegistry(testSonarrConnectorId, 'episode', 999002);

			// Create orphaned movie registries
			await insertOrphanedSearchRegistry(testRadarrConnectorId, 'movie', 999001);

			// Run cleanup
			const result = await cleanupOrphanedSearchState();

			expect(result.success).toBe(true);
			expect(result.episodeOrphansDeleted).toBe(2);
			expect(result.movieOrphansDeleted).toBe(1);
			expect(result.totalOrphansDeleted).toBe(3);

			// Verify all orphans are deleted
			expect(await countSearchRegistry(testSonarrConnectorId)).toBe(0);
			expect(await countSearchRegistry(testRadarrConnectorId)).toBe(0);
		});
	});

	describe('cleanupOrphanedSearchState - Preserves Valid Entries', () => {
		it('should NOT delete valid episode search registries', async () => {
			// Create actual episode content
			const seriesId = await insertTestSeries(testSonarrConnectorId, 1, 'Test Series');
			const seasonId = await insertTestSeason(seriesId, 1);
			const episodeId = await insertTestEpisode(testSonarrConnectorId, seasonId, 101, 1, 1);

			// Create valid search registry pointing to existing episode
			await insertValidSearchRegistry(testSonarrConnectorId, 'episode', episodeId);

			// Verify registry exists
			const countBefore = await countSearchRegistry(testSonarrConnectorId);
			expect(countBefore).toBe(1);

			// Run cleanup
			const result = await cleanupOrphanedSearchState();

			expect(result.success).toBe(true);
			expect(result.episodeOrphansDeleted).toBe(0);
			expect(result.totalOrphansDeleted).toBe(0);

			// Verify valid registry is NOT deleted
			const countAfter = await countSearchRegistry(testSonarrConnectorId);
			expect(countAfter).toBe(1);
		});

		it('should NOT delete valid movie search registries', async () => {
			// Create actual movie content
			const movieId = await insertTestMovie(testRadarrConnectorId, 201, 'Test Movie');

			// Create valid search registry pointing to existing movie
			await insertValidSearchRegistry(testRadarrConnectorId, 'movie', movieId);

			// Verify registry exists
			const countBefore = await countSearchRegistry(testRadarrConnectorId);
			expect(countBefore).toBe(1);

			// Run cleanup
			const result = await cleanupOrphanedSearchState();

			expect(result.success).toBe(true);
			expect(result.movieOrphansDeleted).toBe(0);
			expect(result.totalOrphansDeleted).toBe(0);

			// Verify valid registry is NOT deleted
			const countAfter = await countSearchRegistry(testRadarrConnectorId);
			expect(countAfter).toBe(1);
		});

		it('should only delete orphans and preserve valid entries in mixed scenario', async () => {
			// Create actual content
			const seriesId = await insertTestSeries(testSonarrConnectorId, 1, 'Test Series');
			const seasonId = await insertTestSeason(seriesId, 1);
			const episodeId = await insertTestEpisode(testSonarrConnectorId, seasonId, 101, 1, 1);
			const movieId = await insertTestMovie(testRadarrConnectorId, 201, 'Test Movie');

			// Create valid registries
			await insertValidSearchRegistry(testSonarrConnectorId, 'episode', episodeId);
			await insertValidSearchRegistry(testRadarrConnectorId, 'movie', movieId);

			// Create orphaned registries
			await insertOrphanedSearchRegistry(testSonarrConnectorId, 'episode', 999001);
			await insertOrphanedSearchRegistry(testRadarrConnectorId, 'movie', 999001);

			// Verify counts before
			expect(await countSearchRegistry(testSonarrConnectorId)).toBe(2); // 1 valid + 1 orphan
			expect(await countSearchRegistry(testRadarrConnectorId)).toBe(2); // 1 valid + 1 orphan

			// Run cleanup
			const result = await cleanupOrphanedSearchState();

			expect(result.success).toBe(true);
			expect(result.episodeOrphansDeleted).toBe(1);
			expect(result.movieOrphansDeleted).toBe(1);
			expect(result.totalOrphansDeleted).toBe(2);

			// Verify only valid entries remain
			expect(await countSearchRegistry(testSonarrConnectorId)).toBe(1); // Only valid
			expect(await countSearchRegistry(testRadarrConnectorId)).toBe(1); // Only valid
		});
	});

	describe('cleanupOrphanedSearchState - Idempotency', () => {
		it('should be idempotent - running twice produces same result', async () => {
			// Create orphaned registries
			await insertOrphanedSearchRegistry(testSonarrConnectorId, 'episode', 999001);
			await insertOrphanedSearchRegistry(testRadarrConnectorId, 'movie', 999001);

			// First run
			const result1 = await cleanupOrphanedSearchState();
			expect(result1.totalOrphansDeleted).toBe(2);

			// Second run - should find nothing to delete
			const result2 = await cleanupOrphanedSearchState();
			expect(result2.success).toBe(true);
			expect(result2.totalOrphansDeleted).toBe(0);
		});
	});

	describe('cleanupOrphanedSearchState - Connector Isolation', () => {
		it('should only delete orphans matching connector_id', async () => {
			// This tests that the cleanup respects the connector_id constraint in the query
			// Create orphan for Sonarr connector with mismatched connector_id in content
			// (The orphan check includes connector_id match)

			// Create a valid episode for Sonarr connector
			const seriesId = await insertTestSeries(testSonarrConnectorId, 1, 'Test Series');
			const seasonId = await insertTestSeason(seriesId, 1);
			const episodeId = await insertTestEpisode(testSonarrConnectorId, seasonId, 101, 1, 1);

			// Create registry with correct connector but wrong content ID
			await insertOrphanedSearchRegistry(testSonarrConnectorId, 'episode', 999999);

			// Create registry with correct connector and correct content ID
			await insertValidSearchRegistry(testSonarrConnectorId, 'episode', episodeId);

			// Run cleanup
			const result = await cleanupOrphanedSearchState();

			expect(result.success).toBe(true);
			expect(result.episodeOrphansDeleted).toBe(1); // Only the orphan with wrong contentId

			// Valid registry should remain
			expect(await countSearchRegistry(testSonarrConnectorId)).toBe(1);
		});
	});

	describe('cleanupOrphanedSearchState - Timing Metrics', () => {
		it('should return durationMs in result', async () => {
			const result = await cleanupOrphanedSearchState();

			expect(result.success).toBe(true);
			expect(typeof result.durationMs).toBe('number');
			expect(result.durationMs).toBeGreaterThanOrEqual(0);
		});
	});
});
