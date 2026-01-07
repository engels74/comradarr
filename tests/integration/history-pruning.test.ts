/**
 * Integration tests for history pruning service.
 *
 * Validates requirement:
 * - 13.3: WHEN search history exceeds the retention period THEN the System SHALL
 *         prune old records while preserving aggregated statistics
 *
 * NOTE: These tests require a running PostgreSQL database with DATABASE_URL set.
 * Run with: bun test tests/integration/history-pruning.test.ts
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../src/lib/server/db';
import { connectors, searchHistory } from '../../src/lib/server/db/schema';
import { pruneSearchHistory } from '../../src/lib/server/services/maintenance';

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
			name: 'Test Connector History Pruning',
			url: 'http://test-sonarr.local:8989',
			apiKeyEncrypted: 'testencryptedkey',
			enabled: true
		})
		.returning({ id: connectors.id });

	return result[0]!.id;
}

/**
 * Insert a search history entry with a specific date
 */
async function insertSearchHistoryEntry(
	connectorId: number,
	daysAgo: number,
	outcome: string = 'success'
): Promise<number> {
	const createdAt = new Date();
	createdAt.setDate(createdAt.getDate() - daysAgo);

	const result = await db
		.insert(searchHistory)
		.values({
			connectorId,
			contentType: 'episode',
			contentId: Math.floor(Math.random() * 100000),
			outcome,
			createdAt
		})
		.returning({ id: searchHistory.id });

	return result[0]!.id;
}

/**
 * Count search history entries for a connector
 */
async function countSearchHistory(connectorId: number): Promise<number> {
	const result = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(searchHistory)
		.where(eq(searchHistory.connectorId, connectorId));

	return result[0]?.count ?? 0;
}

/**
 * Clean up all test data for a connector
 */
