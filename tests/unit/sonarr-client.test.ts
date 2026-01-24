/**
 * Unit tests for SonarrClient
 *
 * Tests cover:
 * - Constructor inheritance from BaseArrClient
 * - Inherited methods (ping, getSystemStatus, getHealth)
 * - Library data methods (getSeries, getEpisodes)
 *

 */

import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
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
				seasons: [{ seasonNumber: 1, monitored: true }]
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

describe('SonarrClient.getWantedMissing()', () => {
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

	it('should return array of missing episodes from Sonarr', async () => {
		const mockResponse = {
			page: 1,
			pageSize: 1000,
			sortKey: 'airDateUtc',
			sortDirection: 'descending',
			totalRecords: 2,
			records: [
				{
					id: 101,
					seriesId: 1,
					seasonNumber: 1,
					episodeNumber: 1,
					title: 'Pilot',
					airDateUtc: '2008-01-20T00:00:00Z',
					hasFile: false,
					monitored: true,
					qualityCutoffNotMet: false
				},
				{
					id: 102,
					seriesId: 1,
					seasonNumber: 1,
					episodeNumber: 2,
					title: 'Second Episode',
					airDateUtc: '2008-01-27T00:00:00Z',
					hasFile: false,
					monitored: true,
					qualityCutoffNotMet: false
				}
			]
		};

		globalThis.fetch = createMockFetch(
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify(mockResponse), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				})
			)
		);

		const client = new SonarrClient(validConfig);
		const result = await client.getWantedMissing();

		expect(result).toHaveLength(2);
		expect(result[0]?.title).toBe('Pilot');
		expect(result[0]?.hasFile).toBe(false);
		expect(result[1]?.title).toBe('Second Episode');
	});

	it('should return empty array when no missing episodes exist', async () => {
		const mockResponse = {
			page: 1,
			pageSize: 1000,
			sortKey: 'airDateUtc',
			sortDirection: 'descending',
			totalRecords: 0,
			records: []
		};

		globalThis.fetch = createMockFetch(
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify(mockResponse), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				})
			)
		);

		const client = new SonarrClient(validConfig);
		const result = await client.getWantedMissing();

		expect(result).toEqual([]);
	});

	it('should call /api/v3/wanted/missing with correct query parameters', async () => {
		let capturedUrl: string | undefined;

		const mockResponse = {
			page: 1,
			pageSize: 1000,
			sortKey: 'airDateUtc',
			sortDirection: 'descending',
			totalRecords: 0,
			records: []
		};

		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async (url: string) => {
				capturedUrl = url;
				return new Response(JSON.stringify(mockResponse), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				});
			})
		);

		const client = new SonarrClient(validConfig);
		await client.getWantedMissing();

		expect(capturedUrl).toContain('/api/v3/wanted/missing');
		expect(capturedUrl).toContain('page=1');
		expect(capturedUrl).toContain('pageSize=1000');
		expect(capturedUrl).toContain('monitored=true');
	});

	it('should use custom options when provided', async () => {
		let capturedUrl: string | undefined;

		const mockResponse = {
			page: 2,
			pageSize: 50,
			sortKey: 'seriesTitle',
			sortDirection: 'ascending',
			totalRecords: 50,
			records: []
		};

		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async (url: string) => {
				capturedUrl = url;
				return new Response(JSON.stringify(mockResponse), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				});
			})
		);

		const client = new SonarrClient(validConfig);
		await client.getWantedMissing({
			page: 2,
			pageSize: 50,
			sortKey: 'seriesTitle',
			sortDirection: 'ascending',
			monitored: false
		});

		expect(capturedUrl).toContain('page=2');
		expect(capturedUrl).toContain('pageSize=50');
		expect(capturedUrl).toContain('sortKey=seriesTitle');
		expect(capturedUrl).toContain('sortDirection=ascending');
		expect(capturedUrl).toContain('monitored=false');
	});

	it('should handle pagination across multiple pages', async () => {
		let callCount = 0;

		const page1Response = {
			page: 1,
			pageSize: 2,
			sortKey: 'airDateUtc',
			sortDirection: 'descending',
			totalRecords: 5,
			records: [
				{
					id: 1,
					seriesId: 1,
					seasonNumber: 1,
					episodeNumber: 1,
					hasFile: false,
					monitored: true,
					qualityCutoffNotMet: false
				},
				{
					id: 2,
					seriesId: 1,
					seasonNumber: 1,
					episodeNumber: 2,
					hasFile: false,
					monitored: true,
					qualityCutoffNotMet: false
				}
			]
		};

		const page2Response = {
			page: 2,
			pageSize: 2,
			sortKey: 'airDateUtc',
			sortDirection: 'descending',
			totalRecords: 5,
			records: [
				{
					id: 3,
					seriesId: 1,
					seasonNumber: 1,
					episodeNumber: 3,
					hasFile: false,
					monitored: true,
					qualityCutoffNotMet: false
				},
				{
					id: 4,
					seriesId: 1,
					seasonNumber: 1,
					episodeNumber: 4,
					hasFile: false,
					monitored: true,
					qualityCutoffNotMet: false
				}
			]
		};

		const page3Response = {
			page: 3,
			pageSize: 2,
			sortKey: 'airDateUtc',
			sortDirection: 'descending',
			totalRecords: 5,
			records: [
				{
					id: 5,
					seriesId: 1,
					seasonNumber: 1,
					episodeNumber: 5,
					hasFile: false,
					monitored: true,
					qualityCutoffNotMet: false
				}
			]
		};

		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async () => {
				callCount++;
				let response: typeof page1Response;
				if (callCount === 1) response = page1Response;
				else if (callCount === 2) response = page2Response;
				else response = page3Response;

				return new Response(JSON.stringify(response), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				});
			})
		);

		const client = new SonarrClient(validConfig);
		const result = await client.getWantedMissing({ pageSize: 2 });

		expect(callCount).toBe(3); // Should make 3 requests to get all 5 items
		expect(result).toHaveLength(5);
		expect(result[0]?.id).toBe(1);
		expect(result[4]?.id).toBe(5);
	});

	it('should skip malformed episode records', async () => {
		const mockResponse = {
			page: 1,
			pageSize: 1000,
			sortKey: 'airDateUtc',
			sortDirection: 'descending',
			totalRecords: 3,
			records: [
				{
					id: 1,
					seriesId: 1,
					seasonNumber: 1,
					episodeNumber: 1,
					hasFile: false,
					monitored: true,
					qualityCutoffNotMet: false
				},
				{ id: 2, seriesId: 1 }, // Invalid: missing required fields
				{
					id: 3,
					seriesId: 1,
					seasonNumber: 1,
					episodeNumber: 3,
					hasFile: false,
					monitored: true,
					qualityCutoffNotMet: false
				}
			]
		};

		globalThis.fetch = createMockFetch(
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify(mockResponse), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				})
			)
		);

		const client = new SonarrClient(validConfig);
		const result = await client.getWantedMissing();

		// Should skip the malformed record
		expect(result).toHaveLength(2);
		expect(result[0]?.id).toBe(1);
		expect(result[1]?.id).toBe(3);
	});

	it('should include X-Api-Key header', async () => {
		let capturedHeaders: Headers | undefined;

		const mockResponse = {
			page: 1,
			pageSize: 1000,
			sortKey: 'airDateUtc',
			sortDirection: 'descending',
			totalRecords: 0,
			records: []
		};

		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
				capturedHeaders = new Headers(init?.headers);
				return new Response(JSON.stringify(mockResponse), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				});
			})
		);

		const client = new SonarrClient(validConfig);
		await client.getWantedMissing();

		expect(capturedHeaders?.get('X-Api-Key')).toBe('test-api-key-12345');
	});
});

