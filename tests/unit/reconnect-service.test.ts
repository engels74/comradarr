/**
 * Unit tests for reconnect service with exponential backoff
 *
 * Tests cover:
 * - initializeReconnectForOfflineConnector() behavior
 * - calculateBackoffDelay() timing with exponential growth and jitter
 * - calculateNextReconnectTime() date calculation
 * - triggerManualReconnect() immediate attempt handling
 * - pauseConnectorReconnect() and resumeConnectorReconnect() controls
 * - attemptReconnect() success/failure paths
 * - processReconnections() batch processing
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
// Import mocked modules
import {
	getConnector,
	getDecryptedApiKey,
	updateConnectorHealth
} from '$lib/server/db/queries/connectors';
import {
	ensureSyncStateExists,
	getConnectorsDueForReconnect,
	getReconnectState,
	incrementReconnectAttempts,
	initializeReconnectState,
	pauseReconnect,
	resetReconnectState,
	resumeReconnect,
	updateReconnectState
} from '$lib/server/db/queries/reconnect';

// Import the module under test
import {
	AuthenticationError,
	NetworkError,
	TimeoutError
} from '../../src/lib/server/connectors/common/errors';
import { RECONNECT_CONFIG } from '../../src/lib/server/services/reconnect/config';
import {
	attemptReconnect,
	calculateBackoffDelay,
	calculateNextReconnectTime,
	initializeReconnectForOfflineConnector,
	pauseConnectorReconnect,
	processReconnections,
	resumeConnectorReconnect,
	triggerManualReconnect
} from '../../src/lib/server/services/reconnect/reconnect-service';

describe('calculateBackoffDelay', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('without jitter (mock Math.random to 0.5)', () => {
		beforeEach(() => {
			vi.spyOn(Math, 'random').mockReturnValue(0.5);
		});

		it('attempt 0 returns ~30,000ms (30s)', () => {
			const delay = calculateBackoffDelay(0);
			// With random = 0.5: jitter = (0.5 * 2 - 1) * 30000 * 0.25 = 0
			expect(delay).toBe(30_000);
		});

		it('attempt 1 returns ~60,000ms (1m)', () => {
			const delay = calculateBackoffDelay(1);
			// 30000 * 2^1 = 60000, jitter = 0
			expect(delay).toBe(60_000);
		});

		it('attempt 2 returns ~120,000ms (2m)', () => {
			const delay = calculateBackoffDelay(2);
			// 30000 * 2^2 = 120000, jitter = 0
			expect(delay).toBe(120_000);
		});

		it('attempt 3 returns ~240,000ms (4m)', () => {
			const delay = calculateBackoffDelay(3);
			// 30000 * 2^3 = 240000, jitter = 0
			expect(delay).toBe(240_000);
		});

		it('attempt 4 returns ~480,000ms (8m)', () => {
			const delay = calculateBackoffDelay(4);
			// 30000 * 2^4 = 480000, jitter = 0
			expect(delay).toBe(480_000);
		});

		it('attempt 5+ returns ~600,000ms (10m, capped at MAX_DELAY_MS)', () => {
			const delay = calculateBackoffDelay(5);
			// 30000 * 2^5 = 960000, capped at 600000, jitter = 0
			expect(delay).toBe(600_000);
		});

		it('high attempt numbers remain capped at MAX_DELAY_MS', () => {
			const delay10 = calculateBackoffDelay(10);
			const delay20 = calculateBackoffDelay(20);
			expect(delay10).toBe(600_000);
			expect(delay20).toBe(600_000);
		});
	});

	describe('with jitter', () => {
		it('produces varying delays for same attempt', () => {
			const delays = new Set<number>();

			for (let i = 0; i < 100; i++) {
				delays.add(calculateBackoffDelay(0));
			}

			// With jitter enabled (real Math.random), we should see variation
			expect(delays.size).toBeGreaterThan(1);
		});

		it('delays are within ±25% bounds for attempt 0 (22,500–37,500ms)', () => {
			const minExpected = RECONNECT_CONFIG.BASE_DELAY_MS * (1 - RECONNECT_CONFIG.JITTER);
			const maxExpected = RECONNECT_CONFIG.BASE_DELAY_MS * (1 + RECONNECT_CONFIG.JITTER);

			for (let i = 0; i < 100; i++) {
				const delay = calculateBackoffDelay(0);
				expect(delay).toBeGreaterThanOrEqual(minExpected);
				expect(delay).toBeLessThanOrEqual(maxExpected);
			}
		});

		it('delays are within ±25% bounds for capped delays', () => {
			const minExpected = RECONNECT_CONFIG.MAX_DELAY_MS * (1 - RECONNECT_CONFIG.JITTER);
			const maxExpected = RECONNECT_CONFIG.MAX_DELAY_MS * (1 + RECONNECT_CONFIG.JITTER);

			for (let i = 0; i < 100; i++) {
				const delay = calculateBackoffDelay(10);
				expect(delay).toBeGreaterThanOrEqual(minExpected);
				expect(delay).toBeLessThanOrEqual(maxExpected);
			}
		});
	});
});

describe('calculateNextReconnectTime', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
		vi.spyOn(Math, 'random').mockReturnValue(0.5);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('returns Date = now + backoffDelay for attempt 0', () => {
		const result = calculateNextReconnectTime(0);
		const expected = new Date('2024-01-01T00:00:30Z'); // +30 seconds
		expect(result.getTime()).toBe(expected.getTime());
	});

	it('returns Date = now + backoffDelay for attempt 1', () => {
		const result = calculateNextReconnectTime(1);
		const expected = new Date('2024-01-01T00:01:00Z'); // +60 seconds
		expect(result.getTime()).toBe(expected.getTime());
	});

	it('returns Date = now + backoffDelay for attempt 5 (capped)', () => {
		const result = calculateNextReconnectTime(5);
		const expected = new Date('2024-01-01T00:10:00Z'); // +600 seconds (10 minutes)
		expect(result.getTime()).toBe(expected.getTime());
	});
});

describe('initializeReconnectForOfflineConnector', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
		vi.spyOn(Math, 'random').mockReturnValue(0.5);
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('should call ensureSyncStateExists before checking state', async () => {
		(getReconnectState as Mock).mockResolvedValue(null);

		await initializeReconnectForOfflineConnector(1);

		expect(ensureSyncStateExists).toHaveBeenCalledWith(1);
		expect(getReconnectState).toHaveBeenCalledWith(1);
	});

	it('should initialize when reconnectStartedAt is null', async () => {
		(getReconnectState as Mock).mockResolvedValue({
			reconnectAttempts: 0,
			nextReconnectAt: null,
			reconnectStartedAt: null,
			lastReconnectError: null,
			reconnectPaused: false
		});

		await initializeReconnectForOfflineConnector(1);

		expect(initializeReconnectState).toHaveBeenCalledWith(1, expect.any(Date));
	});

	it('should NOT reinitialize when reconnectStartedAt exists (idempotent)', async () => {
		(getReconnectState as Mock).mockResolvedValue({
			reconnectAttempts: 2,
			nextReconnectAt: new Date('2024-01-01T00:05:00Z'),
			reconnectStartedAt: new Date('2024-01-01T00:00:00Z'),
			lastReconnectError: null,
			reconnectPaused: false
		});

		await initializeReconnectForOfflineConnector(1);

		expect(initializeReconnectState).not.toHaveBeenCalled();
	});

	it('should calculate nextReconnectAt ~30s from now', async () => {
		// After ensureSyncStateExists, state exists with null reconnectStartedAt
		(getReconnectState as Mock).mockResolvedValue({
			reconnectAttempts: 0,
			nextReconnectAt: null,
			reconnectStartedAt: null,
			lastReconnectError: null,
			reconnectPaused: false
		});

		await initializeReconnectForOfflineConnector(1);

		const expectedTime = new Date('2024-01-01T00:00:30Z');
		expect(initializeReconnectState).toHaveBeenCalledWith(1, expectedTime);
	});
});

describe('triggerManualReconnect', () => {
	const mockConnector = {
		id: 1,
		type: 'sonarr',
		name: 'Test Connector',
		url: 'http://localhost:8989',
		apiKeyEncrypted: 'encrypted-key',
		enabled: true,
		healthStatus: 'offline',
		queuePaused: false,
		throttleProfileId: null,
		lastSync: null,
		createdAt: new Date(),
		updatedAt: new Date()
	};

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('throws Error when connector not found', async () => {
		(getConnector as Mock).mockResolvedValue(undefined);

		await expect(triggerManualReconnect(999)).rejects.toThrow('Connector 999 not found');
	});

	it('calls ensureSyncStateExists', async () => {
		(getConnector as Mock).mockResolvedValue(mockConnector);
		(getDecryptedApiKey as Mock).mockResolvedValue('api-key');
		(createConnectorClient as Mock).mockReturnValue({
			ping: vi.fn().mockResolvedValue(true),
			getHealth: vi.fn().mockResolvedValue([{ type: 'ok' }])
		});

		await triggerManualReconnect(1);

		expect(ensureSyncStateExists).toHaveBeenCalledWith(1);
	});

	it('resets state: attempts=0, nextReconnectAt=null, reconnectStartedAt=now', async () => {
		(getConnector as Mock).mockResolvedValue(mockConnector);
		(getDecryptedApiKey as Mock).mockResolvedValue('api-key');
		(createConnectorClient as Mock).mockReturnValue({
			ping: vi.fn().mockResolvedValue(true),
			getHealth: vi.fn().mockResolvedValue([{ type: 'ok' }])
		});

		await triggerManualReconnect(1);

		expect(updateReconnectState).toHaveBeenCalledWith(1, {
			reconnectAttempts: 0,
			nextReconnectAt: null,
			reconnectStartedAt: new Date('2024-01-01T00:00:00Z'),
			lastReconnectError: null,
			reconnectPaused: false
		});
	});

	it('calls attemptReconnect with attemptCount=0', async () => {
		(getConnector as Mock).mockResolvedValue(mockConnector);
		(getDecryptedApiKey as Mock).mockResolvedValue('api-key');

		const pingMock = vi.fn().mockResolvedValue(true);
		const getHealthMock = vi.fn().mockResolvedValue({ api: true, database: true });
		(createConnectorClient as Mock).mockReturnValue({
			ping: pingMock,
			getHealth: getHealthMock
		});

		const result = await triggerManualReconnect(1);

		expect(pingMock).toHaveBeenCalled();
		expect(result.attemptNumber).toBe(1); // attemptNumber = currentAttemptCount (0) + 1
	});
});

describe('pauseConnectorReconnect', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('calls ensureSyncStateExists', async () => {
		await pauseConnectorReconnect(1);

		expect(ensureSyncStateExists).toHaveBeenCalledWith(1);
	});

	it('calls pauseReconnect DB function', async () => {
		await pauseConnectorReconnect(1);

		expect(pauseReconnect).toHaveBeenCalledWith(1);
	});
});

describe('resumeConnectorReconnect', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
		vi.spyOn(Math, 'random').mockReturnValue(0.5);
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('calls ensureSyncStateExists', async () => {
		(getReconnectState as Mock).mockResolvedValue({
			reconnectAttempts: 2,
			nextReconnectAt: null,
			reconnectStartedAt: new Date(),
			lastReconnectError: null,
			reconnectPaused: true
		});

		await resumeConnectorReconnect(1);

		expect(ensureSyncStateExists).toHaveBeenCalledWith(1);
	});

	it('gets current state to read reconnectAttempts', async () => {
		(getReconnectState as Mock).mockResolvedValue({
			reconnectAttempts: 3,
			nextReconnectAt: null,
			reconnectStartedAt: new Date(),
			lastReconnectError: null,
			reconnectPaused: true
		});

		await resumeConnectorReconnect(1);

		expect(getReconnectState).toHaveBeenCalledWith(1);
	});

	it('calculates new nextReconnectAt from current attempt count', async () => {
		(getReconnectState as Mock).mockResolvedValue({
			reconnectAttempts: 2,
			nextReconnectAt: null,
			reconnectStartedAt: new Date(),
			lastReconnectError: null,
			reconnectPaused: true
		});

		await resumeConnectorReconnect(1);

		// attempt 2 -> 30000 * 2^2 = 120000ms = 2 minutes
		const expectedTime = new Date('2024-01-01T00:02:00Z');
		expect(resumeReconnect).toHaveBeenCalledWith(1, expectedTime);
	});

	it('defaults to attempt 0 if no state exists', async () => {
		(getReconnectState as Mock).mockResolvedValue(null);

		await resumeConnectorReconnect(1);

		// attempt 0 -> 30000ms = 30 seconds
		const expectedTime = new Date('2024-01-01T00:00:30Z');
		expect(resumeReconnect).toHaveBeenCalledWith(1, expectedTime);
	});
});

describe('attemptReconnect', () => {
	const mockConnector = {
		id: 1,
		type: 'sonarr',
		name: 'Test Connector',
		url: 'http://localhost:8989',
		apiKeyEncrypted: 'encrypted-key',
		enabled: true,
		healthStatus: 'offline',
		queuePaused: false,
		throttleProfileId: null,
		lastSync: null,
		createdAt: new Date(),
		updatedAt: new Date()
	};

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
		vi.spyOn(Math, 'random').mockReturnValue(0.5);
		vi.clearAllMocks();

		(getDecryptedApiKey as Mock).mockResolvedValue('api-key');
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	describe('success path', () => {
		it('updates health status to healthy', async () => {
			(createConnectorClient as Mock).mockReturnValue({
				ping: vi.fn().mockResolvedValue(true),
				getHealth: vi.fn().mockResolvedValue([{ type: 'ok' }])
			});

			await attemptReconnect(mockConnector);

			expect(updateConnectorHealth).toHaveBeenCalledWith(1, 'healthy');
		});

		it('calls resetReconnectState', async () => {
			(createConnectorClient as Mock).mockReturnValue({
				ping: vi.fn().mockResolvedValue(true),
				getHealth: vi.fn().mockResolvedValue([{ type: 'ok' }])
			});

			await attemptReconnect(mockConnector);

			expect(resetReconnectState).toHaveBeenCalledWith(1);
		});

		it('returns { success: true, newStatus: healthy }', async () => {
			(createConnectorClient as Mock).mockReturnValue({
				ping: vi.fn().mockResolvedValue(true),
				getHealth: vi.fn().mockResolvedValue([{ type: 'ok' }])
			});

			const result = await attemptReconnect(mockConnector);

			expect(result.success).toBe(true);
			expect(result.newStatus).toBe('healthy');
		});
	});

	describe('failure path', () => {
		it('ping fails -> status offline, incrementReconnectAttempts', async () => {
			(createConnectorClient as Mock).mockReturnValue({
				ping: vi.fn().mockResolvedValue(false),
				getHealth: vi.fn()
			});

			const result = await attemptReconnect(mockConnector, 0);

			expect(updateConnectorHealth).toHaveBeenCalledWith(1, 'offline');
			expect(incrementReconnectAttempts).toHaveBeenCalled();
			expect(result.success).toBe(false);
			expect(result.newStatus).toBe('offline');
		});

		it('AuthenticationError -> status unhealthy', async () => {
			(createConnectorClient as Mock).mockReturnValue({
				ping: vi.fn().mockRejectedValue(new AuthenticationError()),
				getHealth: vi.fn()
			});

			const result = await attemptReconnect(mockConnector);

			expect(updateConnectorHealth).toHaveBeenCalledWith(1, 'unhealthy');
			expect(result.newStatus).toBe('unhealthy');
		});

		it('NetworkError -> status offline', async () => {
			(createConnectorClient as Mock).mockReturnValue({
				ping: vi
					.fn()
					.mockRejectedValue(new NetworkError('Connection refused', 'connection_refused')),
				getHealth: vi.fn()
			});

			const result = await attemptReconnect(mockConnector);

			expect(updateConnectorHealth).toHaveBeenCalledWith(1, 'offline');
			expect(result.newStatus).toBe('offline');
		});

		it('TimeoutError -> status offline', async () => {
			(createConnectorClient as Mock).mockReturnValue({
				ping: vi.fn().mockRejectedValue(new TimeoutError(30000)),
				getHealth: vi.fn()
			});

			const result = await attemptReconnect(mockConnector);

			expect(updateConnectorHealth).toHaveBeenCalledWith(1, 'offline');
			expect(result.newStatus).toBe('offline');
		});

		it('calculates nextReconnectAt using attemptNumber (not currentAttemptCount)', async () => {
			(createConnectorClient as Mock).mockReturnValue({
				ping: vi.fn().mockResolvedValue(false),
				getHealth: vi.fn()
			});

			await attemptReconnect(mockConnector, 2);

			// attemptNumber = currentAttemptCount (2) + 1 = 3
			// delay = 30000 * 2^3 = 240000ms = 4 minutes
			const expectedTime = new Date('2024-01-01T00:04:00Z');
			expect(incrementReconnectAttempts).toHaveBeenCalledWith(
				1,
				expectedTime,
				'Connection failed - no response'
			);
		});

		it('stores error message in lastReconnectError', async () => {
			(createConnectorClient as Mock).mockReturnValue({
				ping: vi
					.fn()
					.mockRejectedValue(new NetworkError('Connection refused', 'connection_refused')),
				getHealth: vi.fn()
			});

			const result = await attemptReconnect(mockConnector);

			expect(incrementReconnectAttempts).toHaveBeenCalledWith(
				1,
				expect.any(Date),
				'Connection refused'
			);
			expect(result.error).toBe('Connection refused');
		});
	});
});

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
		expect(result.results[0].attemptNumber).toBe(4);
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
