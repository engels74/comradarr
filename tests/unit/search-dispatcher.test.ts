/**
 * Unit tests for search dispatcher error handling and Prowlarr integration.
 *
 * Rate limit handling, successful dispatch, and throttle enforcement tests are
 * covered by integration tests in tests/integration/search-dispatcher.test.ts.
 */

import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import {
	AuthenticationError,
	NetworkError,
	ServerError
} from '../../src/lib/server/connectors/common/errors';

// Create mock client instances
const mockSonarrClient = {
	sendEpisodeSearch: vi.fn(),
	sendSeasonSearch: vi.fn()
};

const mockRadarrClient = {
	sendMoviesSearch: vi.fn()
};

const mockWhisparrClient = {
	sendEpisodeSearch: vi.fn(),
	sendSeasonSearch: vi.fn()
};

// Mock the dependencies before importing the module under test
vi.mock('$lib/server/db/queries/connectors', () => ({
	getConnector: vi.fn(),
	getDecryptedApiKey: vi.fn()
}));

// Mock content data - arrId matches the DB ID passed in tests for simplicity
const mockEpisodeData = {
	title: 'Test Episode',
	seasonNumber: 1,
	episodeNumber: 1,
	seriesTitle: 'Test Series',
	arrId: 456,
	arrSeriesId: 10
};

const mockMovieData = {
	title: 'Test Movie',
	year: 2024,
	arrId: 789
};

// Mock the database and schema to avoid Bun import
vi.mock('$lib/server/db', () => ({
	db: {
		select: vi.fn(() => ({
			from: vi.fn(() => ({
				innerJoin: vi.fn(() => ({
					innerJoin: vi.fn(() => ({
						where: vi.fn(() => ({
							limit: vi.fn(() => Promise.resolve([mockEpisodeData]))
						}))
					})),
					where: vi.fn(() => ({
						limit: vi.fn(() => Promise.resolve([mockEpisodeData]))
					}))
				})),
				where: vi.fn(() => ({
					limit: vi.fn(() => Promise.resolve([mockMovieData]))
				}))
			}))
		}))
	}
}));

vi.mock('$lib/server/db/schema', () => ({
	episodes: {},
	movies: {},
	seasons: {},
	series: {}
}));

vi.mock('drizzle-orm', () => ({
	eq: vi.fn()
}));

// Mock connectors with proper class constructors
vi.mock('$lib/server/connectors', async () => {
	const errors = await import('../../src/lib/server/connectors/common/errors');
	return {
		// Create mock classes that return the mock instances
		SonarrClient: class MockSonarrClient {
			constructor() {
				// biome-ignore lint/correctness/noConstructorReturn: intentional pattern for mocking
				return mockSonarrClient;
			}
		},
		RadarrClient: class MockRadarrClient {
			constructor() {
				// biome-ignore lint/correctness/noConstructorReturn: intentional pattern for mocking
				return mockRadarrClient;
			}
		},
		WhisparrClient: class MockWhisparrClient {
			constructor() {
				// biome-ignore lint/correctness/noConstructorReturn: intentional pattern for mocking
				return mockWhisparrClient;
			}
		},
		// Pass through the actual error types
		RateLimitError: errors.RateLimitError,
		isArrClientError: (error: unknown) => {
			return (
				error instanceof errors.RateLimitError ||
				error instanceof errors.NetworkError ||
				error instanceof errors.AuthenticationError ||
				error instanceof errors.ServerError
			);
		}
	};
});

vi.mock('$lib/server/services/throttle', () => ({
	throttleEnforcer: {
		canDispatch: vi.fn(),
		recordRequest: vi.fn(),
		handleRateLimitResponse: vi.fn(),
		getStatus: vi.fn()
	}
}));

vi.mock('$lib/server/services/prowlarr', () => ({
	prowlarrHealthMonitor: {
		getAllCachedHealth: vi.fn()
	}
}));

import { getConnector, getDecryptedApiKey } from '$lib/server/db/queries/connectors';
import { prowlarrHealthMonitor } from '$lib/server/services/prowlarr';
import { throttleEnforcer } from '$lib/server/services/throttle';
// Now import the module and mocks
import { dispatchSearch } from '../../src/lib/server/services/queue/search-dispatcher';

