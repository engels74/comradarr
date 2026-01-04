/**
 * Integration tests for sync failure handling.
 *
 * Tests the full flow of:
 * - Consecutive failure tracking in sync_state
 * - Health status updates in connectors table
 * - Integration between sync operations and health status
 *
 * NOTE: These tests require a running PostgreSQL database with DATABASE_URL set.
 * Run with: bun test tests/integration/sync-failure-handling.test.ts
 *

 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { db } from '../../src/lib/server/db';
import {
	type CreateConnectorInput,
	createConnector,
	deleteConnector,
	getSyncState
} from '../../src/lib/server/db/queries/connectors';
import { connectors, syncState } from '../../src/lib/server/db/schema';
import { SYNC_CONFIG } from '../../src/lib/server/services/sync/config';
import {
	determineHealthStatus,
	updateHealthFromSyncResult
} from '../../src/lib/server/services/sync/health';

// Store original SECRET_KEY to restore after tests
const originalSecretKey = process.env.SECRET_KEY;

// Valid test SECRET_KEY (64 hex chars = 32 bytes = 256 bits)
const TEST_SECRET_KEY = 'a'.repeat(64);

// Track created connector IDs for cleanup
const createdConnectorIds: number[] = [];

beforeAll(() => {
	process.env.SECRET_KEY = TEST_SECRET_KEY;
});

afterAll(() => {
	if (originalSecretKey !== undefined) {
		process.env.SECRET_KEY = originalSecretKey;
	} else {
		delete process.env.SECRET_KEY;
	}
});

afterEach(async () => {
	// Cleanup created connectors (will cascade to sync_state)
	for (const id of createdConnectorIds) {
		try {
			await deleteConnector(id);
		} catch {
			// Ignore errors during cleanup
		}
	}
	createdConnectorIds.length = 0;
});

/**
 * Creates a test connector and tracks it for cleanup.
 */
async function createTestConnector(
	name: string = 'Test Connector'
): Promise<{ id: number; type: string }> {
	const input: CreateConnectorInput = {
		type: 'sonarr',
		name,
		url: 'http://localhost:8989',
		apiKey: 'a'.repeat(32)
	};

	const connector = await createConnector(input);
	createdConnectorIds.push(connector.id);
	return { id: connector.id, type: connector.type };
}

describe('updateHealthFromSyncResult', () => {
	describe('success scenarios', () => {
		it('should update health to healthy on sync success', async () => {
			const { id: connectorId } = await createTestConnector();

			const status = await updateHealthFromSyncResult(connectorId, true, 0);

			expect(status).toBe('healthy');

			// Verify database was updated
			const [connector] = await db
				.select({ healthStatus: connectors.healthStatus })
				.from(connectors)
				.where(eq(connectors.id, connectorId));

			expect(connector?.healthStatus).toBe('healthy');
		});

		it('should set healthy even after previous failures', async () => {
			const { id: connectorId } = await createTestConnector();

			// First set to unhealthy
			await updateHealthFromSyncResult(connectorId, false, SYNC_CONFIG.UNHEALTHY_THRESHOLD);

			// Then succeed
			const status = await updateHealthFromSyncResult(connectorId, true, 0);

			expect(status).toBe('healthy');
		});
	});

	describe('failure scenarios', () => {
		it('should update health to degraded on first failure', async () => {
			const { id: connectorId } = await createTestConnector();

			const status = await updateHealthFromSyncResult(connectorId, false, 1);

			expect(status).toBe('degraded');

			// Verify database was updated
			const [connector] = await db
				.select({ healthStatus: connectors.healthStatus })
				.from(connectors)
				.where(eq(connectors.id, connectorId));

			expect(connector?.healthStatus).toBe('degraded');
		});

		it('should update health to unhealthy at threshold', async () => {
			const { id: connectorId } = await createTestConnector();

			const status = await updateHealthFromSyncResult(
				connectorId,
				false,
				SYNC_CONFIG.UNHEALTHY_THRESHOLD
			);

			expect(status).toBe('unhealthy');

			// Verify database was updated
			const [connector] = await db
				.select({ healthStatus: connectors.healthStatus })
				.from(connectors)
				.where(eq(connectors.id, connectorId));

			expect(connector?.healthStatus).toBe('unhealthy');
		});
	});
});

