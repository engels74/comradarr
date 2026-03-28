/**
 * Integration tests for queue service.
 *
 * Validates requirements:
 * - 5.2: Process queue in priority order while respecting throttle limits
 *
 * Property 6: Queue Processing Order
 * - Items should be dispatched in strictly descending priority order (highest first)
 *
 * NOTE: These tests require a running PostgreSQL database with DATABASE_URL set.
 * Run with: bun test tests/integration/queue-service.test.ts
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../src/lib/server/db';
import {
	connectors,
	episodes,
	movies,
	requestQueue,
	searchRegistry,
	seasons,
	series
} from '../../src/lib/server/db/schema';
import { dequeuePriorityItems, enqueuePendingItems } from '../../src/lib/server/services/queue';

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
			enabled: true,
			queuePaused: false
		})
		.returning({ id: connectors.id });

	return result[0]!.id;
}

/**
 * Clean up all test data for a connector
 */
async function cleanupConnectorData(connectorId: number): Promise<void> {
	await db.delete(requestQueue).where(eq(requestQueue.connectorId, connectorId));
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
	airDate?: Date
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
			airDate: airDate ?? new Date(),
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
async function insertTestMovie(
	connectorId: number,
	arrId: number,
	title: string,
	year: number = 2024
): Promise<number> {
	const result = await db
		.insert(movies)
		.values({
			connectorId,
			arrId,
			title,
			year,
			monitored: true,
			hasFile: false,
			qualityCutoffNotMet: false
		})
		.returning({ id: movies.id });

	return result[0]!.id;
}

/**
 * Create a pending search registry entry for an episode
 */
async function createPendingEpisodeRegistry(
	connectorId: number,
	episodeId: number
): Promise<number> {
	const result = await db
		.insert(searchRegistry)
		.values({
			connectorId,
			contentType: 'episode',
			contentId: episodeId,
			searchType: 'gap',
			state: 'pending',
			attemptCount: 0,
			priority: 0
		})
		.returning({ id: searchRegistry.id });

	return result[0]!.id;
}

/**
 * Create a pending search registry entry for a movie
 */
async function createPendingMovieRegistry(connectorId: number, movieId: number): Promise<number> {
	const result = await db
		.insert(searchRegistry)
		.values({
			connectorId,
			contentType: 'movie',
			contentId: movieId,
			searchType: 'gap',
			state: 'pending',
			attemptCount: 0,
			priority: 0
		})
		.returning({ id: searchRegistry.id });

	return result[0]!.id;
}

/**
 * Count items in request queue for a connector
 */
async function countQueueItems(connectorId: number): Promise<number> {
	const result = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(requestQueue)
		.where(eq(requestQueue.connectorId, connectorId));

	return result[0]?.count ?? 0;
}

/**
 * Get search registry entry by ID
 */
async function getRegistryById(registryId: number) {
	const result = await db.select().from(searchRegistry).where(eq(searchRegistry.id, registryId));
	return result[0];
}

// ============================================================================
// Test Setup and Teardown
// ============================================================================

beforeAll(async () => {
	// Set test SECRET_KEY
	process.env.SECRET_KEY = TEST_SECRET_KEY;

	// Create test connectors
	testSonarrConnectorId = await createTestConnector('sonarr', 'Test Sonarr Queue Service');
	testRadarrConnectorId = await createTestConnector('radarr', 'Test Radarr Queue Service');
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

	// Reset queuePaused state
	await db
		.update(connectors)
		.set({ queuePaused: false })
		.where(eq(connectors.id, testSonarrConnectorId));
	await db
		.update(connectors)
		.set({ queuePaused: false })
		.where(eq(connectors.id, testRadarrConnectorId));
});

// ============================================================================
// enqueue Tests
// ============================================================================

describe('Queue Service - enqueuePendingItems', () => {
	describe('Basic Functionality', () => {
		it('should return empty result when no pending items exist', async () => {
			const result = await enqueuePendingItems(testSonarrConnectorId);

			expect(result.success).toBe(true);
			expect(result.itemsEnqueued).toBe(0);
			expect(result.itemsSkipped).toBe(0);
		});

		it('should enqueue episode pending registry items', async () => {
			// Create test series, season, and episodes
			const seriesId = await insertTestSeries(testSonarrConnectorId, 1, 'Test Series');
			const seasonId = await insertTestSeason(seriesId, 1);
			const episodeId1 = await insertTestEpisode(testSonarrConnectorId, seasonId, 101, 1, 1);
			const episodeId2 = await insertTestEpisode(testSonarrConnectorId, seasonId, 102, 1, 2);

			// Create pending registries
			await createPendingEpisodeRegistry(testSonarrConnectorId, episodeId1);
			await createPendingEpisodeRegistry(testSonarrConnectorId, episodeId2);

			const result = await enqueuePendingItems(testSonarrConnectorId);

			expect(result.success).toBe(true);
			expect(result.itemsEnqueued).toBe(2);
			expect(result.itemsSkipped).toBe(0);

			// Verify queue items were created
			const queueCount = await countQueueItems(testSonarrConnectorId);
			expect(queueCount).toBe(2);
		});

		it('should enqueue movie pending registry items', async () => {
			// Create test movies
			const movieId1 = await insertTestMovie(testRadarrConnectorId, 201, 'Movie 1');
			const movieId2 = await insertTestMovie(testRadarrConnectorId, 202, 'Movie 2');

			// Create pending registries
			await createPendingMovieRegistry(testRadarrConnectorId, movieId1);
			await createPendingMovieRegistry(testRadarrConnectorId, movieId2);

			const result = await enqueuePendingItems(testRadarrConnectorId);

			expect(result.success).toBe(true);
			expect(result.itemsEnqueued).toBe(2);
			expect(result.itemsSkipped).toBe(0);

			// Verify queue items were created
			const queueCount = await countQueueItems(testRadarrConnectorId);
			expect(queueCount).toBe(2);
		});

		it('should update registry state to queued', async () => {
			const seriesId = await insertTestSeries(testSonarrConnectorId, 1, 'Test Series');
			const seasonId = await insertTestSeason(seriesId, 1);
			const episodeId = await insertTestEpisode(testSonarrConnectorId, seasonId, 101, 1, 1);

			const registryId = await createPendingEpisodeRegistry(testSonarrConnectorId, episodeId);

			await enqueuePendingItems(testSonarrConnectorId);

			const registry = await getRegistryById(registryId);
			expect(registry?.state).toBe('queued');
		});

		it('should calculate and store priority scores', async () => {
			const seriesId = await insertTestSeries(testSonarrConnectorId, 1, 'Test Series');
			const seasonId = await insertTestSeason(seriesId, 1);
			const episodeId = await insertTestEpisode(testSonarrConnectorId, seasonId, 101, 1, 1);

			const _registryId = await createPendingEpisodeRegistry(testSonarrConnectorId, episodeId);

			await enqueuePendingItems(testSonarrConnectorId);

			// Check that priority was calculated
			const queueItems = await db
				.select()
				.from(requestQueue)
				.where(eq(requestQueue.connectorId, testSonarrConnectorId));

			expect(queueItems.length).toBe(1);
			expect(queueItems[0]!.priority).toBeGreaterThan(0);
		});

		it('should return error for non-existent connector', async () => {
			const result = await enqueuePendingItems(999999);

			expect(result.success).toBe(false);
			expect(result.error).toContain('not found');
		});
	});

	describe('Idempotency', () => {
		it('should be idempotent - running twice creates no duplicates', async () => {
			const seriesId = await insertTestSeries(testSonarrConnectorId, 1, 'Test Series');
			const seasonId = await insertTestSeason(seriesId, 1);
			const episodeId = await insertTestEpisode(testSonarrConnectorId, seasonId, 101, 1, 1);

			await createPendingEpisodeRegistry(testSonarrConnectorId, episodeId);

			// First enqueue
			const result1 = await enqueuePendingItems(testSonarrConnectorId);
			expect(result1.itemsEnqueued).toBe(1);

			// Second enqueue - registry is now 'queued', not 'pending'
			const result2 = await enqueuePendingItems(testSonarrConnectorId);
			expect(result2.itemsEnqueued).toBe(0);

			// Verify only 1 queue item exists
			const queueCount = await countQueueItems(testSonarrConnectorId);
			expect(queueCount).toBe(1);
		});
	});
});

// ============================================================================
// dequeue Tests
// ============================================================================

describe('Queue Service - dequeuePriorityItems', () => {
	describe('Basic Functionality', () => {
		it('should return empty result when queue is empty', async () => {
			const result = await dequeuePriorityItems(testSonarrConnectorId);

			expect(result.success).toBe(true);
			expect(result.items).toHaveLength(0);
		});

		it('should dequeue items in priority order (highest first)', async () => {
			const seriesId = await insertTestSeries(testSonarrConnectorId, 1, 'Test Series');
			const seasonId = await insertTestSeason(seriesId, 1);

			// Create episodes with different air dates (newer = higher priority)
			const oldDate = new Date('2020-01-01');
			const newDate = new Date('2024-01-01');

			const oldEpisodeId = await insertTestEpisode(
				testSonarrConnectorId,
				seasonId,
				101,
				1,
				1,
				oldDate
			);
			const newEpisodeId = await insertTestEpisode(
				testSonarrConnectorId,
				seasonId,
				102,
				1,
				2,
				newDate
			);

			await createPendingEpisodeRegistry(testSonarrConnectorId, oldEpisodeId);
			await createPendingEpisodeRegistry(testSonarrConnectorId, newEpisodeId);

			await enqueuePendingItems(testSonarrConnectorId);

			// Dequeue one item
			const result = await dequeuePriorityItems(testSonarrConnectorId, { limit: 1 });

			expect(result.success).toBe(true);
			expect(result.items).toHaveLength(1);
			// The newer episode should have higher priority and be dequeued first
			expect(result.items[0]!.contentId).toBe(newEpisodeId);
		});

		it('should respect the limit option', async () => {
			const seriesId = await insertTestSeries(testSonarrConnectorId, 1, 'Test Series');
			const seasonId = await insertTestSeason(seriesId, 1);

			// Create 5 episodes
			for (let i = 1; i <= 5; i++) {
				const episodeId = await insertTestEpisode(testSonarrConnectorId, seasonId, 100 + i, 1, i);
				await createPendingEpisodeRegistry(testSonarrConnectorId, episodeId);
			}

			await enqueuePendingItems(testSonarrConnectorId);

			// Dequeue only 2 items
			const result = await dequeuePriorityItems(testSonarrConnectorId, { limit: 2 });

			expect(result.success).toBe(true);
			expect(result.items).toHaveLength(2);

			// Verify 3 items remain in queue
			const queueCount = await countQueueItems(testSonarrConnectorId);
			expect(queueCount).toBe(3);
		});

		it('should keep registry state as queued after dequeue', async () => {
			const seriesId = await insertTestSeries(testSonarrConnectorId, 1, 'Test Series');
			const seasonId = await insertTestSeason(seriesId, 1);
			const episodeId = await insertTestEpisode(testSonarrConnectorId, seasonId, 101, 1, 1);

			const registryId = await createPendingEpisodeRegistry(testSonarrConnectorId, episodeId);

			await enqueuePendingItems(testSonarrConnectorId);
			await dequeuePriorityItems(testSonarrConnectorId);

			// State remains 'queued' after dequeue - setSearching() is called separately before dispatch
			const registry = await getRegistryById(registryId);
			expect(registry?.state).toBe('queued');
		});

		it('should remove items from queue after dequeue', async () => {
			const seriesId = await insertTestSeries(testSonarrConnectorId, 1, 'Test Series');
			const seasonId = await insertTestSeason(seriesId, 1);
			const episodeId = await insertTestEpisode(testSonarrConnectorId, seasonId, 101, 1, 1);

			await createPendingEpisodeRegistry(testSonarrConnectorId, episodeId);

			await enqueuePendingItems(testSonarrConnectorId);

			// Verify item is in queue
			let queueCount = await countQueueItems(testSonarrConnectorId);
			expect(queueCount).toBe(1);

			await dequeuePriorityItems(testSonarrConnectorId);

			// Verify item was removed
			queueCount = await countQueueItems(testSonarrConnectorId);
			expect(queueCount).toBe(0);
		});

		it('should return error for non-existent connector', async () => {
			const result = await dequeuePriorityItems(999999);

			expect(result.success).toBe(false);
			expect(result.error).toContain('not found');
		});
	});

	describe('Pause Behavior', () => {
		it('should return empty result when queue is paused', async () => {
			const seriesId = await insertTestSeries(testSonarrConnectorId, 1, 'Test Series');
			const seasonId = await insertTestSeason(seriesId, 1);
			const episodeId = await insertTestEpisode(testSonarrConnectorId, seasonId, 101, 1, 1);

			await createPendingEpisodeRegistry(testSonarrConnectorId, episodeId);
			await enqueuePendingItems(testSonarrConnectorId);

			// Pause the queue via direct DB update
			await db
				.update(connectors)
				.set({ queuePaused: true, updatedAt: new Date() })
				.where(eq(connectors.id, testSonarrConnectorId));

			// Try to dequeue
			const result = await dequeuePriorityItems(testSonarrConnectorId);

			expect(result.success).toBe(true);
			expect(result.items).toHaveLength(0);

			// Verify item still in queue
			const queueCount = await countQueueItems(testSonarrConnectorId);
			expect(queueCount).toBe(1);
		});
	});
});

// ============================================================================
// Property 6: Queue Processing Order Tests
// ============================================================================

describe('Property 6: Queue Processing Order', () => {
	it('should dequeue items in strictly descending priority order', async () => {
		const seriesId = await insertTestSeries(testSonarrConnectorId, 1, 'Test Series');
		const seasonId = await insertTestSeason(seriesId, 1);

		// Create episodes with different ages to get different priorities
		const dates = [
			new Date('2024-01-01'), // Newest - highest priority
			new Date('2022-01-01'),
			new Date('2020-01-01'),
			new Date('2018-01-01'),
			new Date('2016-01-01') // Oldest - lowest priority
		];

		for (let i = 0; i < dates.length; i++) {
			const episodeId = await insertTestEpisode(
				testSonarrConnectorId,
				seasonId,
				100 + i,
				1,
				i + 1,
				dates[i]
			);
			await createPendingEpisodeRegistry(testSonarrConnectorId, episodeId);
		}

		await enqueuePendingItems(testSonarrConnectorId);

		// Dequeue all items one by one and verify order
		const dequeuedPriorities: number[] = [];

		for (let i = 0; i < dates.length; i++) {
			const result = await dequeuePriorityItems(testSonarrConnectorId, { limit: 1 });
			if (result.items.length > 0) {
				dequeuedPriorities.push(result.items[0]!.priority);
			}
		}

		// Verify priorities are in descending order
		for (let i = 0; i < dequeuedPriorities.length - 1; i++) {
			expect(dequeuedPriorities[i]).toBeGreaterThanOrEqual(dequeuedPriorities[i + 1]!);
		}
	});
});
