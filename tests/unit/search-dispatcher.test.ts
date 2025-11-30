/**
 * Unit tests for search dispatcher HTTP 429 handling.
 *
 * Tests focus on:
 * - RateLimitError triggering handleRateLimitResponse()
 * - Retry-After header being passed correctly
 * - Fallback to profile config when no Retry-After
 * - Batch dispatch stopping on rate limit
 *
 * Requirements: 7.3
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import {
	RateLimitError,
	NetworkError,
	AuthenticationError,
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

// Mock connectors with proper class constructors
vi.mock('$lib/server/connectors', async () => {
	const errors = await import('../../src/lib/server/connectors/common/errors');
	return {
		// Create mock classes that return the mock instances
		SonarrClient: class MockSonarrClient {
			constructor() {
				return mockSonarrClient;
			}
		},
		RadarrClient: class MockRadarrClient {
			constructor() {
				return mockRadarrClient;
			}
		},
		WhisparrClient: class MockWhisparrClient {
			constructor() {
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
		handleRateLimitResponse: vi.fn()
	}
}));

// Now import the module and mocks
import { dispatchSearch, dispatchBatch } from '../../src/lib/server/services/queue/search-dispatcher';
import { getConnector, getDecryptedApiKey } from '$lib/server/db/queries/connectors';
import { throttleEnforcer } from '$lib/server/services/throttle';

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
	});

	describe('successful dispatch', () => {
		it('should dispatch episode search and record request', async () => {
			mockSonarrClient.sendEpisodeSearch.mockResolvedValue({ id: 123, status: 'queued' });

			const result = await dispatchSearch(1, 100, 'episode', 'gap', {
				episodeIds: [456, 457]
			});

			expect(result.success).toBe(true);
			expect(result.commandId).toBe(123);
			expect(throttleEnforcer.canDispatch).toHaveBeenCalledWith(1);
			expect(throttleEnforcer.recordRequest).toHaveBeenCalledWith(1);
			expect(mockSonarrClient.sendEpisodeSearch).toHaveBeenCalledWith([456, 457]);
		});

		it('should dispatch season search for Sonarr', async () => {
			mockSonarrClient.sendSeasonSearch.mockResolvedValue({ id: 124, status: 'queued' });

			const result = await dispatchSearch(1, 100, 'episode', 'gap', {
				seriesId: 10,
				seasonNumber: 2
			});

			expect(result.success).toBe(true);
			expect(result.commandId).toBe(124);
			expect(mockSonarrClient.sendSeasonSearch).toHaveBeenCalledWith(10, 2);
		});

		it('should dispatch movie search for Radarr', async () => {
			const radarrConnector = { ...mockConnector, type: 'radarr' };
			(getConnector as Mock).mockResolvedValue(radarrConnector);
			mockRadarrClient.sendMoviesSearch.mockResolvedValue({ id: 125, status: 'queued' });

			const result = await dispatchSearch(2, 200, 'movie', 'gap', {
				movieIds: [789]
			});

			expect(result.success).toBe(true);
			expect(result.commandId).toBe(125);
			expect(mockRadarrClient.sendMoviesSearch).toHaveBeenCalledWith([789]);
		});
	});

	describe('throttle enforcement', () => {
		it('should return throttled result when canDispatch returns false', async () => {
			(throttleEnforcer.canDispatch as Mock).mockResolvedValue({
				allowed: false,
				reason: 'rate_limit',
				retryAfterMs: 5000
			});

			const result = await dispatchSearch(1, 100, 'episode', 'gap', {
				episodeIds: [456]
			});

			expect(result.success).toBe(false);
			expect(result.error).toContain('Throttled');
			expect(result.rateLimited).toBe(true);
			expect(mockSonarrClient.sendEpisodeSearch).not.toHaveBeenCalled();
		});

		it('should indicate daily budget exhausted in result', async () => {
			(throttleEnforcer.canDispatch as Mock).mockResolvedValue({
				allowed: false,
				reason: 'daily_budget_exhausted',
				retryAfterMs: 60000
			});

			const result = await dispatchSearch(1, 100, 'episode', 'gap', {
				episodeIds: [456]
			});

			expect(result.success).toBe(false);
			expect(result.error).toContain('daily_budget_exhausted');
			expect(result.rateLimited).toBe(false);
		});
	});

	describe('HTTP 429 handling (Requirement 7.3)', () => {
		it('should call handleRateLimitResponse when RateLimitError is thrown', async () => {
			const rateLimitError = new RateLimitError(undefined);
			mockSonarrClient.sendEpisodeSearch.mockRejectedValue(rateLimitError);

			const result = await dispatchSearch(1, 100, 'episode', 'gap', {
				episodeIds: [456]
			});

			expect(result.success).toBe(false);
			expect(result.rateLimited).toBe(true);
			expect(result.connectorPaused).toBe(true);
			expect(result.error).toContain('Rate limited');
			expect(throttleEnforcer.handleRateLimitResponse).toHaveBeenCalledWith(1, undefined);
		});

		it('should pass Retry-After value to handleRateLimitResponse', async () => {
			// HTTP 429 with Retry-After: 120 header
			const rateLimitError = new RateLimitError(120);
			mockSonarrClient.sendEpisodeSearch.mockRejectedValue(rateLimitError);

			const result = await dispatchSearch(1, 100, 'episode', 'gap', {
				episodeIds: [456]
			});

			expect(result.success).toBe(false);
			expect(result.rateLimited).toBe(true);
			expect(result.connectorPaused).toBe(true);
			// Should pass 120 seconds to handleRateLimitResponse
			expect(throttleEnforcer.handleRateLimitResponse).toHaveBeenCalledWith(1, 120);
		});

		it('should handle Retry-After of 0 seconds', async () => {
			const rateLimitError = new RateLimitError(0);
			mockSonarrClient.sendEpisodeSearch.mockRejectedValue(rateLimitError);

			await dispatchSearch(1, 100, 'episode', 'gap', {
				episodeIds: [456]
			});

			// 0 is still passed - handleRateLimitResponse will use profile fallback
			expect(throttleEnforcer.handleRateLimitResponse).toHaveBeenCalledWith(1, 0);
		});

		it('should handle large Retry-After values', async () => {
			// Retry-After: 3600 (1 hour)
			const rateLimitError = new RateLimitError(3600);
			mockSonarrClient.sendEpisodeSearch.mockRejectedValue(rateLimitError);

			await dispatchSearch(1, 100, 'episode', 'gap', {
				episodeIds: [456]
			});

			expect(throttleEnforcer.handleRateLimitResponse).toHaveBeenCalledWith(1, 3600);
		});
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
			mockSonarrClient.sendEpisodeSearch.mockRejectedValue(new ServerError(503, 'Service Unavailable'));

			const result = await dispatchSearch(1, 100, 'episode', 'gap', {
				episodeIds: [456]
			});

			expect(result.success).toBe(false);
			expect(result.error).toContain('server');
			expect(throttleEnforcer.handleRateLimitResponse).not.toHaveBeenCalled();
		});

		it('should re-throw unknown errors', async () => {
			mockSonarrClient.sendEpisodeSearch.mockRejectedValue(new Error('Unknown error'));

			await expect(
				dispatchSearch(1, 100, 'episode', 'gap', { episodeIds: [456] })
			).rejects.toThrow('Unknown error');
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
});

describe('dispatchBatch', () => {
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

		(getConnector as Mock).mockResolvedValue(mockConnector);
		(getDecryptedApiKey as Mock).mockResolvedValue('decrypted-api-key');
		(throttleEnforcer.canDispatch as Mock).mockResolvedValue({ allowed: true });
		(throttleEnforcer.recordRequest as Mock).mockResolvedValue(undefined);
		(throttleEnforcer.handleRateLimitResponse as Mock).mockResolvedValue(undefined);
	});

	it('should dispatch all items successfully', async () => {
		mockSonarrClient.sendEpisodeSearch
			.mockResolvedValueOnce({ id: 1, status: 'queued' })
			.mockResolvedValueOnce({ id: 2, status: 'queued' })
			.mockResolvedValueOnce({ id: 3, status: 'queued' });

		const dispatches = [
			{ connectorId: 1, searchRegistryId: 100, contentType: 'episode' as const, searchType: 'gap' as const, options: { episodeIds: [1] } },
			{ connectorId: 1, searchRegistryId: 101, contentType: 'episode' as const, searchType: 'gap' as const, options: { episodeIds: [2] } },
			{ connectorId: 1, searchRegistryId: 102, contentType: 'episode' as const, searchType: 'gap' as const, options: { episodeIds: [3] } }
		];

		const results = await dispatchBatch(dispatches);

		expect(results).toHaveLength(3);
		expect(results.every((r) => r.success)).toBe(true);
	});

	it('should stop batch processing on rate limit and mark remaining as skipped', async () => {
		mockSonarrClient.sendEpisodeSearch
			.mockResolvedValueOnce({ id: 1, status: 'queued' }) // First succeeds
			.mockRejectedValueOnce(new RateLimitError(60)); // Second hits rate limit
		// Third never called

		const dispatches = [
			{ connectorId: 1, searchRegistryId: 100, contentType: 'episode' as const, searchType: 'gap' as const, options: { episodeIds: [1] } },
			{ connectorId: 1, searchRegistryId: 101, contentType: 'episode' as const, searchType: 'gap' as const, options: { episodeIds: [2] } },
			{ connectorId: 1, searchRegistryId: 102, contentType: 'episode' as const, searchType: 'gap' as const, options: { episodeIds: [3] } }
		];

		const results = await dispatchBatch(dispatches);

		expect(results).toHaveLength(3);

		// First succeeded
		expect(results[0]!.success).toBe(true);
		expect(results[0]!.commandId).toBe(1);

		// Second hit rate limit
		expect(results[1]!.success).toBe(false);
		expect(results[1]!.rateLimited).toBe(true);
		expect(results[1]!.connectorPaused).toBe(true);

		// Third was skipped
		expect(results[2]!.success).toBe(false);
		expect(results[2]!.rateLimited).toBe(true);
		expect(results[2]!.error).toContain('Skipped');

		// Verify handleRateLimitResponse was called only once
		expect(throttleEnforcer.handleRateLimitResponse).toHaveBeenCalledTimes(1);
		expect(throttleEnforcer.handleRateLimitResponse).toHaveBeenCalledWith(1, 60);
	});

	it('should continue processing on non-rate-limit errors', async () => {
		mockSonarrClient.sendEpisodeSearch
			.mockResolvedValueOnce({ id: 1, status: 'queued' }) // First succeeds
			.mockRejectedValueOnce(new NetworkError('Connection lost', 'timeout')) // Second fails with network error
			.mockResolvedValueOnce({ id: 3, status: 'queued' }); // Third succeeds

		const dispatches = [
			{ connectorId: 1, searchRegistryId: 100, contentType: 'episode' as const, searchType: 'gap' as const, options: { episodeIds: [1] } },
			{ connectorId: 1, searchRegistryId: 101, contentType: 'episode' as const, searchType: 'gap' as const, options: { episodeIds: [2] } },
			{ connectorId: 1, searchRegistryId: 102, contentType: 'episode' as const, searchType: 'gap' as const, options: { episodeIds: [3] } }
		];

		const results = await dispatchBatch(dispatches);

		expect(results).toHaveLength(3);
		expect(results[0]!.success).toBe(true);
		expect(results[1]!.success).toBe(false);
		expect(results[1]!.rateLimited).toBeUndefined();
		expect(results[2]!.success).toBe(true);
	});
});