describe('SonarrClient.getWantedCutoff()', () => {
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

	it('should return array of upgrade candidate episodes from Sonarr', async () => {
		const mockResponse = {
			page: 1,
			pageSize: 1000,
			sortKey: 'airDateUtc',
			sortDirection: 'descending',
			totalRecords: 2,
			records: [
				{
					id: 201,
					seriesId: 2,
					seasonNumber: 1,
					episodeNumber: 1,
					title: 'Episode One',
					airDateUtc: '2020-01-01T00:00:00Z',
					hasFile: true,
					monitored: true,
					qualityCutoffNotMet: true
				},
				{
					id: 202,
					seriesId: 2,
					seasonNumber: 1,
					episodeNumber: 2,
					title: 'Episode Two',
					airDateUtc: '2020-01-08T00:00:00Z',
					hasFile: true,
					monitored: true,
					qualityCutoffNotMet: true
				}
			]
		};

		globalThis.fetch = createMockFetch(
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify(mockResponse), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				})
			)
		);

		const client = new SonarrClient(validConfig);
		const result = await client.getWantedCutoff();

		expect(result).toHaveLength(2);
		expect(result[0]?.title).toBe('Episode One');
		expect(result[0]?.qualityCutoffNotMet).toBe(true);
		expect(result[1]?.title).toBe('Episode Two');
	});

	it('should return empty array when no upgrade candidates exist', async () => {
		const mockResponse = {
			page: 1,
			pageSize: 1000,
			sortKey: 'airDateUtc',
			sortDirection: 'descending',
			totalRecords: 0,
			records: []
		};

		globalThis.fetch = createMockFetch(
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify(mockResponse), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				})
			)
		);

		const client = new SonarrClient(validConfig);
		const result = await client.getWantedCutoff();

		expect(result).toEqual([]);
	});

	it('should call /api/v3/wanted/cutoff with correct query parameters', async () => {
		let capturedUrl: string | undefined;

		const mockResponse = {
			page: 1,
			pageSize: 1000,
			sortKey: 'airDateUtc',
			sortDirection: 'descending',
			totalRecords: 0,
			records: []
		};

		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async (url: string) => {
				capturedUrl = url;
				return new Response(JSON.stringify(mockResponse), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				});
			})
		);

		const client = new SonarrClient(validConfig);
		await client.getWantedCutoff();

		expect(capturedUrl).toContain('/api/v3/wanted/cutoff');
		expect(capturedUrl).toContain('page=1');
		expect(capturedUrl).toContain('pageSize=1000');
		expect(capturedUrl).toContain('monitored=true');
	});

	it('should use custom options when provided', async () => {
		let capturedUrl: string | undefined;

		const mockResponse = {
			page: 1,
			pageSize: 25,
			sortKey: 'seriesTitle',
			sortDirection: 'ascending',
			totalRecords: 10,
			records: []
		};

		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async (url: string) => {
				capturedUrl = url;
				return new Response(JSON.stringify(mockResponse), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				});
			})
		);

		const client = new SonarrClient(validConfig);
		await client.getWantedCutoff({
			pageSize: 25,
			sortKey: 'seriesTitle',
			sortDirection: 'ascending'
		});

		expect(capturedUrl).toContain('pageSize=25');
		expect(capturedUrl).toContain('sortKey=seriesTitle');
		expect(capturedUrl).toContain('sortDirection=ascending');
	});

	it('should handle pagination across multiple pages', async () => {
		let callCount = 0;

		const page1Response = {
			page: 1,
			pageSize: 2,
			sortKey: 'airDateUtc',
			sortDirection: 'descending',
			totalRecords: 3,
			records: [
				{
					id: 1,
					seriesId: 1,
					seasonNumber: 1,
					episodeNumber: 1,
					hasFile: true,
					monitored: true,
					qualityCutoffNotMet: true
				},
				{
					id: 2,
					seriesId: 1,
					seasonNumber: 1,
					episodeNumber: 2,
					hasFile: true,
					monitored: true,
					qualityCutoffNotMet: true
				}
			]
		};

		const page2Response = {
			page: 2,
			pageSize: 2,
			sortKey: 'airDateUtc',
			sortDirection: 'descending',
			totalRecords: 3,
			records: [
				{
					id: 3,
					seriesId: 1,
					seasonNumber: 1,
					episodeNumber: 3,
					hasFile: true,
					monitored: true,
					qualityCutoffNotMet: true
				}
			]
		};

		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async () => {
				callCount++;
				const response = callCount === 1 ? page1Response : page2Response;

				return new Response(JSON.stringify(response), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				});
			})
		);

		const client = new SonarrClient(validConfig);
		const result = await client.getWantedCutoff({ pageSize: 2 });

		expect(callCount).toBe(2); // Should make 2 requests to get all 3 items
		expect(result).toHaveLength(3);
		expect(result[0]?.id).toBe(1);
		expect(result[2]?.id).toBe(3);
	});

	it('should skip malformed episode records', async () => {
		const mockResponse = {
			page: 1,
			pageSize: 1000,
			sortKey: 'airDateUtc',
			sortDirection: 'descending',
			totalRecords: 3,
			records: [
				{
					id: 1,
					seriesId: 1,
					seasonNumber: 1,
					episodeNumber: 1,
					hasFile: true,
					monitored: true,
					qualityCutoffNotMet: true
				},
				{ id: 2, badRecord: true }, // Invalid: missing required fields
				{
					id: 3,
					seriesId: 1,
					seasonNumber: 1,
					episodeNumber: 3,
					hasFile: true,
					monitored: true,
					qualityCutoffNotMet: true
				}
			]
		};

		globalThis.fetch = createMockFetch(
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify(mockResponse), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				})
			)
		);

		const client = new SonarrClient(validConfig);
		const result = await client.getWantedCutoff();

		// Should skip the malformed record
		expect(result).toHaveLength(2);
		expect(result[0]?.id).toBe(1);
		expect(result[1]?.id).toBe(3);
	});

	it('should include X-Api-Key header', async () => {
		let capturedHeaders: Headers | undefined;

		const mockResponse = {
			page: 1,
			pageSize: 1000,
			sortKey: 'airDateUtc',
			sortDirection: 'descending',
			totalRecords: 0,
			records: []
		};

		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
				capturedHeaders = new Headers(init?.headers);
				return new Response(JSON.stringify(mockResponse), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				});
			})
		);

		const client = new SonarrClient(validConfig);
		await client.getWantedCutoff();

		expect(capturedHeaders?.get('X-Api-Key')).toBe('test-api-key-12345');
	});
});

