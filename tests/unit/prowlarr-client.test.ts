/**
 * Unit tests for ProwlarrClient
 *
 * Tests cover:
 * - Constructor behavior (URL normalization, default values)
 * - URL building (API v1 path)
 * - Request headers (X-Api-Key, User-Agent)
 * - Error handling (401, 404, 429, 5xx, network errors)
 * - ping() behavior
 * - getIndexerStatuses() parsing
 * - getIndexerHealth() rate-limit detection
 *

 */

import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import {
	AuthenticationError,
	NetworkError,
	NotFoundError,
	RateLimitError,
	ServerError,
	TimeoutError
} from '../../src/lib/server/connectors/common/errors';
import { ProwlarrClient } from '../../src/lib/server/services/prowlarr/client';

// Helper to create a mock fetch that satisfies TypeScript
function createMockFetch(impl: Mock): typeof fetch {
	return impl as unknown as typeof fetch;
}

describe('ProwlarrClient', () => {
	const validConfig = {
		baseUrl: 'http://localhost:9696',
		apiKey: 'test-api-key-12345'
	};

	let originalFetch: typeof fetch;

	beforeEach(() => {
		originalFetch = globalThis.fetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
	});

	describe('Constructor', () => {
		it('should initialize with required config', () => {
			const client = new ProwlarrClient(validConfig);
			// Client is created without errors - we verify behavior through methods
			expect(client).toBeDefined();
		});

		it('should remove trailing slash from baseUrl', async () => {
			let capturedUrl: string | undefined;

			globalThis.fetch = createMockFetch(
				vi.fn().mockImplementation(async (url: string) => {
					capturedUrl = url;
					return new Response('Pong', { status: 200 });
				})
			);

			const client = new ProwlarrClient({
				...validConfig,
				baseUrl: 'http://localhost:9696/'
			});

			await client.ping();

			// URL should not have double slashes
			expect(capturedUrl).toBe('http://localhost:9696/ping');
		});

		it('should remove multiple trailing slashes from baseUrl', async () => {
			let capturedUrl: string | undefined;

			globalThis.fetch = createMockFetch(
				vi.fn().mockImplementation(async (url: string) => {
					capturedUrl = url;
					return new Response('Pong', { status: 200 });
				})
			);

			const client = new ProwlarrClient({
				...validConfig,
				baseUrl: 'http://localhost:9696///'
			});

			await client.ping();

			expect(capturedUrl).toBe('http://localhost:9696/ping');
		});
	});

	describe('URL Building', () => {
		it('should build URL with API v1 prefix', async () => {
			let capturedUrl: string | undefined;

			globalThis.fetch = createMockFetch(
				vi.fn().mockImplementation(async (url: string) => {
					capturedUrl = url;
					return new Response(JSON.stringify([]), { status: 200 });
				})
			);

			const client = new ProwlarrClient(validConfig);
			await client.getIndexerStatuses();

			expect(capturedUrl).toBe('http://localhost:9696/api/v1/indexerstatus');
		});

		it('should handle endpoint with leading slash', async () => {
			let capturedUrl: string | undefined;

			globalThis.fetch = createMockFetch(
				vi.fn().mockImplementation(async (url: string) => {
					capturedUrl = url;
					return new Response(JSON.stringify([]), { status: 200 });
				})
			);

			const client = new ProwlarrClient(validConfig);
			await client.getIndexers();

			expect(capturedUrl).toBe('http://localhost:9696/api/v1/indexer');
		});
	});

	describe('Request Headers', () => {
		it('should include X-Api-Key header', async () => {
			let capturedHeaders: Headers | undefined;

			globalThis.fetch = createMockFetch(
				vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
					capturedHeaders = new Headers(init?.headers);
					return new Response(JSON.stringify([]), { status: 200 });
				})
			);

			const client = new ProwlarrClient(validConfig);
			await client.getIndexerStatuses();

			expect(capturedHeaders?.get('X-Api-Key')).toBe('test-api-key-12345');
		});

		it('should include default User-Agent header', async () => {
			let capturedHeaders: Headers | undefined;

			globalThis.fetch = createMockFetch(
				vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
					capturedHeaders = new Headers(init?.headers);
					return new Response(JSON.stringify([]), { status: 200 });
				})
			);

			const client = new ProwlarrClient(validConfig);
			await client.getIndexerStatuses();

			expect(capturedHeaders?.get('User-Agent')).toBe('Comradarr/1.0');
		});

		it('should include custom User-Agent when provided', async () => {
			let capturedHeaders: Headers | undefined;

			globalThis.fetch = createMockFetch(
				vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
					capturedHeaders = new Headers(init?.headers);
					return new Response(JSON.stringify([]), { status: 200 });
				})
			);

			const client = new ProwlarrClient({
				...validConfig,
				userAgent: 'CustomAgent/2.0'
			});
			await client.getIndexerStatuses();

			expect(capturedHeaders?.get('User-Agent')).toBe('CustomAgent/2.0');
		});

		it('should include Content-Type and Accept headers', async () => {
			let capturedHeaders: Headers | undefined;

			globalThis.fetch = createMockFetch(
				vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
					capturedHeaders = new Headers(init?.headers);
					return new Response(JSON.stringify([]), { status: 200 });
				})
			);

			const client = new ProwlarrClient(validConfig);
			await client.getIndexerStatuses();

			expect(capturedHeaders?.get('Content-Type')).toBe('application/json');
			expect(capturedHeaders?.get('Accept')).toBe('application/json');
		});
	});

	describe('Error Handling', () => {
		it('should throw AuthenticationError for HTTP 401', async () => {
			globalThis.fetch = createMockFetch(
				vi.fn().mockResolvedValue(new Response('Unauthorized', { status: 401 }))
			);

			const client = new ProwlarrClient(validConfig);

			await expect(client.getIndexerStatuses()).rejects.toThrow(AuthenticationError);
		});

		it('should throw NotFoundError for HTTP 404', async () => {
			globalThis.fetch = createMockFetch(
				vi.fn().mockResolvedValue(new Response('Not Found', { status: 404 }))
			);

			const client = new ProwlarrClient(validConfig);

			await expect(client.getIndexerStatuses()).rejects.toThrow(NotFoundError);
		});

		it('should throw RateLimitError for HTTP 429', async () => {
			globalThis.fetch = createMockFetch(
				vi.fn().mockResolvedValue(new Response('Too Many Requests', { status: 429 }))
			);

			const client = new ProwlarrClient(validConfig);

			await expect(client.getIndexerStatuses()).rejects.toThrow(RateLimitError);
		});

		it('should include Retry-After in RateLimitError', async () => {
			globalThis.fetch = createMockFetch(
				vi.fn().mockResolvedValue(
					new Response('Too Many Requests', {
						status: 429,
						headers: { 'Retry-After': '60' }
					})
				)
			);

			const client = new ProwlarrClient(validConfig);

			try {
				await client.getIndexerStatuses();
				expect.fail('Should have thrown RateLimitError');
			} catch (error) {
				expect(error).toBeInstanceOf(RateLimitError);
				expect((error as RateLimitError).retryAfter).toBe(60);
			}
		});

		it('should throw ServerError for HTTP 5xx', async () => {
			globalThis.fetch = createMockFetch(
				vi.fn().mockResolvedValue(new Response('Internal Server Error', { status: 500 }))
			);

			const client = new ProwlarrClient(validConfig);

			await expect(client.getIndexerStatuses()).rejects.toThrow(ServerError);
		});

		it('should throw NetworkError for connection refused', async () => {
			globalThis.fetch = createMockFetch(vi.fn().mockRejectedValue(new TypeError('fetch failed')));

			const client = new ProwlarrClient(validConfig);

			await expect(client.getIndexerStatuses()).rejects.toThrow(NetworkError);
		});

		it('should throw TimeoutError when request times out', async () => {
			globalThis.fetch = createMockFetch(
				vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError'))
			);

			const client = new ProwlarrClient(validConfig);

			await expect(client.getIndexerStatuses()).rejects.toThrow(TimeoutError);
		});
	});

	describe('ping()', () => {
		it('should return true when Prowlarr responds OK', async () => {
			globalThis.fetch = createMockFetch(
				vi.fn().mockResolvedValue(new Response('Pong', { status: 200 }))
			);

			const client = new ProwlarrClient(validConfig);
			const result = await client.ping();

			expect(result).toBe(true);
		});

		it('should return false when Prowlarr returns error status', async () => {
			globalThis.fetch = createMockFetch(
				vi.fn().mockResolvedValue(new Response('Unauthorized', { status: 401 }))
			);

			const client = new ProwlarrClient(validConfig);
			const result = await client.ping();

			expect(result).toBe(false);
		});

		it('should return false when network error occurs', async () => {
			globalThis.fetch = createMockFetch(vi.fn().mockRejectedValue(new TypeError('fetch failed')));

			const client = new ProwlarrClient(validConfig);
			const result = await client.ping();

			expect(result).toBe(false);
		});

		it('should call /ping endpoint directly (not /api/v1/ping)', async () => {
			let capturedUrl: string | undefined;

			globalThis.fetch = createMockFetch(
				vi.fn().mockImplementation(async (url: string) => {
					capturedUrl = url;
					return new Response('Pong', { status: 200 });
				})
			);

			const client = new ProwlarrClient(validConfig);
			await client.ping();

			expect(capturedUrl).toBe('http://localhost:9696/ping');
		});
	});

	describe('getIndexerStatuses()', () => {
		it('should parse valid indexer status array', async () => {
			const mockStatuses = [
				{
					id: 1,
					indexerId: 10,
					disabledTill: null,
					mostRecentFailure: null,
					initialFailure: null
				},
				{
					id: 2,
					indexerId: 20,
					disabledTill: '2025-12-01T00:00:00Z',
					mostRecentFailure: '2025-11-30T12:00:00Z',
					initialFailure: '2025-11-30T10:00:00Z'
				}
			];

			globalThis.fetch = createMockFetch(
				vi.fn().mockResolvedValue(new Response(JSON.stringify(mockStatuses), { status: 200 }))
			);

			const client = new ProwlarrClient(validConfig);
			const statuses = await client.getIndexerStatuses();

			expect(statuses).toHaveLength(2);
			expect(statuses[0]).toEqual({
				id: 1,
				indexerId: 10,
				disabledTill: null,
				mostRecentFailure: null,
				initialFailure: null
			});
			expect(statuses[1]).toEqual({
				id: 2,
				indexerId: 20,
				disabledTill: '2025-12-01T00:00:00Z',
				mostRecentFailure: '2025-11-30T12:00:00Z',
				initialFailure: '2025-11-30T10:00:00Z'
			});
		});

		it('should return empty array for empty response', async () => {
			globalThis.fetch = createMockFetch(
				vi.fn().mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }))
			);

			const client = new ProwlarrClient(validConfig);
			const statuses = await client.getIndexerStatuses();

			expect(statuses).toHaveLength(0);
		});

		it('should skip malformed records', async () => {
			const mockStatuses = [
				{
					id: 1,
					indexerId: 10,
					disabledTill: null,
					mostRecentFailure: null,
					initialFailure: null
				},
				{
					// Missing required field indexerId
					id: 2,
					disabledTill: null
				},
				{
					id: 3,
					indexerId: 30,
					disabledTill: null,
					mostRecentFailure: null,
					initialFailure: null
				}
			];

			globalThis.fetch = createMockFetch(
				vi.fn().mockResolvedValue(new Response(JSON.stringify(mockStatuses), { status: 200 }))
			);

			const client = new ProwlarrClient(validConfig);
			const statuses = await client.getIndexerStatuses();

			// Should only return the 2 valid records
			expect(statuses).toHaveLength(2);
			expect(statuses[0]?.indexerId).toBe(10);
			expect(statuses[1]?.indexerId).toBe(30);
		});
	});

	describe('getIndexers()', () => {
		it('should parse valid indexer array', async () => {
			const mockIndexers = [
				{
					id: 10,
					name: 'NZBgeek',
					implementation: 'Newznab',
					enable: true,
					protocol: 'usenet',
					priority: 25
				},
				{
					id: 20,
					name: '1337x',
					implementation: 'Torznab',
					enable: false,
					protocol: 'torrent',
					priority: 50
				}
			];

			globalThis.fetch = createMockFetch(
				vi.fn().mockResolvedValue(new Response(JSON.stringify(mockIndexers), { status: 200 }))
			);

			const client = new ProwlarrClient(validConfig);
			const indexers = await client.getIndexers();

			expect(indexers).toHaveLength(2);
			expect(indexers[0]).toEqual({
				id: 10,
				name: 'NZBgeek',
				implementation: 'Newznab',
				enable: true,
				protocol: 'usenet',
				priority: 25
			});
		});
	});

	describe('getIndexerHealth()', () => {
		it('should combine indexers with statuses', async () => {
			const mockIndexers = [
				{
					id: 10,
					name: 'NZBgeek',
					implementation: 'Newznab',
					enable: true,
					protocol: 'usenet',
					priority: 25
				}
			];

			const mockStatuses = [
				{
					id: 1,
					indexerId: 10,
					disabledTill: null,
					mostRecentFailure: null,
					initialFailure: null
				}
			];

			let _callCount = 0;
			globalThis.fetch = createMockFetch(
				vi.fn().mockImplementation(async (url: string) => {
					_callCount++;
					if (url.includes('indexerstatus')) {
						return new Response(JSON.stringify(mockStatuses), { status: 200 });
					}
					return new Response(JSON.stringify(mockIndexers), { status: 200 });
				})
			);

			const client = new ProwlarrClient(validConfig);
			const health = await client.getIndexerHealth();

			expect(health).toHaveLength(1);
			expect(health[0]).toMatchObject({
				indexerId: 10,
				name: 'NZBgeek',
				isRateLimited: false,
				enabled: true
			});
		});

		it('should detect rate-limited indexers when disabledTill is in future', async () => {
			const futureDate = new Date(Date.now() + 3600000).toISOString(); // 1 hour from now

			const mockIndexers = [
				{
					id: 10,
					name: 'NZBgeek',
					implementation: 'Newznab',
					enable: true,
					protocol: 'usenet',
					priority: 25
				}
			];

			const mockStatuses = [
				{
					id: 1,
					indexerId: 10,
					disabledTill: futureDate,
					mostRecentFailure: null,
					initialFailure: null
				}
			];

			globalThis.fetch = createMockFetch(
				vi.fn().mockImplementation(async (url: string) => {
					if (url.includes('indexerstatus')) {
						return new Response(JSON.stringify(mockStatuses), { status: 200 });
					}
					return new Response(JSON.stringify(mockIndexers), { status: 200 });
				})
			);

			const client = new ProwlarrClient(validConfig);
			const health = await client.getIndexerHealth();

			expect(health[0]?.isRateLimited).toBe(true);
			expect(health[0]?.rateLimitExpiresAt).not.toBeNull();
		});

		it('should not mark as rate-limited when disabledTill is in past', async () => {
			const pastDate = new Date(Date.now() - 3600000).toISOString(); // 1 hour ago

			const mockIndexers = [
				{
					id: 10,
					name: 'NZBgeek',
					implementation: 'Newznab',
					enable: true,
					protocol: 'usenet',
					priority: 25
				}
			];

			const mockStatuses = [
				{
					id: 1,
					indexerId: 10,
					disabledTill: pastDate,
					mostRecentFailure: null,
					initialFailure: null
				}
			];

			globalThis.fetch = createMockFetch(
				vi.fn().mockImplementation(async (url: string) => {
					if (url.includes('indexerstatus')) {
						return new Response(JSON.stringify(mockStatuses), { status: 200 });
					}
					return new Response(JSON.stringify(mockIndexers), { status: 200 });
				})
			);

			const client = new ProwlarrClient(validConfig);
			const health = await client.getIndexerHealth();

			expect(health[0]?.isRateLimited).toBe(false);
			expect(health[0]?.rateLimitExpiresAt).toBeNull();
		});

		it('should handle indexers without status entries', async () => {
			const mockIndexers = [
				{
					id: 10,
					name: 'NZBgeek',
					implementation: 'Newznab',
					enable: true,
					protocol: 'usenet',
					priority: 25
				},
				{
					id: 20,
					name: '1337x',
					implementation: 'Torznab',
					enable: true,
					protocol: 'torrent',
					priority: 50
				}
			];

			const mockStatuses: unknown[] = []; // No status entries

			globalThis.fetch = createMockFetch(
				vi.fn().mockImplementation(async (url: string) => {
					if (url.includes('indexerstatus')) {
						return new Response(JSON.stringify(mockStatuses), { status: 200 });
					}
					return new Response(JSON.stringify(mockIndexers), { status: 200 });
				})
			);

			const client = new ProwlarrClient(validConfig);
			const health = await client.getIndexerHealth();

			expect(health).toHaveLength(2);
			expect(health[0]?.isRateLimited).toBe(false);
			expect(health[1]?.isRateLimited).toBe(false);
		});
	});
});