describe('dispatchSearch', () => {
	const mockConnector = {
		id: 1,
		name: 'Test Sonarr',
		type: 'sonarr',
		url: 'http://localhost:8989',
		apiKeyEncrypted: 'encrypted-key',
		enabled: true
	};

	beforeEach(() => {
		vi.clearAllMocks();

		// Default mock implementations
		(getConnector as Mock).mockResolvedValue(mockConnector);
		(getDecryptedApiKey as Mock).mockResolvedValue('decrypted-api-key');
		(throttleEnforcer.canDispatch as Mock).mockResolvedValue({ allowed: true });
		(throttleEnforcer.recordRequest as Mock).mockResolvedValue(undefined);
		(throttleEnforcer.handleRateLimitResponse as Mock).mockResolvedValue(undefined);
		(throttleEnforcer.getStatus as Mock).mockResolvedValue({
			connectorId: 1,
			requestsThisMinute: 0,
			requestsToday: 0,
			remainingThisMinute: 5,
			remainingToday: 100,
			isPaused: false,
			pauseReason: null,
			pauseExpiresInMs: null
		});
		// Default: no Prowlarr instances configured (empty array)
		(prowlarrHealthMonitor.getAllCachedHealth as Mock).mockResolvedValue([]);
	});

	describe('other error handling', () => {
		it('should handle network errors gracefully', async () => {
			mockSonarrClient.sendEpisodeSearch.mockRejectedValue(
				new NetworkError('Connection refused', 'connection_refused')
			);

			const result = await dispatchSearch(1, 100, 'episode', 'gap', {
				episodeIds: [456]
			});

			expect(result.success).toBe(false);
			expect(result.error).toContain('network');
			expect(result.rateLimited).toBeUndefined();
			expect(throttleEnforcer.handleRateLimitResponse).not.toHaveBeenCalled();
		});

		it('should handle authentication errors gracefully', async () => {
			mockSonarrClient.sendEpisodeSearch.mockRejectedValue(new AuthenticationError());

			const result = await dispatchSearch(1, 100, 'episode', 'gap', {
				episodeIds: [456]
			});

			expect(result.success).toBe(false);
			expect(result.error).toContain('authentication');
			expect(throttleEnforcer.handleRateLimitResponse).not.toHaveBeenCalled();
		});

		it('should handle server errors gracefully', async () => {
			mockSonarrClient.sendEpisodeSearch.mockRejectedValue(
				new ServerError(503, 'Service Unavailable')
			);

			const result = await dispatchSearch(1, 100, 'episode', 'gap', {
				episodeIds: [456]
			});

			expect(result.success).toBe(false);
			expect(result.error).toContain('server');
			expect(throttleEnforcer.handleRateLimitResponse).not.toHaveBeenCalled();
		});

		it('should re-throw unknown errors', async () => {
			mockSonarrClient.sendEpisodeSearch.mockRejectedValue(new Error('Unknown error'));

			await expect(dispatchSearch(1, 100, 'episode', 'gap', { episodeIds: [456] })).rejects.toThrow(
				'Unknown error'
			);
		});
	});

	describe('connector not found', () => {
		it('should return error when connector does not exist', async () => {
			(getConnector as Mock).mockResolvedValue(null);

			const result = await dispatchSearch(999, 100, 'episode', 'gap', {
				episodeIds: [456]
			});

			expect(result.success).toBe(false);
			expect(result.error).toContain('not found');
		});
	});

	describe('Prowlarr health check integration', () => {
		it('should call getAllCachedHealth during dispatch', async () => {
			mockSonarrClient.sendEpisodeSearch.mockResolvedValue({ id: 123, status: 'queued' });

			await dispatchSearch(1, 100, 'episode', 'gap', {
				episodeIds: [456]
			});

			expect(prowlarrHealthMonitor.getAllCachedHealth).toHaveBeenCalled();
		});

		it('should proceed with dispatch when indexers are rate-limited', async () => {
			// Mock rate-limited indexers
			(prowlarrHealthMonitor.getAllCachedHealth as Mock).mockResolvedValue([
				{
					instanceId: 1,
					indexerId: 10,
					name: 'NZBgeek',
					enabled: true,
					isRateLimited: true,
					rateLimitExpiresAt: new Date(Date.now() + 3600000),
					mostRecentFailure: null,
					lastUpdated: new Date(),
					isStale: false
				}
			]);
			mockSonarrClient.sendEpisodeSearch.mockResolvedValue({ id: 123, status: 'queued' });

			const result = await dispatchSearch(1, 100, 'episode', 'gap', {
				episodeIds: [456]
			});

			// Dispatch should still succeed despite unhealthy indexers
			expect(result.success).toBe(true);
			expect(result.commandId).toBe(123);
		});

		it('should proceed with dispatch when Prowlarr health check throws', async () => {
			// Simulate Prowlarr being unreachable
			(prowlarrHealthMonitor.getAllCachedHealth as Mock).mockRejectedValue(
				new Error('Database connection failed')
			);
			mockSonarrClient.sendEpisodeSearch.mockResolvedValue({ id: 123, status: 'queued' });

			const result = await dispatchSearch(1, 100, 'episode', 'gap', {
				episodeIds: [456]
			});

			// Dispatch should still succeed
			expect(result.success).toBe(true);
			expect(result.commandId).toBe(123);
		});

		it('should skip health check when no Prowlarr instances configured', async () => {
			(prowlarrHealthMonitor.getAllCachedHealth as Mock).mockResolvedValue([]);
			mockSonarrClient.sendEpisodeSearch.mockResolvedValue({ id: 123, status: 'queued' });

			const result = await dispatchSearch(1, 100, 'episode', 'gap', {
				episodeIds: [456]
			});

			expect(result.success).toBe(true);
			expect(prowlarrHealthMonitor.getAllCachedHealth).toHaveBeenCalled();
		});

		it('should log warning when indexers are rate-limited', async () => {
			const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

			(prowlarrHealthMonitor.getAllCachedHealth as Mock).mockResolvedValue([
				{
					instanceId: 1,
					indexerId: 10,
					name: 'NZBgeek',
					enabled: true,
					isRateLimited: true,
					rateLimitExpiresAt: new Date(Date.now() + 3600000),
					mostRecentFailure: null,
					lastUpdated: new Date(),
					isStale: false
				}
			]);
			mockSonarrClient.sendEpisodeSearch.mockResolvedValue({ id: 123, status: 'queued' });

			await dispatchSearch(1, 100, 'episode', 'gap', {
				episodeIds: [456]
			});

			// Logger outputs structured JSON to console.log
			const logCalls = logSpy.mock.calls.map((call) => {
				try {
					return JSON.parse(call[0] as string);
				} catch {
					return null;
				}
			});

			const healthWarning = logCalls.find(
				(entry) =>
					entry?.level === 'warn' &&
					entry?.module === 'dispatcher' &&
					entry?.message === 'Prowlarr health warning'
			);

			expect(healthWarning).toBeDefined();
			expect(healthWarning).toMatchObject({
				rateLimitedIndexers: 1,
				totalIndexers: 1
			});

			logSpy.mockRestore();
		});

		it('should not log warning when all indexers are healthy', async () => {
			const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

			(prowlarrHealthMonitor.getAllCachedHealth as Mock).mockResolvedValue([
				{
					instanceId: 1,
					indexerId: 10,
					name: 'NZBgeek',
					enabled: true,
					isRateLimited: false,
					rateLimitExpiresAt: null,
					mostRecentFailure: null,
					lastUpdated: new Date(),
					isStale: false
				}
			]);
			mockSonarrClient.sendEpisodeSearch.mockResolvedValue({ id: 123, status: 'queued' });

			await dispatchSearch(1, 100, 'episode', 'gap', {
				episodeIds: [456]
			});

			// Logger outputs structured JSON to console.log
			const logCalls = logSpy.mock.calls.map((call) => {
				try {
					return JSON.parse(call[0] as string);
				} catch {
					return null;
				}
			});

			const healthWarning = logCalls.find(
				(entry) =>
					entry?.level === 'warn' &&
					entry?.module === 'dispatcher' &&
					entry?.message === 'Prowlarr health warning'
			);

			expect(healthWarning).toBeUndefined();

			logSpy.mockRestore();
		});

		it('should log warning when Prowlarr health check fails', async () => {
			const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

			(prowlarrHealthMonitor.getAllCachedHealth as Mock).mockRejectedValue(
				new Error('Connection timeout')
			);
			mockSonarrClient.sendEpisodeSearch.mockResolvedValue({ id: 123, status: 'queued' });

			await dispatchSearch(1, 100, 'episode', 'gap', {
				episodeIds: [456]
			});

			// Logger outputs structured JSON to console.log
			const logCalls = logSpy.mock.calls.map((call) => {
				try {
					return JSON.parse(call[0] as string);
				} catch {
					return null;
				}
			});

			const healthCheckFailed = logCalls.find(
				(entry) =>
					entry?.level === 'warn' &&
					entry?.module === 'dispatcher' &&
					entry?.message === 'Prowlarr health check failed (continuing dispatch)'
			);

			expect(healthCheckFailed).toBeDefined();
			expect(healthCheckFailed).toMatchObject({
				error: 'Connection timeout'
			});

			logSpy.mockRestore();
		});
	});
});