describe('SonarrClient.sendEpisodeSearch()', () => {
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

	it('should POST to /api/v3/command with EpisodeSearch name and episodeIds', async () => {
		let capturedUrl: string | undefined;
		let capturedBody: unknown;

		const mockResponse = {
			id: 12345,
			name: 'EpisodeSearch',
			status: 'queued',
			queued: '2024-01-15T12:00:00Z'
		};

		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
				capturedUrl = url;
				capturedBody = init?.body ? JSON.parse(init.body as string) : undefined;
				return new Response(JSON.stringify(mockResponse), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				});
			})
		);

		const client = new SonarrClient(validConfig);
		await client.sendEpisodeSearch([101, 102, 103]);

		expect(capturedUrl).toBe('http://localhost:8989/api/v3/command');
		expect(capturedBody).toEqual({
			name: 'EpisodeSearch',
			episodeIds: [101, 102, 103]
		});
	});

	it('should return parsed CommandResponse with queued status', async () => {
		const mockResponse = {
			id: 12345,
			name: 'EpisodeSearch',
			status: 'queued',
			queued: '2024-01-15T12:00:00Z',
			trigger: 'manual'
		};

		globalThis.fetch = createMockFetch(
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify(mockResponse), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				})
			)
		);

		const client = new SonarrClient(validConfig);
		const result = await client.sendEpisodeSearch([101]);

		expect(result.id).toBe(12345);
		expect(result.name).toBe('EpisodeSearch');
		expect(result.status).toBe('queued');
	});

	it('should use POST method', async () => {
		let capturedMethod: string | undefined;

		const mockResponse = {
			id: 12345,
			name: 'EpisodeSearch',
			status: 'queued',
			queued: '2024-01-15T12:00:00Z'
		};

		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
				capturedMethod = init?.method;
				return new Response(JSON.stringify(mockResponse), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				});
			})
		);

		const client = new SonarrClient(validConfig);
		await client.sendEpisodeSearch([101]);

		expect(capturedMethod).toBe('POST');
	});

	it('should include X-Api-Key header', async () => {
		let capturedHeaders: Headers | undefined;

		const mockResponse = {
			id: 12345,
			name: 'EpisodeSearch',
			status: 'queued',
			queued: '2024-01-15T12:00:00Z'
		};

		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
				capturedHeaders = new Headers(init?.headers);
				return new Response(JSON.stringify(mockResponse), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				});
			})
		);

		const client = new SonarrClient(validConfig);
		await client.sendEpisodeSearch([101]);

		expect(capturedHeaders?.get('X-Api-Key')).toBe('test-api-key-12345');
	});

	it('should handle single episode ID', async () => {
		let capturedBody: unknown;

		const mockResponse = {
			id: 12345,
			name: 'EpisodeSearch',
			status: 'queued',
			queued: '2024-01-15T12:00:00Z'
		};

		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
				capturedBody = init?.body ? JSON.parse(init.body as string) : undefined;
				return new Response(JSON.stringify(mockResponse), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				});
			})
		);

		const client = new SonarrClient(validConfig);
		await client.sendEpisodeSearch([999]);

		expect(capturedBody).toEqual({
			name: 'EpisodeSearch',
			episodeIds: [999]
		});
	});

	it('should handle empty episode IDs array', async () => {
		let capturedBody: unknown;

		const mockResponse = {
			id: 12345,
			name: 'EpisodeSearch',
			status: 'queued',
			queued: '2024-01-15T12:00:00Z'
		};

		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
				capturedBody = init?.body ? JSON.parse(init.body as string) : undefined;
				return new Response(JSON.stringify(mockResponse), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				});
			})
		);

		const client = new SonarrClient(validConfig);
		await client.sendEpisodeSearch([]);

		expect(capturedBody).toEqual({
			name: 'EpisodeSearch',
			episodeIds: []
		});
	});
});

