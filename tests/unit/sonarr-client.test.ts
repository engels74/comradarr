/**
 * Unit tests for SonarrClient
 *
 * Tests cover:
 * - Constructor inheritance from BaseArrClient
 * - Inherited methods (ping, getSystemStatus, getHealth)
 * - Library data methods (getSeries, getEpisodes)
 *
 * @requirements 1.2, 1.3, 1.4, 24.1, 24.2
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { SonarrClient } from '../../src/lib/server/connectors/index';

// Helper to create a mock fetch that satisfies TypeScript
function createMockFetch(impl: Mock): typeof fetch {
	return impl as unknown as typeof fetch;
}

describe('SonarrClient', () => {
	const validConfig = {
		baseUrl: 'http://localhost:8989',
		apiKey: 'test-api-key-12345'
	};

	describe('Constructor', () => {
		it('should create instance with valid config', () => {
			const client = new SonarrClient(validConfig);

			expect(client).toBeInstanceOf(SonarrClient);
		});

		it('should accept optional timeout parameter', () => {
			const client = new SonarrClient({
				...validConfig,
				timeout: 60000
			});

			expect(client).toBeInstanceOf(SonarrClient);
		});

		it('should accept optional userAgent parameter', () => {
			const client = new SonarrClient({
				...validConfig,
				userAgent: 'TestAgent/1.0'
			});

			expect(client).toBeInstanceOf(SonarrClient);
		});

		it('should accept optional retry configuration', () => {
			const client = new SonarrClient({
				...validConfig,
				retry: {
					maxRetries: 5,
					baseDelay: 500
				}
			});

			expect(client).toBeInstanceOf(SonarrClient);
		});
	});
});

describe('SonarrClient.ping()', () => {
	const validConfig = {
		baseUrl: 'http://localhost:8989',
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

	it('should return true when Sonarr server responds OK', async () => {
		globalThis.fetch = createMockFetch(
			vi.fn().mockResolvedValue(new Response('Pong', { status: 200 }))
		);

		const client = new SonarrClient(validConfig);
		const result = await client.ping();

		expect(result).toBe(true);
	});

	it('should return false when Sonarr server returns error', async () => {
		globalThis.fetch = createMockFetch(
			vi.fn().mockResolvedValue(new Response('Unauthorized', { status: 401 }))
		);

		const client = new SonarrClient(validConfig);
		const result = await client.ping();

		expect(result).toBe(false);
	});

	it('should return false when network error occurs', async () => {
		globalThis.fetch = createMockFetch(vi.fn().mockRejectedValue(new TypeError('fetch failed')));

		const client = new SonarrClient(validConfig);
		const result = await client.ping();

		expect(result).toBe(false);
	});

	it('should call /ping endpoint (not /api/v3/ping)', async () => {
		let capturedUrl: string | undefined;

		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async (url: string) => {
				capturedUrl = url;
				return new Response('Pong', { status: 200 });
			})
		);

		const client = new SonarrClient(validConfig);
		await client.ping();

		expect(capturedUrl).toBe('http://localhost:8989/ping');
	});

	it('should include X-Api-Key header in ping request', async () => {
		let capturedHeaders: Headers | undefined;

		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
				capturedHeaders = new Headers(init?.headers);
				return new Response('Pong', { status: 200 });
			})
		);

		const client = new SonarrClient(validConfig);
		await client.ping();

		expect(capturedHeaders?.get('X-Api-Key')).toBe('test-api-key-12345');
	});
});

describe('SonarrClient.getSystemStatus()', () => {
	const validConfig = {
		baseUrl: 'http://localhost:8989',
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

	it('should return system status from Sonarr', async () => {
		const mockStatus = {
			appName: 'Sonarr',
			instanceName: 'Sonarr',
			version: '4.0.0.123',
			buildTime: '2024-01-15T00:00:00Z',
			isDebug: false,
			isProduction: true,
			isAdmin: false,
			isUserInteractive: false,
			startupPath: '/app',
			appData: '/config',
			osName: 'Linux',
			osVersion: '5.15.0',
			isDocker: true,
			isMono: false,
			isLinux: true,
			isOsx: false,
			isWindows: false,
			branch: 'main',
			authentication: 'forms',
			sqliteVersion: '3.36.0',
			urlBase: '',
			runtimeVersion: 'bun 1.0.0',
			runtimeName: 'bun',
			startTime: '2024-01-15T10:00:00Z'
		};

		globalThis.fetch = createMockFetch(
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify(mockStatus), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				})
			)
		);

		const client = new SonarrClient(validConfig);
		const result = await client.getSystemStatus();

		expect(result.appName).toBe('Sonarr');
		expect(result.version).toBe('4.0.0.123');
		expect(result.isDocker).toBe(true);
	});

	it('should call /api/v3/system/status endpoint', async () => {
		let capturedUrl: string | undefined;

		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async (url: string) => {
				capturedUrl = url;
				return new Response(JSON.stringify({ appName: 'Sonarr', version: '4.0.0' }), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				});
			})
		);

		const client = new SonarrClient(validConfig);
		await client.getSystemStatus();

		expect(capturedUrl).toBe('http://localhost:8989/api/v3/system/status');
	});

	it('should include X-Api-Key header', async () => {
		let capturedHeaders: Headers | undefined;

		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
				capturedHeaders = new Headers(init?.headers);
				return new Response(JSON.stringify({ appName: 'Sonarr' }), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				});
			})
		);

		const client = new SonarrClient(validConfig);
		await client.getSystemStatus();

		expect(capturedHeaders?.get('X-Api-Key')).toBe('test-api-key-12345');
	});
});

describe('SonarrClient.getHealth()', () => {
	const validConfig = {
		baseUrl: 'http://localhost:8989',
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

	it('should return health check results from Sonarr', async () => {
		const mockHealth = [
			{
				source: 'IndexerStatusCheck',
				type: 'warning',
				message: 'Indexers unavailable due to failures',
				wikiUrl: 'https://wiki.servarr.com'
			},
			{
				source: 'DownloadClientCheck',
				type: 'ok',
				message: ''
			}
		];

		globalThis.fetch = createMockFetch(
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify(mockHealth), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				})
			)
		);

		const client = new SonarrClient(validConfig);
		const result = await client.getHealth();

		expect(result).toHaveLength(2);
		expect(result[0]?.source).toBe('IndexerStatusCheck');
		expect(result[0]?.type).toBe('warning');
		expect(result[1]?.type).toBe('ok');
	});

	it('should return empty array when Sonarr is healthy', async () => {
		globalThis.fetch = createMockFetch(
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify([]), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				})
			)
		);

		const client = new SonarrClient(validConfig);
		const result = await client.getHealth();

		expect(result).toEqual([]);
	});

	it('should call /api/v3/health endpoint', async () => {
		let capturedUrl: string | undefined;

		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async (url: string) => {
				capturedUrl = url;
				return new Response(JSON.stringify([]), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				});
			})
		);

		const client = new SonarrClient(validConfig);
		await client.getHealth();

		expect(capturedUrl).toBe('http://localhost:8989/api/v3/health');
	});

	it('should include X-Api-Key header', async () => {
		let capturedHeaders: Headers | undefined;

		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
				capturedHeaders = new Headers(init?.headers);
				return new Response(JSON.stringify([]), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				});
			})
		);

		const client = new SonarrClient(validConfig);
		await client.getHealth();

		expect(capturedHeaders?.get('X-Api-Key')).toBe('test-api-key-12345');
	});
});

describe('SonarrClient.getSeries()', () => {
	const validConfig = {
		baseUrl: 'http://localhost:8989',
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

	it('should return array of series from Sonarr', async () => {
		const mockSeries = [
			{
				id: 1,
				title: 'Breaking Bad',
				tvdbId: 81189,
				status: 'ended',
				monitored: true,
				qualityProfileId: 1,
				seasons: [
					{ seasonNumber: 0, monitored: false },
					{ seasonNumber: 1, monitored: true }
				]
			},
			{
				id: 2,
				title: 'Game of Thrones',
				tvdbId: 121361,
				status: 'ended',
				monitored: true,
				qualityProfileId: 2,
				seasons: [
					{ seasonNumber: 1, monitored: true }
				]
			}
		];

		globalThis.fetch = createMockFetch(
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify(mockSeries), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				})
			)
		);

		const client = new SonarrClient(validConfig);
		const result = await client.getSeries();

		expect(result).toHaveLength(2);
		expect(result[0]?.title).toBe('Breaking Bad');
		expect(result[0]?.tvdbId).toBe(81189);
		expect(result[0]?.seasons).toHaveLength(2);
		expect(result[1]?.title).toBe('Game of Thrones');
	});

	it('should return empty array when no series exist', async () => {
		globalThis.fetch = createMockFetch(
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify([]), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				})
			)
		);

		const client = new SonarrClient(validConfig);
		const result = await client.getSeries();

		expect(result).toEqual([]);
	});

	it('should call /api/v3/series endpoint', async () => {
		let capturedUrl: string | undefined;

		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async (url: string) => {
				capturedUrl = url;
				return new Response(JSON.stringify([]), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				});
			})
		);

		const client = new SonarrClient(validConfig);
		await client.getSeries();

		expect(capturedUrl).toBe('http://localhost:8989/api/v3/series');
	});

	it('should include X-Api-Key header', async () => {
		let capturedHeaders: Headers | undefined;

		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
				capturedHeaders = new Headers(init?.headers);
				return new Response(JSON.stringify([]), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				});
			})
		);

		const client = new SonarrClient(validConfig);
		await client.getSeries();

		expect(capturedHeaders?.get('X-Api-Key')).toBe('test-api-key-12345');
	});

	it('should skip malformed series records', async () => {
		const mockSeries = [
			{
				id: 1,
				title: 'Valid Series',
				tvdbId: 12345,
				status: 'continuing',
				monitored: true,
				qualityProfileId: 1,
				seasons: []
			},
			{
				// Invalid: missing required fields
				id: 2,
				title: 'Missing fields'
				// No tvdbId, status, monitored, etc.
			},
			{
				id: 3,
				title: 'Another Valid Series',
				tvdbId: 67890,
				status: 'ended',
				monitored: false,
				qualityProfileId: 2,
				seasons: []
			}
		];

		globalThis.fetch = createMockFetch(
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify(mockSeries), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				})
			)
		);

		const client = new SonarrClient(validConfig);
		const result = await client.getSeries();

		// Should only return valid series, skipping the malformed one
		expect(result).toHaveLength(2);
		expect(result[0]?.title).toBe('Valid Series');
		expect(result[1]?.title).toBe('Another Valid Series');
	});
});

describe('SonarrClient.getEpisodes()', () => {
	const validConfig = {
		baseUrl: 'http://localhost:8989',
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

	it('should return array of episodes for a series', async () => {
		const mockEpisodes = [
			{
				id: 101,
				seriesId: 1,
				seasonNumber: 1,
				episodeNumber: 1,
				title: 'Pilot',
				airDateUtc: '2008-01-20T00:00:00Z',
				hasFile: true,
				monitored: true,
				qualityCutoffNotMet: false
			},
			{
				id: 102,
				seriesId: 1,
				seasonNumber: 1,
				episodeNumber: 2,
				title: 'Cat in the Bag',
				airDateUtc: '2008-01-27T00:00:00Z',
				hasFile: true,
				monitored: true,
				qualityCutoffNotMet: true
			}
		];

		globalThis.fetch = createMockFetch(
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify(mockEpisodes), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				})
			)
		);

		const client = new SonarrClient(validConfig);
		const result = await client.getEpisodes(1);

		expect(result).toHaveLength(2);
		expect(result[0]?.title).toBe('Pilot');
		expect(result[0]?.seasonNumber).toBe(1);
		expect(result[0]?.episodeNumber).toBe(1);
		expect(result[0]?.hasFile).toBe(true);
		expect(result[1]?.qualityCutoffNotMet).toBe(true);
	});

	it('should return empty array when series has no episodes', async () => {
		globalThis.fetch = createMockFetch(
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify([]), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				})
			)
		);

		const client = new SonarrClient(validConfig);
		const result = await client.getEpisodes(999);

		expect(result).toEqual([]);
	});

	it('should call /api/v3/episode with seriesId query parameter', async () => {
		let capturedUrl: string | undefined;

		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async (url: string) => {
				capturedUrl = url;
				return new Response(JSON.stringify([]), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				});
			})
		);

		const client = new SonarrClient(validConfig);
		await client.getEpisodes(123);

		expect(capturedUrl).toBe('http://localhost:8989/api/v3/episode?seriesId=123');
	});

	it('should include X-Api-Key header', async () => {
		let capturedHeaders: Headers | undefined;

		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
				capturedHeaders = new Headers(init?.headers);
				return new Response(JSON.stringify([]), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				});
			})
		);

		const client = new SonarrClient(validConfig);
		await client.getEpisodes(1);

		expect(capturedHeaders?.get('X-Api-Key')).toBe('test-api-key-12345');
	});

	it('should skip malformed episode records', async () => {
		const mockEpisodes = [
			{
				id: 101,
				seriesId: 1,
				seasonNumber: 1,
				episodeNumber: 1,
				hasFile: true,
				monitored: true,
				qualityCutoffNotMet: false
			},
			{
				// Invalid: missing required fields
				id: 102,
				seriesId: 1
				// Missing seasonNumber, episodeNumber, etc.
			},
			{
				id: 103,
				seriesId: 1,
				seasonNumber: 1,
				episodeNumber: 3,
				hasFile: false,
				monitored: true,
				qualityCutoffNotMet: false
			}
		];

		globalThis.fetch = createMockFetch(
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify(mockEpisodes), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				})
			)
		);

		const client = new SonarrClient(validConfig);
		const result = await client.getEpisodes(1);

		// Should only return valid episodes, skipping the malformed one
		expect(result).toHaveLength(2);
		expect(result[0]?.episodeNumber).toBe(1);
		expect(result[1]?.episodeNumber).toBe(3);
	});

	it('should handle episodes with optional fields', async () => {
		const mockEpisodes = [
			{
				id: 101,
				seriesId: 1,
				seasonNumber: 1,
				episodeNumber: 1,
				hasFile: false,
				monitored: true,
				qualityCutoffNotMet: false
				// No title, no airDateUtc - these are optional
			}
		];

		globalThis.fetch = createMockFetch(
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify(mockEpisodes), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				})
			)
		);

		const client = new SonarrClient(validConfig);
		const result = await client.getEpisodes(1);

		expect(result).toHaveLength(1);
		expect(result[0]?.id).toBe(101);
		expect(result[0]?.title).toBeUndefined();
		expect(result[0]?.airDateUtc).toBeUndefined();
	});
});
