/**
 * Integration tests for search state transitions.
 *
 * Validates requirements:
 * - 5.5: Transition to cooldown on failure with exponential backoff
 * - 5.6: Transition to exhausted at max attempts
 *
 * Property 8: Exhaustion at Max Attempts
 * - State should transition to exhausted exactly at max attempts
 *
 * NOTE: These tests require a running PostgreSQL database with DATABASE_URL set.
 * Run with: bun test tests/integration/state-transitions.test.ts
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
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
import { STATE_TRANSITION_CONFIG } from '../../src/lib/server/services/queue/config';
import {
	getSearchState,
	markSearchExhausted,
	markSearchFailed,
	reenqueueEligibleCooldownItems
} from '../../src/lib/server/services/queue/state-transitions';

// Store original SECRET_KEY to restore after tests
const originalSecretKey = process.env.SECRET_KEY;

// Valid test SECRET_KEY (64 hex chars = 32 bytes = 256 bits)
const TEST_SECRET_KEY = 'a'.repeat(64);

// Test connector ID
let testConnectorId: number;

/**
 * Create a test connector in the database
 */
async function createTestConnector(): Promise<number> {
	const result = await db
		.insert(connectors)
		.values({
			type: 'sonarr',
			name: 'Test Connector State Transitions',
			url: 'http://test-state-transitions.local:8989',
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

// Counter for generating unique IDs within a test run
let testIdCounter = 0;

/**
 * Insert test series, season, and episode with unique IDs
 */
async function createTestEpisode(connectorId: number): Promise<number> {
	// Generate unique arrIds to avoid constraint violations
	const uniqueId = ++testIdCounter;
	const seriesArrId = 1000 + uniqueId;
	const episodeArrId = 10000 + uniqueId;

	const seriesResult = await db
		.insert(series)
		.values({
			connectorId,
			arrId: seriesArrId,
			title: `Test Series ${uniqueId}`,
			status: 'continuing',
			monitored: true
		})
		.returning({ id: series.id });

	const seriesId = seriesResult[0]!.id;

	const seasonResult = await db
		.insert(seasons)
		.values({
			seriesId,
			seasonNumber: 1,
			monitored: true,
			totalEpisodes: 10,
			downloadedEpisodes: 5
		})
		.returning({ id: seasons.id });

	const seasonId = seasonResult[0]!.id;

	const episodeResult = await db
		.insert(episodes)
		.values({
			connectorId,
			seasonId,
			arrId: episodeArrId,
			seasonNumber: 1,
			episodeNumber: uniqueId,
			title: `Test Episode ${uniqueId}`,
			airDate: new Date(),
			monitored: true,
			hasFile: false,
			qualityCutoffNotMet: false
		})
		.returning({ id: episodes.id });

	return episodeResult[0]!.id;
}

/**
 * Create a search registry entry in 'searching' state
 */
async function createSearchingRegistry(
	connectorId: number,
	episodeId: number,
	attemptCount: number = 0
): Promise<number> {
	const result = await db
		.insert(searchRegistry)
		.values({
			connectorId,
			contentType: 'episode',
			contentId: episodeId,
			searchType: 'gap',
			state: 'searching',
			attemptCount,
			priority: 0,
			lastSearched: new Date()
		})
		.returning({ id: searchRegistry.id });

	return result[0]!.id;
}

/**
 * Create a search registry entry in 'cooldown' state
 */
async function createCooldownRegistry(
	connectorId: number,
	episodeId: number,
	attemptCount: number,
	nextEligible: Date
): Promise<number> {
	const result = await db
		.insert(searchRegistry)
		.values({
			connectorId,
			contentType: 'episode',
			contentId: episodeId,
			searchType: 'gap',
			state: 'cooldown',
			attemptCount,
			priority: 0,
			nextEligible
		})
		.returning({ id: searchRegistry.id });

	return result[0]!.id;
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

	// Create test connector
	testConnectorId = await createTestConnector();
});

afterAll(async () => {
	// Clean up test data
	await cleanupConnectorData(testConnectorId);

	// Delete test connector
	await db.delete(connectors).where(eq(connectors.id, testConnectorId));

	// Restore original SECRET_KEY
	if (originalSecretKey !== undefined) {
		process.env.SECRET_KEY = originalSecretKey;
	} else {
		delete process.env.SECRET_KEY;
	}
});

beforeEach(async () => {
	// Clean up data before each test for isolation
	await cleanupConnectorData(testConnectorId);
});

// ============================================================================
// markSearchFailed Tests
// ============================================================================

describe('State Transitions - markSearchFailed', () => {
	describe('Basic Functionality', () => {
		it('should transition from searching to cooldown on first failure', async () => {
			const episodeId = await createTestEpisode(testConnectorId);
			const registryId = await createSearchingRegistry(testConnectorId, episodeId, 0);

			const result = await markSearchFailed({
				searchRegistryId: registryId,
				failureCategory: 'no_results'
			});

			expect(result.success).toBe(true);
			expect(result.previousState).toBe('searching');
			expect(result.newState).toBe('cooldown');
			expect(result.attemptCount).toBe(1);
			expect(result.nextEligible).toBeDefined();
			expect(result.nextEligible!.getTime()).toBeGreaterThan(Date.now());
		});

		it('should increment attempt count on failure', async () => {
			const episodeId = await createTestEpisode(testConnectorId);
			const registryId = await createSearchingRegistry(testConnectorId, episodeId, 2);

			const result = await markSearchFailed({
				searchRegistryId: registryId,
				failureCategory: 'network_error'
			});

			expect(result.attemptCount).toBe(3);
		});

		it('should store failure category', async () => {
			const episodeId = await createTestEpisode(testConnectorId);
			const registryId = await createSearchingRegistry(testConnectorId, episodeId, 0);

			await markSearchFailed({
				searchRegistryId: registryId,
				failureCategory: 'rate_limited'
			});

			const registry = await getRegistryById(registryId);
			expect(registry?.failureCategory).toBe('rate_limited');
		});

		it('should update nextEligible timestamp', async () => {
			const episodeId = await createTestEpisode(testConnectorId);
			const registryId = await createSearchingRegistry(testConnectorId, episodeId, 0);

			const beforeTime = Date.now();
			const result = await markSearchFailed({
				searchRegistryId: registryId,
				failureCategory: 'no_results'
			});
			const afterTime = Date.now();

			// nextEligible should be in the future
			expect(result.nextEligible!.getTime()).toBeGreaterThan(afterTime);

			// nextEligible should be at least base delay from now (minus jitter)
			const minExpectedDelay = STATE_TRANSITION_CONFIG.COOLDOWN_BASE_DELAY * 0.75;
			expect(result.nextEligible!.getTime() - beforeTime).toBeGreaterThanOrEqual(minExpectedDelay);
		});
	});

	describe('Exhaustion Transition (Requirement 5.6)', () => {
		it('should transition to exhausted at exactly max attempts', async () => {
			const episodeId = await createTestEpisode(testConnectorId);
			// attemptCount = MAX_ATTEMPTS - 1, so after failure it becomes MAX_ATTEMPTS
			const registryId = await createSearchingRegistry(
				testConnectorId,
				episodeId,
				STATE_TRANSITION_CONFIG.MAX_ATTEMPTS - 1
			);

			const result = await markSearchFailed({
				searchRegistryId: registryId,
				failureCategory: 'no_results'
			});

			expect(result.success).toBe(true);
			expect(result.newState).toBe('exhausted');
			expect(result.attemptCount).toBe(STATE_TRANSITION_CONFIG.MAX_ATTEMPTS);
			expect(result.nextEligible).toBeUndefined();
		});

		it('should not transition to exhausted before max attempts', async () => {
			const episodeId = await createTestEpisode(testConnectorId);
			// attemptCount = MAX_ATTEMPTS - 2, so after failure it's still below max
			const registryId = await createSearchingRegistry(
				testConnectorId,
				episodeId,
				STATE_TRANSITION_CONFIG.MAX_ATTEMPTS - 2
			);

			const result = await markSearchFailed({
				searchRegistryId: registryId,
				failureCategory: 'no_results'
			});

			expect(result.newState).toBe('cooldown');
			expect(result.attemptCount).toBe(STATE_TRANSITION_CONFIG.MAX_ATTEMPTS - 1);
		});

		it('should set nextEligible to null for exhausted items', async () => {
			const episodeId = await createTestEpisode(testConnectorId);
			const registryId = await createSearchingRegistry(
				testConnectorId,
				episodeId,
				STATE_TRANSITION_CONFIG.MAX_ATTEMPTS - 1
			);

			await markSearchFailed({
				searchRegistryId: registryId,
				failureCategory: 'no_results'
			});

			const registry = await getRegistryById(registryId);
			expect(registry?.state).toBe('exhausted');
			expect(registry?.nextEligible).toBeNull();
		});
	});

	describe('Error Handling', () => {
		it('should return error for non-existent registry', async () => {
			const result = await markSearchFailed({
				searchRegistryId: 999999,
				failureCategory: 'no_results'
			});

			expect(result.success).toBe(false);
			expect(result.error).toContain('not found');
		});

		it('should return error when state is not searching', async () => {
			const episodeId = await createTestEpisode(testConnectorId);

			// Create a registry in 'pending' state instead of 'searching'
			const result = await db
				.insert(searchRegistry)
				.values({
					connectorId: testConnectorId,
					contentType: 'episode',
					contentId: episodeId,
					searchType: 'gap',
					state: 'pending',
					attemptCount: 0,
					priority: 0
				})
				.returning({ id: searchRegistry.id });

			const registryId = result[0]!.id;

			const failResult = await markSearchFailed({
				searchRegistryId: registryId,
				failureCategory: 'no_results'
			});

			expect(failResult.success).toBe(false);
			expect(failResult.error).toContain('pending');
			expect(failResult.error).toContain("expected 'searching'");
		});
	});
});

// ============================================================================
// markSearchExhausted Tests
// ============================================================================

describe('State Transitions - markSearchExhausted', () => {
	it('should transition from searching to exhausted', async () => {
		const episodeId = await createTestEpisode(testConnectorId);
		const registryId = await createSearchingRegistry(testConnectorId, episodeId, 2);

		const result = await markSearchExhausted(registryId);

		expect(result.success).toBe(true);
		expect(result.previousState).toBe('searching');
		expect(result.newState).toBe('exhausted');
	});

	it('should transition from cooldown to exhausted', async () => {
		const episodeId = await createTestEpisode(testConnectorId);
		const registryId = await createCooldownRegistry(
			testConnectorId,
			episodeId,
			2,
			new Date(Date.now() + 3600000)
		);

		const result = await markSearchExhausted(registryId);

		expect(result.success).toBe(true);
		expect(result.previousState).toBe('cooldown');
		expect(result.newState).toBe('exhausted');
	});

	it('should clear nextEligible when exhausted', async () => {
		const episodeId = await createTestEpisode(testConnectorId);
		const registryId = await createCooldownRegistry(
			testConnectorId,
			episodeId,
			2,
			new Date(Date.now() + 3600000)
		);

		await markSearchExhausted(registryId);

		const registry = await getRegistryById(registryId);
		expect(registry?.nextEligible).toBeNull();
	});

	it('should return error for invalid source state', async () => {
		const episodeId = await createTestEpisode(testConnectorId);

		// Create a registry in 'pending' state
		const insertResult = await db
			.insert(searchRegistry)
			.values({
				connectorId: testConnectorId,
				contentType: 'episode',
				contentId: episodeId,
				searchType: 'gap',
				state: 'pending',
				attemptCount: 0,
				priority: 0
			})
			.returning({ id: searchRegistry.id });

		const registryId = insertResult[0]!.id;

		const result = await markSearchExhausted(registryId);

		expect(result.success).toBe(false);
		expect(result.error).toContain('pending');
	});

	it('should return error for non-existent registry', async () => {
		const result = await markSearchExhausted(999999);

		expect(result.success).toBe(false);
		expect(result.error).toContain('not found');
	});
});

// ============================================================================
// reenqueueEligibleCooldownItems Tests
// ============================================================================

describe('State Transitions - reenqueueEligibleCooldownItems', () => {
	it('should transition eligible cooldown items to pending', async () => {
		const episodeId = await createTestEpisode(testConnectorId);
		// Create a cooldown item that is already eligible (past nextEligible)
		const registryId = await createCooldownRegistry(
			testConnectorId,
			episodeId,
			1,
			new Date(Date.now() - 1000) // 1 second ago
		);

		const result = await reenqueueEligibleCooldownItems(testConnectorId);

		expect(result.success).toBe(true);
		expect(result.itemsReenqueued).toBe(1);

		const registry = await getRegistryById(registryId);
		expect(registry?.state).toBe('pending');
		expect(registry?.nextEligible).toBeNull();
	});

	it('should not transition items still in cooldown', async () => {
		const episodeId = await createTestEpisode(testConnectorId);
		// Create a cooldown item that is not yet eligible
		const registryId = await createCooldownRegistry(
			testConnectorId,
			episodeId,
			1,
			new Date(Date.now() + 3600000) // 1 hour from now
		);

		const result = await reenqueueEligibleCooldownItems(testConnectorId);

		expect(result.success).toBe(true);
		expect(result.itemsReenqueued).toBe(0);
		expect(result.itemsSkipped).toBe(1);

		const registry = await getRegistryById(registryId);
		expect(registry?.state).toBe('cooldown');
	});

	it('should handle mix of eligible and not-yet-eligible items', async () => {
		const episodeId1 = await createTestEpisode(testConnectorId);
		const episodeId2 = await createTestEpisode(testConnectorId);

		// One eligible, one not
		await createCooldownRegistry(
			testConnectorId,
			episodeId1,
			1,
			new Date(Date.now() - 1000) // Eligible
		);
		await createCooldownRegistry(
			testConnectorId,
			episodeId2,
			1,
			new Date(Date.now() + 3600000) // Not eligible
		);

		const result = await reenqueueEligibleCooldownItems(testConnectorId);

		expect(result.success).toBe(true);
		expect(result.itemsReenqueued).toBe(1);
		expect(result.itemsSkipped).toBe(1);
	});

	it('should process all connectors when connectorId is not specified', async () => {
		const episodeId = await createTestEpisode(testConnectorId);
		await createCooldownRegistry(
			testConnectorId,
			episodeId,
			1,
			new Date(Date.now() - 1000) // Eligible
		);

		const result = await reenqueueEligibleCooldownItems();

		expect(result.success).toBe(true);
		expect(result.itemsReenqueued).toBeGreaterThanOrEqual(1);
		expect(result.connectorId).toBeUndefined();
	});

	it('should return zero when no items in cooldown', async () => {
		const result = await reenqueueEligibleCooldownItems(testConnectorId);

		expect(result.success).toBe(true);
		expect(result.itemsReenqueued).toBe(0);
		expect(result.itemsSkipped).toBe(0);
	});
});

// ============================================================================
// getSearchState Tests
// ============================================================================

describe('State Transitions - getSearchState', () => {
	it('should return current state of a registry entry', async () => {
		const episodeId = await createTestEpisode(testConnectorId);
		const registryId = await createSearchingRegistry(testConnectorId, episodeId, 0);

		const state = await getSearchState(registryId);

		expect(state).toBe('searching');
	});

	it('should return null for non-existent registry', async () => {
		const state = await getSearchState(999999);

		expect(state).toBeNull();
	});

	it('should reflect state changes', async () => {
		const episodeId = await createTestEpisode(testConnectorId);
		const registryId = await createSearchingRegistry(testConnectorId, episodeId, 0);

		let state = await getSearchState(registryId);
		expect(state).toBe('searching');

		await markSearchFailed({
			searchRegistryId: registryId,
			failureCategory: 'no_results'
		});

		state = await getSearchState(registryId);
		expect(state).toBe('cooldown');
	});
});

// ============================================================================
// Full Lifecycle Tests
// ============================================================================

describe('State Transitions - Full Lifecycle', () => {
	it('should complete full cycle: searching → cooldown → pending', async () => {
		const episodeId = await createTestEpisode(testConnectorId);
		const registryId = await createSearchingRegistry(testConnectorId, episodeId, 0);

		// Step 1: Mark as failed → cooldown
		await markSearchFailed({
			searchRegistryId: registryId,
			failureCategory: 'no_results'
		});

		let state = await getSearchState(registryId);
		expect(state).toBe('cooldown');

		// Step 2: Manually update nextEligible to past for testing
		await db
			.update(searchRegistry)
			.set({ nextEligible: new Date(Date.now() - 1000) })
			.where(eq(searchRegistry.id, registryId));

		// Step 3: Re-enqueue eligible items → pending
		await reenqueueEligibleCooldownItems(testConnectorId);

		state = await getSearchState(registryId);
		expect(state).toBe('pending');
	});

	it('should reach exhausted after max attempts', async () => {
		const episodeId = await createTestEpisode(testConnectorId);
		const registryId = await createSearchingRegistry(testConnectorId, episodeId, 0);

		// Simulate multiple failures up to exhaustion
		for (let i = 0; i < STATE_TRANSITION_CONFIG.MAX_ATTEMPTS; i++) {
			const registry = await getRegistryById(registryId);

			// If in cooldown, move back to searching for next failure
			if (registry?.state === 'cooldown') {
				await db
					.update(searchRegistry)
					.set({ state: 'searching' })
					.where(eq(searchRegistry.id, registryId));
			}

			await markSearchFailed({
				searchRegistryId: registryId,
				failureCategory: 'no_results'
			});
		}

		const finalState = await getSearchState(registryId);
		expect(finalState).toBe('exhausted');

		const registry = await getRegistryById(registryId);
		expect(registry?.attemptCount).toBe(STATE_TRANSITION_CONFIG.MAX_ATTEMPTS);
	});
});