describe('SonarrClient.sendSeasonSearch()', () => {
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

	it('should POST to /api/v3/command with SeasonSearch name, seriesId, and seasonNumber', async () => {
		let capturedUrl: string | undefined;
		let capturedBody: unknown;

		const mockResponse = {
			id: 12346,
			name: 'SeasonSearch',
			status: 'queued',
			queued: '2024-01-15T12:00:00Z'
		};

		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
				capturedUrl = url;
				capturedBody = init?.body ? JSON.parse(init.body as string) : undefined;
				return new Response(JSON.stringify(mockResponse), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				});
			})
		);

		const client = new SonarrClient(validConfig);
		await client.sendSeasonSearch(123, 2);

		expect(capturedUrl).toBe('http://localhost:8989/api/v3/command');
		expect(capturedBody).toEqual({
			name: 'SeasonSearch',
			seriesId: 123,
			seasonNumber: 2
		});
	});

	it('should return parsed CommandResponse with queued status', async () => {
		const mockResponse = {
			id: 12346,
			name: 'SeasonSearch',
			status: 'queued',
			queued: '2024-01-15T12:00:00Z',
			trigger: 'manual'
		};

		globalThis.fetch = createMockFetch(
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify(mockResponse), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				})
			)
		);

		const client = new SonarrClient(validConfig);
		const result = await client.sendSeasonSearch(123, 1);

		expect(result.id).toBe(12346);
		expect(result.name).toBe('SeasonSearch');
		expect(result.status).toBe('queued');
	});

	it('should use POST method', async () => {
		let capturedMethod: string | undefined;

		const mockResponse = {
			id: 12346,
			name: 'SeasonSearch',
			status: 'queued',
			queued: '2024-01-15T12:00:00Z'
		};

		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
				capturedMethod = init?.method;
				return new Response(JSON.stringify(mockResponse), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				});
			})
		);

		const client = new SonarrClient(validConfig);
		await client.sendSeasonSearch(123, 1);

		expect(capturedMethod).toBe('POST');
	});

	it('should include X-Api-Key header', async () => {
		let capturedHeaders: Headers | undefined;

		const mockResponse = {
			id: 12346,
			name: 'SeasonSearch',
			status: 'queued',
			queued: '2024-01-15T12:00:00Z'
		};

		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
				capturedHeaders = new Headers(init?.headers);
				return new Response(JSON.stringify(mockResponse), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				});
			})
		);

		const client = new SonarrClient(validConfig);
		await client.sendSeasonSearch(123, 1);

		expect(capturedHeaders?.get('X-Api-Key')).toBe('test-api-key-12345');
	});

	it('should handle season 0 (specials)', async () => {
		let capturedBody: unknown;

		const mockResponse = {
			id: 12346,
			name: 'SeasonSearch',
			status: 'queued',
			queued: '2024-01-15T12:00:00Z'
		};

		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
				capturedBody = init?.body ? JSON.parse(init.body as string) : undefined;
				return new Response(JSON.stringify(mockResponse), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				});
			})
		);

		const client = new SonarrClient(validConfig);
		await client.sendSeasonSearch(123, 0);

		expect(capturedBody).toEqual({
			name: 'SeasonSearch',
			seriesId: 123,
			seasonNumber: 0
		});
	});
});

