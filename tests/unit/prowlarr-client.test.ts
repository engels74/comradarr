import { describe, expect, it, vi } from 'vitest';
import { ProwlarrClient } from '../../src/lib/server/services/prowlarr/client';
import {
	createMockFetch,
	mockJsonResponse,
	setupFetchMock,
	testPingBehavior
} from './helpers/client-test-utils';

const validConfig = {
	baseUrl: 'http://localhost:9696',
	apiKey: 'test-api-key-12345'
};

describe('ProwlarrClient', () => {
	setupFetchMock();

	describe('Constructor', () => {
		it('should initialize with required config', () => {
			const client = new ProwlarrClient(validConfig);
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
			const client = new ProwlarrClient({ ...validConfig, baseUrl: 'http://localhost:9696/' });
			await client.ping();
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
			const client = new ProwlarrClient({ ...validConfig, baseUrl: 'http://localhost:9696///' });
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
					return mockJsonResponse([]);
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
					return mockJsonResponse([]);
				})
			);
			const client = new ProwlarrClient(validConfig);
			await client.getIndexers();
			expect(capturedUrl).toBe('http://localhost:9696/api/v1/indexer');
		});
	});

	describe('ping()', () => {
		testPingBehavior({
			ClientClass: ProwlarrClient,
			baseUrl: validConfig.baseUrl,
			apiKey: validConfig.apiKey
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

			globalThis.fetch = createMockFetch(vi.fn().mockResolvedValue(mockJsonResponse(mockStatuses)));
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
			globalThis.fetch = createMockFetch(vi.fn().mockResolvedValue(mockJsonResponse([])));
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
				{ id: 2, disabledTill: null },
				{
					id: 3,
					indexerId: 30,
					disabledTill: null,
					mostRecentFailure: null,
					initialFailure: null
				}
			];

			globalThis.fetch = createMockFetch(vi.fn().mockResolvedValue(mockJsonResponse(mockStatuses)));
			const client = new ProwlarrClient(validConfig);
			const statuses = await client.getIndexerStatuses();

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

			globalThis.fetch = createMockFetch(vi.fn().mockResolvedValue(mockJsonResponse(mockIndexers)));
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

			globalThis.fetch = createMockFetch(
				vi.fn().mockImplementation(async (url: string) => {
					if (url.includes('indexerstatus')) {
						return mockJsonResponse(mockStatuses);
					}
					return mockJsonResponse(mockIndexers);
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
			const futureDate = new Date(Date.now() + 3600000).toISOString();
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
						return mockJsonResponse(mockStatuses);
					}
					return mockJsonResponse(mockIndexers);
				})
			);

			const client = new ProwlarrClient(validConfig);
			const health = await client.getIndexerHealth();

			expect(health[0]?.isRateLimited).toBe(true);
			expect(health[0]?.rateLimitExpiresAt).not.toBeNull();
		});

		it('should not mark as rate-limited when disabledTill is in past', async () => {
			const pastDate = new Date(Date.now() - 3600000).toISOString();
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
						return mockJsonResponse(mockStatuses);
					}
					return mockJsonResponse(mockIndexers);
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
			const mockStatuses: unknown[] = [];

			globalThis.fetch = createMockFetch(
				vi.fn().mockImplementation(async (url: string) => {
					if (url.includes('indexerstatus')) {
						return mockJsonResponse(mockStatuses);
					}
					return mockJsonResponse(mockIndexers);
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