describe('Health status lifecycle', () => {
	it('should track health through failure and recovery cycle', async () => {
		const { id: connectorId } = await createTestConnector('Lifecycle Test');

		// Initial state - healthy
		await updateHealthFromSyncResult(connectorId, true, 0);
		let [connector] = await db
			.select({ healthStatus: connectors.healthStatus })
			.from(connectors)
			.where(eq(connectors.id, connectorId));
		expect(connector?.healthStatus).toBe('healthy');

		// First failure - degraded
		await updateHealthFromSyncResult(connectorId, false, 1);
		[connector] = await db
			.select({ healthStatus: connectors.healthStatus })
			.from(connectors)
			.where(eq(connectors.id, connectorId));
		expect(connector?.healthStatus).toBe('degraded');

		// More failures - still degraded (below threshold)
		await updateHealthFromSyncResult(connectorId, false, SYNC_CONFIG.UNHEALTHY_THRESHOLD - 1);
		[connector] = await db
			.select({ healthStatus: connectors.healthStatus })
			.from(connectors)
			.where(eq(connectors.id, connectorId));
		expect(connector?.healthStatus).toBe('degraded');

		// Reach threshold - unhealthy
		await updateHealthFromSyncResult(connectorId, false, SYNC_CONFIG.UNHEALTHY_THRESHOLD);
		[connector] = await db
			.select({ healthStatus: connectors.healthStatus })
			.from(connectors)
			.where(eq(connectors.id, connectorId));
		expect(connector?.healthStatus).toBe('unhealthy');

		// Recovery - back to healthy
		await updateHealthFromSyncResult(connectorId, true, 0);
		[connector] = await db
			.select({ healthStatus: connectors.healthStatus })
			.from(connectors)
			.where(eq(connectors.id, connectorId));
		expect(connector?.healthStatus).toBe('healthy');
	});
});

describe('Sync state consecutive failures', () => {
	it('should allow manual sync state updates', async () => {
		const { id: connectorId } = await createTestConnector('Sync State Test');

		// Insert initial sync state
		await db.insert(syncState).values({
			connectorId,
			consecutiveFailures: 0
		});

		// Verify initial state
		let state = await getSyncState(connectorId);
		expect(state?.consecutiveFailures).toBe(0);

		// Update to simulate failures
		await db
			.update(syncState)
			.set({ consecutiveFailures: 3 })
			.where(eq(syncState.connectorId, connectorId));

		state = await getSyncState(connectorId);
		expect(state?.consecutiveFailures).toBe(3);

		// Reset on success
		await db
			.update(syncState)
			.set({ consecutiveFailures: 0 })
			.where(eq(syncState.connectorId, connectorId));

		state = await getSyncState(connectorId);
		expect(state?.consecutiveFailures).toBe(0);
	});
});

describe('SYNC_CONFIG thresholds', () => {
	it('should have degraded threshold less than unhealthy threshold', () => {
		expect(SYNC_CONFIG.DEGRADED_THRESHOLD).toBeLessThan(SYNC_CONFIG.UNHEALTHY_THRESHOLD);
	});

	it('should use correct status at each threshold boundary', () => {
		// Just below degraded threshold
		expect(determineHealthStatus(false, SYNC_CONFIG.DEGRADED_THRESHOLD - 1)).toBe('degraded');

		// At degraded threshold
		expect(determineHealthStatus(false, SYNC_CONFIG.DEGRADED_THRESHOLD)).toBe('degraded');

		// Just below unhealthy threshold
		expect(determineHealthStatus(false, SYNC_CONFIG.UNHEALTHY_THRESHOLD - 1)).toBe('degraded');

		// At unhealthy threshold
		expect(determineHealthStatus(false, SYNC_CONFIG.UNHEALTHY_THRESHOLD)).toBe('unhealthy');

		// Above unhealthy threshold
		expect(determineHealthStatus(false, SYNC_CONFIG.UNHEALTHY_THRESHOLD + 1)).toBe('unhealthy');
	});
});