describe('SonarrClient.getCommandStatus()', () => {
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

	it('should GET from /api/v3/command/{id}', async () => {
		let capturedUrl: string | undefined;

		const mockResponse = {
			id: 12345,
			name: 'EpisodeSearch',
			status: 'completed',
			queued: '2024-01-15T12:00:00Z',
			started: '2024-01-15T12:00:01Z',
			ended: '2024-01-15T12:00:10Z'
		};

		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async (url: string) => {
				capturedUrl = url;
				return new Response(JSON.stringify(mockResponse), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				});
			})
		);

		const client = new SonarrClient(validConfig);
		await client.getCommandStatus(12345);

		expect(capturedUrl).toBe('http://localhost:8989/api/v3/command/12345');
	});

	it('should return parsed CommandResponse with queued status', async () => {
		const mockResponse = {
			id: 12345,
			name: 'EpisodeSearch',
			status: 'queued',
			queued: '2024-01-15T12:00:00Z'
		};

		globalThis.fetch = createMockFetch(
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify(mockResponse), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				})
			)
		);

		const client = new SonarrClient(validConfig);
		const result = await client.getCommandStatus(12345);

		expect(result.id).toBe(12345);
		expect(result.status).toBe('queued');
	});

	it('should return parsed CommandResponse with started status', async () => {
		const mockResponse = {
			id: 12345,
			name: 'EpisodeSearch',
			status: 'started',
			queued: '2024-01-15T12:00:00Z',
			started: '2024-01-15T12:00:01Z'
		};

		globalThis.fetch = createMockFetch(
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify(mockResponse), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				})
			)
		);

		const client = new SonarrClient(validConfig);
		const result = await client.getCommandStatus(12345);

		expect(result.status).toBe('started');
		expect(result.started).toBe('2024-01-15T12:00:01Z');
	});

	it('should return parsed CommandResponse with completed status', async () => {
		const mockResponse = {
			id: 12345,
			name: 'EpisodeSearch',
			status: 'completed',
			queued: '2024-01-15T12:00:00Z',
			started: '2024-01-15T12:00:01Z',
			ended: '2024-01-15T12:00:10Z',
			duration: '00:00:09.0000000'
		};

		globalThis.fetch = createMockFetch(
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify(mockResponse), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				})
			)
		);

		const client = new SonarrClient(validConfig);
		const result = await client.getCommandStatus(12345);

		expect(result.status).toBe('completed');
		expect(result.ended).toBe('2024-01-15T12:00:10Z');
	});

	it('should return parsed CommandResponse with failed status', async () => {
		const mockResponse = {
			id: 12345,
			name: 'EpisodeSearch',
			status: 'failed',
			queued: '2024-01-15T12:00:00Z',
			started: '2024-01-15T12:00:01Z',
			ended: '2024-01-15T12:00:05Z',
			message: 'No indexers available'
		};

		globalThis.fetch = createMockFetch(
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify(mockResponse), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				})
			)
		);

		const client = new SonarrClient(validConfig);
		const result = await client.getCommandStatus(12345);

		expect(result.status).toBe('failed');
		expect(result.message).toBe('No indexers available');
	});

	it('should include X-Api-Key header', async () => {
		let capturedHeaders: Headers | undefined;

		const mockResponse = {
			id: 12345,
			name: 'EpisodeSearch',
			status: 'completed',
			queued: '2024-01-15T12:00:00Z'
		};

		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
				capturedHeaders = new Headers(init?.headers);
				return new Response(JSON.stringify(mockResponse), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				});
			})
		);

		const client = new SonarrClient(validConfig);
		await client.getCommandStatus(12345);

		expect(capturedHeaders?.get('X-Api-Key')).toBe('test-api-key-12345');
	});

	it('should use GET method (default)', async () => {
		let capturedMethod: string | undefined;

		const mockResponse = {
			id: 12345,
			name: 'EpisodeSearch',
			status: 'completed',
			queued: '2024-01-15T12:00:00Z'
		};

		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
				capturedMethod = init?.method;
				return new Response(JSON.stringify(mockResponse), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				});
			})
		);

		const client = new SonarrClient(validConfig);
		await client.getCommandStatus(12345);

		expect(capturedMethod).toBe('GET');
	});
});
