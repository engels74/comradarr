/**
 * Unit tests for reconnect service - processReconnections() orchestration.
 *
 * DB-level reconnect operations (initialize, pause, resume, attempt) are covered
 * by integration tests in tests/integration/reconnect-flow.test.ts.
 * Backoff math covered by property tests in tests/properties/reconnect-backoff.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

// Mock the database and schema to avoid Bun import
vi.mock('$lib/server/db', () => ({
	db: {
		select: vi.fn(),
		update: vi.fn(),
		insert: vi.fn()
	}
}));

vi.mock('$lib/server/db/schema', () => ({
	connectors: {},
	syncState: {}
}));

vi.mock('drizzle-orm', () => ({
	eq: vi.fn(),
	and: vi.fn(),
	or: vi.fn(),
	isNotNull: vi.fn(),
	lte: vi.fn()
}));

// Mock reconnect queries
vi.mock('$lib/server/db/queries/reconnect', () => ({
	ensureSyncStateExists: vi.fn(),
	getReconnectState: vi.fn(),
	initializeReconnectState: vi.fn(),
	updateReconnectState: vi.fn(),
	resetReconnectState: vi.fn(),
	incrementReconnectAttempts: vi.fn(),
	pauseReconnect: vi.fn(),
	resumeReconnect: vi.fn(),
	getConnectorsDueForReconnect: vi.fn()
}));

// Mock connector queries
vi.mock('$lib/server/db/queries/connectors', () => ({
	getConnector: vi.fn(),
	getDecryptedApiKey: vi.fn(),
	updateConnectorHealth: vi.fn()
}));

// Mock connector factory
vi.mock('$lib/server/connectors/factory', () => ({
	createConnectorClient: vi.fn()
}));

// Mock logger
vi.mock('$lib/server/logger', () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn()
	})
}));

import { createConnectorClient } from '$lib/server/connectors/factory';
import { getDecryptedApiKey } from '$lib/server/db/queries/connectors';
import { getConnectorsDueForReconnect } from '$lib/server/db/queries/reconnect';
import { processReconnections } from '../../src/lib/server/services/reconnect/reconnect-service';

describe('processReconnections', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
		vi.clearAllMocks();

		(getDecryptedApiKey as Mock).mockResolvedValue('api-key');
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('returns empty result when no connectors due', async () => {
		(getConnectorsDueForReconnect as Mock).mockResolvedValue([]);

		const result = await processReconnections();

		expect(result.processed).toBe(0);
		expect(result.succeeded).toBe(0);
		expect(result.failed).toBe(0);
		expect(result.results).toHaveLength(0);
	});

	it('processes all due connectors', async () => {
		const connectors = [
			{
				id: 1,
				type: 'sonarr',
				name: 'Connector 1',
				url: 'http://localhost:8989',
				apiKeyEncrypted: 'key1',
				enabled: true,
				healthStatus: 'offline' as const,
				queuePaused: false,
				throttleProfileId: null,
				lastSync: null,
				createdAt: new Date(),
				updatedAt: new Date(),
				reconnectAttempts: 1,
				nextReconnectAt: new Date('2024-01-01T00:00:00Z'),
				reconnectStartedAt: new Date(),
				lastReconnectError: null,
				reconnectPaused: false
			},
			{
				id: 2,
				type: 'radarr',
				name: 'Connector 2',
				url: 'http://localhost:7878',
				apiKeyEncrypted: 'key2',
				enabled: true,
				healthStatus: 'offline' as const,
				queuePaused: false,
				throttleProfileId: null,
				lastSync: null,
				createdAt: new Date(),
				updatedAt: new Date(),
				reconnectAttempts: 2,
				nextReconnectAt: new Date('2024-01-01T00:00:00Z'),
				reconnectStartedAt: new Date(),
				lastReconnectError: null,
				reconnectPaused: false
			}
		];

		(getConnectorsDueForReconnect as Mock).mockResolvedValue(connectors);
		(createConnectorClient as Mock).mockReturnValue({
			ping: vi.fn().mockResolvedValue(true),
			getHealth: vi.fn().mockResolvedValue([{ type: 'ok' }])
		});

		const result = await processReconnections();

		expect(result.processed).toBe(2);
		expect(result.results).toHaveLength(2);
	});

	it('passes connector.reconnectAttempts to attemptReconnect', async () => {
		const connector = {
			id: 1,
			type: 'sonarr',
			name: 'Connector 1',
			url: 'http://localhost:8989',
			apiKeyEncrypted: 'key1',
			enabled: true,
			healthStatus: 'offline' as const,
			queuePaused: false,
			throttleProfileId: null,
			lastSync: null,
			createdAt: new Date(),
			updatedAt: new Date(),
			reconnectAttempts: 3,
			nextReconnectAt: new Date('2024-01-01T00:00:00Z'),
			reconnectStartedAt: new Date(),
			lastReconnectError: null,
			reconnectPaused: false
		};

		(getConnectorsDueForReconnect as Mock).mockResolvedValue([connector]);
		(createConnectorClient as Mock).mockReturnValue({
			ping: vi.fn().mockResolvedValue(true),
			getHealth: vi.fn().mockResolvedValue([{ type: 'ok' }])
		});

		const result = await processReconnections();

		// attemptNumber should be reconnectAttempts (3) + 1 = 4
		expect(result.results[0]?.attemptNumber).toBe(4);
	});

	it('aggregates succeeded/failed counts', async () => {
		const connectors = [
			{
				id: 1,
				type: 'sonarr',
				name: 'Success Connector',
				url: 'http://localhost:8989',
				apiKeyEncrypted: 'key1',
				enabled: true,
				healthStatus: 'offline' as const,
				queuePaused: false,
				throttleProfileId: null,
				lastSync: null,
				createdAt: new Date(),
				updatedAt: new Date(),
				reconnectAttempts: 0,
				nextReconnectAt: new Date(),
				reconnectStartedAt: new Date(),
				lastReconnectError: null,
				reconnectPaused: false
			},
			{
				id: 2,
				type: 'radarr',
				name: 'Failed Connector',
				url: 'http://localhost:7878',
				apiKeyEncrypted: 'key2',
				enabled: true,
				healthStatus: 'offline' as const,
				queuePaused: false,
				throttleProfileId: null,
				lastSync: null,
				createdAt: new Date(),
				updatedAt: new Date(),
				reconnectAttempts: 0,
				nextReconnectAt: new Date(),
				reconnectStartedAt: new Date(),
				lastReconnectError: null,
				reconnectPaused: false
			}
		];

		(getConnectorsDueForReconnect as Mock).mockResolvedValue(connectors);

		let callCount = 0;
		(createConnectorClient as Mock).mockImplementation(() => {
			callCount++;
			if (callCount === 1) {
				return {
					ping: vi.fn().mockResolvedValue(true),
					getHealth: vi.fn().mockResolvedValue([{ type: 'ok' }])
				};
			}
			return {
				ping: vi.fn().mockResolvedValue(false),
				getHealth: vi.fn()
			};
		});

		const result = await processReconnections();

		expect(result.succeeded).toBe(1);
		expect(result.failed).toBe(1);
	});
});