async function cleanupConnectorData(connectorId: number): Promise<void> {
	await db.delete(searchHistory).where(eq(searchHistory.connectorId, connectorId));
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
// Tests
// ============================================================================

describe('History Pruning Service', () => {
	describe('pruneSearchHistory - Basic Functionality', () => {
		it('should return success with zero deletions when no history exists', async () => {
			const result = await pruneSearchHistory(30);

			expect(result.success).toBe(true);
			expect(result.searchHistoryDeleted).toBe(0);
		});

		it('should return success with zero deletions when all entries are within retention', async () => {
			// Insert entries within retention period
			await insertSearchHistoryEntry(testConnectorId, 1); // 1 day ago
			await insertSearchHistoryEntry(testConnectorId, 5); // 5 days ago
			await insertSearchHistoryEntry(testConnectorId, 10); // 10 days ago

			// Verify entries exist
			const countBefore = await countSearchHistory(testConnectorId);
			expect(countBefore).toBe(3);

			// Run pruning with 30-day retention
			const result = await pruneSearchHistory(30);

			expect(result.success).toBe(true);
			expect(result.searchHistoryDeleted).toBe(0);

			// Verify all entries still exist
			const countAfter = await countSearchHistory(testConnectorId);
			expect(countAfter).toBe(3);
		});

		it('should delete entries older than retention period', async () => {
			// Insert entries: some within retention, some outside
			await insertSearchHistoryEntry(testConnectorId, 5); // 5 days ago - keep
			await insertSearchHistoryEntry(testConnectorId, 10); // 10 days ago - keep
			await insertSearchHistoryEntry(testConnectorId, 35); // 35 days ago - delete
			await insertSearchHistoryEntry(testConnectorId, 60); // 60 days ago - delete
			await insertSearchHistoryEntry(testConnectorId, 100); // 100 days ago - delete

			// Verify all entries exist
			const countBefore = await countSearchHistory(testConnectorId);
			expect(countBefore).toBe(5);

			// Run pruning with 30-day retention
			const result = await pruneSearchHistory(30);

			expect(result.success).toBe(true);
			expect(result.searchHistoryDeleted).toBe(3);

			// Verify only entries within retention remain
			const countAfter = await countSearchHistory(testConnectorId);
			expect(countAfter).toBe(2);
		});

		it('should handle custom retention periods', async () => {
			// Insert entries at specific ages
			await insertSearchHistoryEntry(testConnectorId, 3); // 3 days ago
			await insertSearchHistoryEntry(testConnectorId, 8); // 8 days ago
			await insertSearchHistoryEntry(testConnectorId, 15); // 15 days ago

			// Run pruning with 7-day retention
			const result = await pruneSearchHistory(7);

			expect(result.success).toBe(true);
			expect(result.searchHistoryDeleted).toBe(2); // 8 and 15 days ago deleted

			// Verify only 1 entry remains
			const countAfter = await countSearchHistory(testConnectorId);
			expect(countAfter).toBe(1);
		});
	});

	describe('pruneSearchHistory - Edge Cases', () => {
		it('should handle boundary case - entry just outside retention cutoff', async () => {
			// Insert entry at 31 days ago (just outside 30-day retention)
			await insertSearchHistoryEntry(testConnectorId, 31);
			// Insert entry at 29 days ago (just inside 30-day retention)
			await insertSearchHistoryEntry(testConnectorId, 29);

			const countBefore = await countSearchHistory(testConnectorId);
			expect(countBefore).toBe(2);

			// With 30-day retention, the 31-day entry should be deleted
			// but the 29-day entry should be kept
			const result = await pruneSearchHistory(30);

			expect(result.success).toBe(true);
			expect(result.searchHistoryDeleted).toBe(1);

			const countAfter = await countSearchHistory(testConnectorId);
			expect(countAfter).toBe(1);
		});

		it('should handle large batch of entries', async () => {
			// Insert 50 entries older than retention
			const insertPromises = [];
			for (let i = 0; i < 50; i++) {
				insertPromises.push(insertSearchHistoryEntry(testConnectorId, 100 + i));
			}
			await Promise.all(insertPromises);

			// Insert 10 entries within retention
			for (let i = 0; i < 10; i++) {
				await insertSearchHistoryEntry(testConnectorId, 5 + i);
			}

			// Verify all entries exist
			const countBefore = await countSearchHistory(testConnectorId);
			expect(countBefore).toBe(60);

			// Run pruning
			const result = await pruneSearchHistory(30);

			expect(result.success).toBe(true);
			expect(result.searchHistoryDeleted).toBe(50);

			// Verify only entries within retention remain
			const countAfter = await countSearchHistory(testConnectorId);
			expect(countAfter).toBe(10);
		});
	});

	describe('pruneSearchHistory - Idempotency', () => {
		it('should be idempotent - running twice produces same result', async () => {
			// Insert entries outside retention
			await insertSearchHistoryEntry(testConnectorId, 50);
			await insertSearchHistoryEntry(testConnectorId, 60);

			// First run
			const result1 = await pruneSearchHistory(30);
			expect(result1.success).toBe(true);
			expect(result1.searchHistoryDeleted).toBe(2);

			// Second run - should find nothing to delete
			const result2 = await pruneSearchHistory(30);
			expect(result2.success).toBe(true);
			expect(result2.searchHistoryDeleted).toBe(0);
		});
	});

	describe('pruneSearchHistory - Timing Metrics', () => {
		it('should return durationMs in result', async () => {
			const result = await pruneSearchHistory(30);

			expect(result.success).toBe(true);
			expect(typeof result.durationMs).toBe('number');
			expect(result.durationMs).toBeGreaterThanOrEqual(0);
		});

		it('should return durationMs even when entries are deleted', async () => {
			// Insert entries to delete
			await insertSearchHistoryEntry(testConnectorId, 100);
			await insertSearchHistoryEntry(testConnectorId, 200);

			const result = await pruneSearchHistory(30);

			expect(result.success).toBe(true);
			expect(typeof result.durationMs).toBe('number');
			expect(result.durationMs).toBeGreaterThanOrEqual(0);
		});
	});

	describe('pruneSearchHistory - Different Outcomes', () => {
		it('should prune entries regardless of outcome type', async () => {
			// Insert entries with different outcomes, all outside retention
			await insertSearchHistoryEntry(testConnectorId, 100, 'success');
			await insertSearchHistoryEntry(testConnectorId, 100, 'no_results');
			await insertSearchHistoryEntry(testConnectorId, 100, 'error');
			await insertSearchHistoryEntry(testConnectorId, 100, 'timeout');

			// Verify all entries exist
			const countBefore = await countSearchHistory(testConnectorId);
			expect(countBefore).toBe(4);

			// Run pruning
			const result = await pruneSearchHistory(30);

			expect(result.success).toBe(true);
			expect(result.searchHistoryDeleted).toBe(4);

			// Verify all entries are deleted
			const countAfter = await countSearchHistory(testConnectorId);
			expect(countAfter).toBe(0);
		});
	});
});
