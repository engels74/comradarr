/**
 * Integration tests for reconnect flow.
 *
 * Tests the full database operations for:
 * - Reconnect state initialization
 * - Querying connectors due for reconnect
 * - Pause/resume functionality
 * - State reset on successful reconnection
 * - Attempt incrementing on failure
 *
 * NOTE: These tests require a running PostgreSQL database with DATABASE_URL set.
 * Run with: bun test tests/integration/reconnect-flow.test.ts
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { db } from '../../src/lib/server/db';
import {
	type CreateConnectorInput,
	createConnector,
	deleteConnector,
	updateConnectorHealth
} from '../../src/lib/server/db/queries/connectors';
import {
	ensureSyncStateExists,
	getConnectorsDueForReconnect,
	getReconnectState,
	incrementReconnectAttempts,
	initializeReconnectState,
	pauseReconnect,
	resetReconnectState,
	resumeReconnect
} from '../../src/lib/server/db/queries/reconnect';
import { connectors, syncState } from '../../src/lib/server/db/schema';

const originalSecretKey = process.env.SECRET_KEY;
const TEST_SECRET_KEY = 'a'.repeat(64);

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
	for (const id of createdConnectorIds) {
		try {
			await deleteConnector(id);
		} catch {
			// Ignore errors during cleanup
		}
	}
	createdConnectorIds.length = 0;
});

async function createTestConnector(
	name: string = 'Test Connector',
	healthStatus: 'healthy' | 'degraded' | 'unhealthy' | 'offline' | 'unknown' = 'healthy'
): Promise<{ id: number; type: string }> {
	const input: CreateConnectorInput = {
		type: 'sonarr',
		name,
		url: 'http://localhost:8989',
		apiKey: 'a'.repeat(32)
	};

	const connector = await createConnector(input);
	createdConnectorIds.push(connector.id);

	if (healthStatus !== 'unknown') {
		await updateConnectorHealth(connector.id, healthStatus);
	}

	return { id: connector.id, type: connector.type };
}

describe('ensureSyncStateExists', () => {
	it('should create sync_state entry if none exists', async () => {
		const { id: connectorId } = await createTestConnector('Ensure State Test');

		await ensureSyncStateExists(connectorId);

		const state = await getReconnectState(connectorId);
		expect(state).not.toBeNull();
		expect(state?.reconnectAttempts).toBe(0);
		expect(state?.reconnectPaused).toBe(false);
	});

	it('should be idempotent - calling twice does not error', async () => {
		const { id: connectorId } = await createTestConnector('Idempotent Test');

		await ensureSyncStateExists(connectorId);
		await ensureSyncStateExists(connectorId);

		const state = await getReconnectState(connectorId);
		expect(state).not.toBeNull();
	});
});

describe('initializeReconnectState', () => {
	it('should create sync_state entry if none exists', async () => {
		const { id: connectorId } = await createTestConnector('Init State Test');

		const nextReconnectAt = new Date(Date.now() + 30000);
		await initializeReconnectState(connectorId, nextReconnectAt);

		const state = await getReconnectState(connectorId);
		expect(state).not.toBeNull();
		expect(state?.reconnectAttempts).toBe(0);
		expect(state?.reconnectStartedAt).not.toBeNull();
		expect(state?.nextReconnectAt?.getTime()).toBe(nextReconnectAt.getTime());
	});

	it('should set reconnectAttempts=0, reconnectStartedAt=now', async () => {
		const { id: connectorId } = await createTestConnector('Init Values Test');

		const now = new Date();
		const nextReconnectAt = new Date(now.getTime() + 30000);
		await initializeReconnectState(connectorId, nextReconnectAt);

		const state = await getReconnectState(connectorId);
		expect(state?.reconnectAttempts).toBe(0);
		expect(state?.reconnectStartedAt).not.toBeNull();

		// reconnectStartedAt should be close to now (within 1 second)
		const startedAt = state?.reconnectStartedAt?.getTime() ?? 0;
		expect(Math.abs(startedAt - now.getTime())).toBeLessThan(1000);
	});

	it('should be idempotent - does not reinitialize if reconnectStartedAt exists', async () => {
		const { id: connectorId } = await createTestConnector('Idempotent Init Test');

		// First initialization
		const firstNextReconnectAt = new Date(Date.now() + 30000);
		await initializeReconnectState(connectorId, firstNextReconnectAt);

		const firstState = await getReconnectState(connectorId);
		const firstStartedAt = firstState?.reconnectStartedAt?.getTime();

		// Wait a bit and try to reinitialize
		await new Promise((resolve) => setTimeout(resolve, 50));

		const secondNextReconnectAt = new Date(Date.now() + 60000);
		await initializeReconnectState(connectorId, secondNextReconnectAt);

		const secondState = await getReconnectState(connectorId);

		// reconnectStartedAt should not have changed
		expect(secondState?.reconnectStartedAt?.getTime()).toBe(firstStartedAt);
		// nextReconnectAt should not have changed either
		expect(secondState?.nextReconnectAt?.getTime()).toBe(firstNextReconnectAt.getTime());
	});
});

describe('getConnectorsDueForReconnect', () => {
	it('should return offline connectors past nextReconnectAt', async () => {
		const { id: connectorId } = await createTestConnector('Due Connector', 'offline');

		await ensureSyncStateExists(connectorId);
		const pastTime = new Date(Date.now() - 1000);
		await initializeReconnectState(connectorId, pastTime);

		// Force the nextReconnectAt to be in the past
		await db
			.update(syncState)
			.set({
				nextReconnectAt: pastTime,
				reconnectStartedAt: new Date(Date.now() - 60000)
			})
			.where(eq(syncState.connectorId, connectorId));

		const dueConnectors = await getConnectorsDueForReconnect();

		const found = dueConnectors.find((c) => c.id === connectorId);
		expect(found).not.toBeUndefined();
	});

	it('should NOT return connectors with future nextReconnectAt', async () => {
		const { id: connectorId } = await createTestConnector('Future Connector', 'offline');

		await ensureSyncStateExists(connectorId);
		const futureTime = new Date(Date.now() + 60000);
		await initializeReconnectState(connectorId, futureTime);

		const dueConnectors = await getConnectorsDueForReconnect();

		const found = dueConnectors.find((c) => c.id === connectorId);
		expect(found).toBeUndefined();
	});

	it('should NOT return paused connectors', async () => {
		const { id: connectorId } = await createTestConnector('Paused Connector', 'offline');

		await ensureSyncStateExists(connectorId);
		const pastTime = new Date(Date.now() - 1000);
		await initializeReconnectState(connectorId, pastTime);

		// Force the state and pause
		await db
			.update(syncState)
			.set({
				nextReconnectAt: pastTime,
				reconnectStartedAt: new Date(Date.now() - 60000),
				reconnectPaused: true
			})
			.where(eq(syncState.connectorId, connectorId));

		const dueConnectors = await getConnectorsDueForReconnect();

		const found = dueConnectors.find((c) => c.id === connectorId);
		expect(found).toBeUndefined();
	});

	it('should NOT return disabled connectors', async () => {
		const { id: connectorId } = await createTestConnector('Disabled Connector', 'offline');

		await ensureSyncStateExists(connectorId);
		const pastTime = new Date(Date.now() - 1000);

		// Force the state
		await db
			.update(syncState)
			.set({
				nextReconnectAt: pastTime,
				reconnectStartedAt: new Date(Date.now() - 60000)
			})
			.where(eq(syncState.connectorId, connectorId));

		// Disable the connector
		await db.update(connectors).set({ enabled: false }).where(eq(connectors.id, connectorId));

		const dueConnectors = await getConnectorsDueForReconnect();

		const found = dueConnectors.find((c) => c.id === connectorId);
		expect(found).toBeUndefined();
	});

	it('should NOT return healthy connectors', async () => {
		const { id: connectorId } = await createTestConnector('Healthy Connector', 'healthy');

		await ensureSyncStateExists(connectorId);
		const pastTime = new Date(Date.now() - 1000);

		// Force the state (even though this shouldn't happen for healthy connectors)
		await db
			.update(syncState)
			.set({
				nextReconnectAt: pastTime,
				reconnectStartedAt: new Date(Date.now() - 60000)
			})
			.where(eq(syncState.connectorId, connectorId));

		const dueConnectors = await getConnectorsDueForReconnect();

		const found = dueConnectors.find((c) => c.id === connectorId);
		expect(found).toBeUndefined();
	});

	it('should return unhealthy connectors past nextReconnectAt', async () => {
		const { id: connectorId } = await createTestConnector('Unhealthy Connector', 'unhealthy');

		await ensureSyncStateExists(connectorId);
		const pastTime = new Date(Date.now() - 1000);

		await db
			.update(syncState)
			.set({
				nextReconnectAt: pastTime,
				reconnectStartedAt: new Date(Date.now() - 60000)
			})
			.where(eq(syncState.connectorId, connectorId));

		const dueConnectors = await getConnectorsDueForReconnect();

		const found = dueConnectors.find((c) => c.id === connectorId);
		expect(found).not.toBeUndefined();
	});
});

describe('pauseReconnect / resumeReconnect', () => {
	it('pause sets reconnectPaused=true', async () => {
		const { id: connectorId } = await createTestConnector('Pause Test', 'offline');

		await ensureSyncStateExists(connectorId);
		await pauseReconnect(connectorId);

		const state = await getReconnectState(connectorId);
		expect(state?.reconnectPaused).toBe(true);
	});

	it('resume sets reconnectPaused=false and updates nextReconnectAt', async () => {
		const { id: connectorId } = await createTestConnector('Resume Test', 'offline');

		await ensureSyncStateExists(connectorId);
		await pauseReconnect(connectorId);

		const newNextReconnectAt = new Date(Date.now() + 120000);
		await resumeReconnect(connectorId, newNextReconnectAt);

		const state = await getReconnectState(connectorId);
		expect(state?.reconnectPaused).toBe(false);
		expect(state?.nextReconnectAt?.getTime()).toBe(newNextReconnectAt.getTime());
	});
});

describe('resetReconnectState', () => {
	it('clears all reconnect fields: attempts=0, times=null, error=null, paused=false', async () => {
		const { id: connectorId } = await createTestConnector('Reset Test', 'offline');

		await ensureSyncStateExists(connectorId);

		// Set some values first
		await db
			.update(syncState)
			.set({
				reconnectAttempts: 5,
				nextReconnectAt: new Date(),
				reconnectStartedAt: new Date(),
				lastReconnectError: 'Some error',
				reconnectPaused: true
			})
			.where(eq(syncState.connectorId, connectorId));

		await resetReconnectState(connectorId);

		const state = await getReconnectState(connectorId);
		expect(state?.reconnectAttempts).toBe(0);
		expect(state?.nextReconnectAt).toBeNull();
		expect(state?.reconnectStartedAt).toBeNull();
		expect(state?.lastReconnectError).toBeNull();
		expect(state?.reconnectPaused).toBe(false);
	});
});

describe('incrementReconnectAttempts', () => {
	it('increments attempts by 1', async () => {
		const { id: connectorId } = await createTestConnector('Increment Test', 'offline');

		await ensureSyncStateExists(connectorId);

		// Set initial attempts
		await db
			.update(syncState)
			.set({ reconnectAttempts: 2 })
			.where(eq(syncState.connectorId, connectorId));

		const nextReconnectAt = new Date(Date.now() + 30000);
		await incrementReconnectAttempts(connectorId, nextReconnectAt);

		const state = await getReconnectState(connectorId);
		expect(state?.reconnectAttempts).toBe(3);
	});

	it('updates nextReconnectAt', async () => {
		const { id: connectorId } = await createTestConnector('Next Time Test', 'offline');

		await ensureSyncStateExists(connectorId);

		const nextReconnectAt = new Date(Date.now() + 60000);
		await incrementReconnectAttempts(connectorId, nextReconnectAt);

		const state = await getReconnectState(connectorId);
		expect(state?.nextReconnectAt?.getTime()).toBe(nextReconnectAt.getTime());
	});

	it('stores error message', async () => {
		const { id: connectorId } = await createTestConnector('Error Message Test', 'offline');

		await ensureSyncStateExists(connectorId);

		const nextReconnectAt = new Date(Date.now() + 30000);
		const errorMessage = 'Connection refused';
		await incrementReconnectAttempts(connectorId, nextReconnectAt, errorMessage);

		const state = await getReconnectState(connectorId);
		expect(state?.lastReconnectError).toBe(errorMessage);
	});
});

describe('State transition scenarios', () => {
	it('tracks state through multiple failed attempts', async () => {
		const { id: connectorId } = await createTestConnector('Multi-Failure Test', 'offline');

		await ensureSyncStateExists(connectorId);

		// Initialize
		const firstNextTime = new Date(Date.now() + 30000);
		await initializeReconnectState(connectorId, firstNextTime);

		let state = await getReconnectState(connectorId);
		expect(state?.reconnectAttempts).toBe(0);

		// First failure
		const secondNextTime = new Date(Date.now() + 60000);
		await incrementReconnectAttempts(connectorId, secondNextTime, 'Attempt 1 failed');

		state = await getReconnectState(connectorId);
		expect(state?.reconnectAttempts).toBe(1);
		expect(state?.lastReconnectError).toBe('Attempt 1 failed');

		// Second failure
		const thirdNextTime = new Date(Date.now() + 120000);
		await incrementReconnectAttempts(connectorId, thirdNextTime, 'Attempt 2 failed');

		state = await getReconnectState(connectorId);
		expect(state?.reconnectAttempts).toBe(2);
		expect(state?.lastReconnectError).toBe('Attempt 2 failed');

		// Third failure
		const fourthNextTime = new Date(Date.now() + 240000);
		await incrementReconnectAttempts(connectorId, fourthNextTime, 'Attempt 3 failed');

		state = await getReconnectState(connectorId);
		expect(state?.reconnectAttempts).toBe(3);
		expect(state?.nextReconnectAt?.getTime()).toBe(fourthNextTime.getTime());
	});

	it('preserves attempt count when pausing and resuming', async () => {
		const { id: connectorId } = await createTestConnector('Pause Resume Test', 'offline');

		await ensureSyncStateExists(connectorId);
		await initializeReconnectState(connectorId, new Date(Date.now() + 30000));

		// Increment a few times
		await incrementReconnectAttempts(connectorId, new Date(Date.now() + 60000));
		await incrementReconnectAttempts(connectorId, new Date(Date.now() + 120000));

		let state = await getReconnectState(connectorId);
		expect(state?.reconnectAttempts).toBe(2);

		// Pause
		await pauseReconnect(connectorId);

		state = await getReconnectState(connectorId);
		expect(state?.reconnectPaused).toBe(true);
		expect(state?.reconnectAttempts).toBe(2); // Preserved

		// Resume
		const newNextTime = new Date(Date.now() + 180000);
		await resumeReconnect(connectorId, newNextTime);

		state = await getReconnectState(connectorId);
		expect(state?.reconnectPaused).toBe(false);
		expect(state?.reconnectAttempts).toBe(2); // Still preserved
		expect(state?.nextReconnectAt?.getTime()).toBe(newNextTime.getTime());
	});

	it('resets state completely on successful reconnection', async () => {
		const { id: connectorId } = await createTestConnector('Success Reset Test', 'offline');

		await ensureSyncStateExists(connectorId);
		await initializeReconnectState(connectorId, new Date(Date.now() + 30000));

		// Simulate several failures
		await incrementReconnectAttempts(connectorId, new Date(Date.now() + 60000), 'Error 1');
		await incrementReconnectAttempts(connectorId, new Date(Date.now() + 120000), 'Error 2');
		await incrementReconnectAttempts(connectorId, new Date(Date.now() + 240000), 'Error 3');

		let state = await getReconnectState(connectorId);
		expect(state?.reconnectAttempts).toBe(3);
		expect(state?.lastReconnectError).toBe('Error 3');

		// Simulate successful reconnection
		await resetReconnectState(connectorId);

		state = await getReconnectState(connectorId);
		expect(state?.reconnectAttempts).toBe(0);
		expect(state?.nextReconnectAt).toBeNull();
		expect(state?.reconnectStartedAt).toBeNull();
		expect(state?.lastReconnectError).toBeNull();
		expect(state?.reconnectPaused).toBe(false);
	});
});
