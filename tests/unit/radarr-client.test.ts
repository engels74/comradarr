/**
 * Unit tests for RadarrClient
 *
 * Tests cover:
 * - Constructor inheritance from BaseArrClient
 * - Inherited methods (ping, getSystemStatus, getHealth)
 * - API version detection (detectApiVersion)
 * - Library data retrieval (getMovies)
 * - Wanted missing movies (getWantedMissing)
 * - Wanted cutoff/upgrade candidates (getWantedCutoff)
 *
 * @requirements 25.1, 25.2, 25.3, 25.6
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { RadarrClient } from '../../src/lib/server/connectors/index';

// Helper to create a mock fetch that satisfies TypeScript
function createMockFetch(impl: Mock): typeof fetch {
	return impl as unknown as typeof fetch;
}

describe('RadarrClient', () => {
	const validConfig = {
		baseUrl: 'http://localhost:7878',
		apiKey: 'test-api-key-12345'
	};

	describe('Constructor', () => {
		it('should create instance with valid config', () => {
			const client = new RadarrClient(validConfig);

			expect(client).toBeInstanceOf(RadarrClient);
		});

		it('should accept optional timeout parameter', () => {
			const client = new RadarrClient({
				...validConfig,
				timeout: 60000
			});

			expect(client).toBeInstanceOf(RadarrClient);
		});

		it('should accept optional userAgent parameter', () => {
			const client = new RadarrClient({
				...validConfig,
				userAgent: 'TestAgent/1.0'
			});

			expect(client).toBeInstanceOf(RadarrClient);
		});

		it('should accept optional retry configuration', () => {
			const client = new RadarrClient({
				...validConfig,
				retry: {
					maxRetries: 5,
					baseDelay: 500
				}
			});

			expect(client).toBeInstanceOf(RadarrClient);
		});
	});
});

describe('RadarrClient.ping()', () => {
	const validConfig = {
		baseUrl: 'http://localhost:7878',
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

	it('should return true when Radarr server responds OK', async () => {
		globalThis.fetch = createMockFetch(
			vi.fn().mockResolvedValue(new Response('Pong', { status: 200 }))
		);

		const client = new RadarrClient(validConfig);
		const result = await client.ping();

		expect(result).toBe(true);
	});

	it('should return false when Radarr server returns error', async () => {
		globalThis.fetch = createMockFetch(
			vi.fn().mockResolvedValue(new Response('Unauthorized', { status: 401 }))
		);

		const client = new RadarrClient(validConfig);
		const result = await client.ping();

		expect(result).toBe(false);
	});

	it('should return false when network error occurs', async () => {
		globalThis.fetch = createMockFetch(vi.fn().mockRejectedValue(new TypeError('fetch failed')));

		const client = new RadarrClient(validConfig);
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

		const client = new RadarrClient(validConfig);
		await client.ping();

		expect(capturedUrl).toBe('http://localhost:7878/ping');
	});

	it('should include X-Api-Key header in ping request', async () => {
		let capturedHeaders: Headers | undefined;

		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
				capturedHeaders = new Headers(init?.headers);
				return new Response('Pong', { status: 200 });
			})
		);

		const client = new RadarrClient(validConfig);
		await client.ping();

		expect(capturedHeaders?.get('X-Api-Key')).toBe('test-api-key-12345');
	});
});

describe('RadarrClient.getSystemStatus()', () => {
	const validConfig = {
		baseUrl: 'http://localhost:7878',
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

	it('should return system status from Radarr', async () => {
		const mockStatus = {
			appName: 'Radarr',
			instanceName: 'Radarr',
			version: '5.2.0.8171',
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
			branch: 'master',
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

		const client = new RadarrClient(validConfig);
		const result = await client.getSystemStatus();

		expect(result.appName).toBe('Radarr');
		expect(result.version).toBe('5.2.0.8171');
		expect(result.isDocker).toBe(true);
	});

	it('should call /api/v3/system/status endpoint', async () => {
		let capturedUrl: string | undefined;

		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async (url: string) => {
				capturedUrl = url;
				return new Response(JSON.stringify({ appName: 'Radarr', version: '5.0.0' }), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				});
			})
		);

		const client = new RadarrClient(validConfig);
		await client.getSystemStatus();

		expect(capturedUrl).toBe('http://localhost:7878/api/v3/system/status');
	});

	it('should include X-Api-Key header', async () => {
		let capturedHeaders: Headers | undefined;

		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
				capturedHeaders = new Headers(init?.headers);
				return new Response(JSON.stringify({ appName: 'Radarr' }), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				});
			})
		);

		const client = new RadarrClient(validConfig);
		await client.getSystemStatus();

		expect(capturedHeaders?.get('X-Api-Key')).toBe('test-api-key-12345');
	});
});

describe('RadarrClient.getHealth()', () => {
	const validConfig = {
		baseUrl: 'http://localhost:7878',
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

	it('should return health check results from Radarr', async () => {
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

		const client = new RadarrClient(validConfig);
		const result = await client.getHealth();

		expect(result).toHaveLength(2);
		expect(result[0]?.source).toBe('IndexerStatusCheck');
		expect(result[0]?.type).toBe('warning');
		expect(result[1]?.type).toBe('ok');
	});

	it('should return empty array when Radarr is healthy', async () => {
		globalThis.fetch = createMockFetch(
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify([]), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				})
			)
		);

		const client = new RadarrClient(validConfig);
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

		const client = new RadarrClient(validConfig);
		await client.getHealth();

		expect(capturedUrl).toBe('http://localhost:7878/api/v3/health');
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

		const client = new RadarrClient(validConfig);
		await client.getHealth();

		expect(capturedHeaders?.get('X-Api-Key')).toBe('test-api-key-12345');
	});
});

describe('RadarrClient.detectApiVersion()', () => {
	const validConfig = {
		baseUrl: 'http://localhost:7878',
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

	it('should detect Radarr v5 version', async () => {
		const mockStatus = {
			appName: 'Radarr',
			version: '5.2.0.8171',
			isDocker: true
		};

		globalThis.fetch = createMockFetch(
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify(mockStatus), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				})
			)
		);

		const client = new RadarrClient(validConfig);
		const result = await client.detectApiVersion();

		expect(result.appVersion).toBe('5.2.0.8171');
		expect(result.majorVersion).toBe(5);
		expect(result.apiVersion).toBe('v3');
	});

	it('should detect Radarr v4 version', async () => {
		const mockStatus = {
			appName: 'Radarr',
			version: '4.7.0.7654',
			isDocker: true
		};

		globalThis.fetch = createMockFetch(
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify(mockStatus), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				})
			)
		);

		const client = new RadarrClient(validConfig);
		const result = await client.detectApiVersion();

		expect(result.appVersion).toBe('4.7.0.7654');
		expect(result.majorVersion).toBe(4);
		expect(result.apiVersion).toBe('v3');
	});

	it('should detect Radarr v3 version', async () => {
		const mockStatus = {
			appName: 'Radarr',
			version: '3.2.2.5080',
			isDocker: true
		};

		globalThis.fetch = createMockFetch(
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify(mockStatus), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				})
			)
		);

		const client = new RadarrClient(validConfig);
		const result = await client.detectApiVersion();

		expect(result.appVersion).toBe('3.2.2.5080');
		expect(result.majorVersion).toBe(3);
		expect(result.apiVersion).toBe('v3');
	});

	it('should default to v3 for invalid version strings', async () => {
		const mockStatus = {
			appName: 'Radarr',
			version: 'invalid-version',
			isDocker: true
		};

		globalThis.fetch = createMockFetch(
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify(mockStatus), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				})
			)
		);

		const client = new RadarrClient(validConfig);
		const result = await client.detectApiVersion();

		expect(result.appVersion).toBe('invalid-version');
		expect(result.majorVersion).toBe(3);
		expect(result.apiVersion).toBe('v3');
	});

	it('should call /api/v3/system/status endpoint', async () => {
		let capturedUrl: string | undefined;

		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async (url: string) => {
				capturedUrl = url;
				return new Response(JSON.stringify({ appName: 'Radarr', version: '5.0.0' }), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				});
			})
		);

		const client = new RadarrClient(validConfig);
		await client.detectApiVersion();

		expect(capturedUrl).toBe('http://localhost:7878/api/v3/system/status');
	});

	it('should include X-Api-Key header', async () => {
		let capturedHeaders: Headers | undefined;

		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
				capturedHeaders = new Headers(init?.headers);
				return new Response(JSON.stringify({ appName: 'Radarr', version: '5.0.0' }), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				});
			})
		);

		const client = new RadarrClient(validConfig);
		await client.detectApiVersion();

		expect(capturedHeaders?.get('X-Api-Key')).toBe('test-api-key-12345');
	});
});

describe('RadarrClient.getMovies()', () => {
	const validConfig = {
		baseUrl: 'http://localhost:7878',
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

	it('should return array of movies from Radarr', async () => {
		const mockMovies = [
			{
				id: 1,
				title: 'The Matrix',
				tmdbId: 603,
				imdbId: 'tt0133093',
				year: 1999,
				hasFile: true,
				monitored: true,
				qualityCutoffNotMet: false,
				status: 'released'
			},
			{
				id: 2,
				title: 'Inception',
				tmdbId: 27205,
				imdbId: 'tt1375666',
				year: 2010,
				hasFile: false,
				monitored: true,
				qualityCutoffNotMet: true,
				status: 'released'
			}
		];

		globalThis.fetch = createMockFetch(
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify(mockMovies), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				})
			)
		);

		const client = new RadarrClient(validConfig);
		const result = await client.getMovies();

		expect(result).toHaveLength(2);
		expect(result[0]?.title).toBe('The Matrix');
		expect(result[0]?.tmdbId).toBe(603);
		expect(result[0]?.year).toBe(1999);
		expect(result[0]?.hasFile).toBe(true);
		expect(result[1]?.title).toBe('Inception');
		expect(result[1]?.hasFile).toBe(false);
		expect(result[1]?.qualityCutoffNotMet).toBe(true);
	});

	it('should return empty array when no movies exist', async () => {
		globalThis.fetch = createMockFetch(
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify([]), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				})
			)
		);

		const client = new RadarrClient(validConfig);
		const result = await client.getMovies();

		expect(result).toEqual([]);
	});

	it('should call /api/v3/movie endpoint', async () => {
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

		const client = new RadarrClient(validConfig);
		await client.getMovies();

		expect(capturedUrl).toBe('http://localhost:7878/api/v3/movie');
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

		const client = new RadarrClient(validConfig);
		await client.getMovies();

		expect(capturedHeaders?.get('X-Api-Key')).toBe('test-api-key-12345');
	});

	it('should skip malformed movie records', async () => {
		const mockMovies = [
			{
				id: 1,
				title: 'Valid Movie',
				tmdbId: 12345,
				year: 2020,
				hasFile: true,
				monitored: true,
				qualityCutoffNotMet: false
			},
			{
				// Invalid: missing required fields
				id: 2,
				title: 'Missing fields'
				// No tmdbId, year, hasFile, etc.
			},
			{
				id: 3,
				title: 'Another Valid Movie',
				tmdbId: 67890,
				year: 2021,
				hasFile: false,
				monitored: true,
				qualityCutoffNotMet: true
			}
		];

		globalThis.fetch = createMockFetch(
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify(mockMovies), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				})
			)
		);

		const client = new RadarrClient(validConfig);
		const result = await client.getMovies();

		// Should skip the malformed record
		expect(result).toHaveLength(2);
		expect(result[0]?.id).toBe(1);
		expect(result[0]?.title).toBe('Valid Movie');
		expect(result[1]?.id).toBe(3);
		expect(result[1]?.title).toBe('Another Valid Movie');
	});

	it('should handle movies with minimal required fields', async () => {
		const mockMovies = [
			{
				id: 1,
				title: 'Minimal Movie',
				tmdbId: 99999,
				year: 2023,
				hasFile: false,
				monitored: false,
				qualityCutoffNotMet: false
				// No optional fields: imdbId, movieFileId, movieFile, status
			}
		];

		globalThis.fetch = createMockFetch(
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify(mockMovies), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				})
			)
		);

		const client = new RadarrClient(validConfig);
		const result = await client.getMovies();

		expect(result).toHaveLength(1);
		expect(result[0]?.title).toBe('Minimal Movie');
		expect(result[0]?.imdbId).toBeUndefined();
		expect(result[0]?.movieFileId).toBeUndefined();
		expect(result[0]?.status).toBeUndefined();
	});
});

describe('RadarrClient.getWantedMissing()', () => {
	const validConfig = {
		baseUrl: 'http://localhost:7878',
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

	it('should return array of missing movies from Radarr', async () => {
		const mockResponse = {
			page: 1,
			pageSize: 1000,
			sortKey: 'title',
			sortDirection: 'descending',
			totalRecords: 2,
			records: [
				{
					id: 1,
					title: 'The Matrix',
					tmdbId: 603,
					imdbId: 'tt0133093',
					year: 1999,
					hasFile: false,
					monitored: true,
					qualityCutoffNotMet: false
				},
				{
					id: 2,
					title: 'Inception',
					tmdbId: 27205,
					imdbId: 'tt1375666',
					year: 2010,
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

		const client = new RadarrClient(validConfig);
		const result = await client.getWantedMissing();

		expect(result).toHaveLength(2);
		expect(result[0]?.title).toBe('The Matrix');
		expect(result[0]?.hasFile).toBe(false);
		expect(result[1]?.title).toBe('Inception');
	});

	it('should return empty array when no missing movies exist', async () => {
		const mockResponse = {
			page: 1,
			pageSize: 1000,
			sortKey: 'title',
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

		const client = new RadarrClient(validConfig);
		const result = await client.getWantedMissing();

		expect(result).toEqual([]);
	});

	it('should call /api/v3/wanted/missing with correct query parameters', async () => {
		let capturedUrl: string | undefined;

		const mockResponse = {
			page: 1,
			pageSize: 1000,
			sortKey: 'title',
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

		const client = new RadarrClient(validConfig);
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
			sortKey: 'year',
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

		const client = new RadarrClient(validConfig);
		await client.getWantedMissing({
			page: 2,
			pageSize: 50,
			sortKey: 'year',
			sortDirection: 'ascending',
			monitored: false
		});

		expect(capturedUrl).toContain('page=2');
		expect(capturedUrl).toContain('pageSize=50');
		expect(capturedUrl).toContain('sortKey=year');
		expect(capturedUrl).toContain('sortDirection=ascending');
		expect(capturedUrl).toContain('monitored=false');
	});

	it('should handle pagination across multiple pages', async () => {
		let callCount = 0;

		const page1Response = {
			page: 1,
			pageSize: 2,
			sortKey: 'title',
			sortDirection: 'descending',
			totalRecords: 5,
			records: [
				{ id: 1, title: 'Movie 1', tmdbId: 1, year: 2020, hasFile: false, monitored: true, qualityCutoffNotMet: false },
				{ id: 2, title: 'Movie 2', tmdbId: 2, year: 2020, hasFile: false, monitored: true, qualityCutoffNotMet: false }
			]
		};

		const page2Response = {
			page: 2,
			pageSize: 2,
			sortKey: 'title',
			sortDirection: 'descending',
			totalRecords: 5,
			records: [
				{ id: 3, title: 'Movie 3', tmdbId: 3, year: 2020, hasFile: false, monitored: true, qualityCutoffNotMet: false },
				{ id: 4, title: 'Movie 4', tmdbId: 4, year: 2020, hasFile: false, monitored: true, qualityCutoffNotMet: false }
			]
		};

		const page3Response = {
			page: 3,
			pageSize: 2,
			sortKey: 'title',
			sortDirection: 'descending',
			totalRecords: 5,
			records: [
				{ id: 5, title: 'Movie 5', tmdbId: 5, year: 2020, hasFile: false, monitored: true, qualityCutoffNotMet: false }
			]
		};

		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async () => {
				callCount++;
				let response;
				if (callCount === 1) response = page1Response;
				else if (callCount === 2) response = page2Response;
				else response = page3Response;

				return new Response(JSON.stringify(response), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				});
			})
		);

		const client = new RadarrClient(validConfig);
		const result = await client.getWantedMissing({ pageSize: 2 });

		expect(callCount).toBe(3); // Should make 3 requests to get all 5 items
		expect(result).toHaveLength(5);
		expect(result[0]?.id).toBe(1);
		expect(result[4]?.id).toBe(5);
	});

	it('should skip malformed movie records', async () => {
		const mockResponse = {
			page: 1,
			pageSize: 1000,
			sortKey: 'title',
			sortDirection: 'descending',
			totalRecords: 3,
			records: [
				{ id: 1, title: 'Valid Movie 1', tmdbId: 1, year: 2020, hasFile: false, monitored: true, qualityCutoffNotMet: false },
				{ id: 2, title: 'Invalid Movie' }, // Invalid: missing required fields
				{ id: 3, title: 'Valid Movie 2', tmdbId: 3, year: 2020, hasFile: false, monitored: true, qualityCutoffNotMet: false }
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

		const client = new RadarrClient(validConfig);
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
			sortKey: 'title',
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

		const client = new RadarrClient(validConfig);
		await client.getWantedMissing();

		expect(capturedHeaders?.get('X-Api-Key')).toBe('test-api-key-12345');
	});
});

describe('RadarrClient.getWantedCutoff()', () => {
	const validConfig = {
		baseUrl: 'http://localhost:7878',
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

	it('should return array of upgrade candidate movies from Radarr', async () => {
		const mockResponse = {
			page: 1,
			pageSize: 1000,
			sortKey: 'title',
			sortDirection: 'descending',
			totalRecords: 2,
			records: [
				{
					id: 1,
					title: 'The Dark Knight',
					tmdbId: 155,
					imdbId: 'tt0468569',
					year: 2008,
					hasFile: true,
					monitored: true,
					qualityCutoffNotMet: true
				},
				{
					id: 2,
					title: 'Interstellar',
					tmdbId: 157336,
					imdbId: 'tt0816692',
					year: 2014,
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

		const client = new RadarrClient(validConfig);
		const result = await client.getWantedCutoff();

		expect(result).toHaveLength(2);
		expect(result[0]?.title).toBe('The Dark Knight');
		expect(result[0]?.qualityCutoffNotMet).toBe(true);
		expect(result[1]?.title).toBe('Interstellar');
	});

	it('should return empty array when no upgrade candidates exist', async () => {
		const mockResponse = {
			page: 1,
			pageSize: 1000,
			sortKey: 'title',
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

		const client = new RadarrClient(validConfig);
		const result = await client.getWantedCutoff();

		expect(result).toEqual([]);
	});

	it('should call /api/v3/wanted/cutoff with correct query parameters', async () => {
		let capturedUrl: string | undefined;

		const mockResponse = {
			page: 1,
			pageSize: 1000,
			sortKey: 'title',
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

		const client = new RadarrClient(validConfig);
		await client.getWantedCutoff();

		expect(capturedUrl).toContain('/api/v3/wanted/cutoff');
		expect(capturedUrl).toContain('page=1');
		expect(capturedUrl).toContain('pageSize=1000');
		expect(capturedUrl).toContain('monitored=true');
	});

	it('should use custom options when provided', async () => {
		let capturedUrl: string | undefined;

		const mockResponse = {
			page: 2,
			pageSize: 50,
			sortKey: 'year',
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

		const client = new RadarrClient(validConfig);
		await client.getWantedCutoff({
			page: 2,
			pageSize: 50,
			sortKey: 'year',
			sortDirection: 'ascending',
			monitored: false
		});

		expect(capturedUrl).toContain('page=2');
		expect(capturedUrl).toContain('pageSize=50');
		expect(capturedUrl).toContain('sortKey=year');
		expect(capturedUrl).toContain('sortDirection=ascending');
		expect(capturedUrl).toContain('monitored=false');
	});

	it('should handle pagination across multiple pages', async () => {
		let callCount = 0;

		const page1Response = {
			page: 1,
			pageSize: 2,
			sortKey: 'title',
			sortDirection: 'descending',
			totalRecords: 5,
			records: [
				{ id: 1, title: 'Movie 1', tmdbId: 1, year: 2020, hasFile: true, monitored: true, qualityCutoffNotMet: true },
				{ id: 2, title: 'Movie 2', tmdbId: 2, year: 2020, hasFile: true, monitored: true, qualityCutoffNotMet: true }
			]
		};

		const page2Response = {
			page: 2,
			pageSize: 2,
			sortKey: 'title',
			sortDirection: 'descending',
			totalRecords: 5,
			records: [
				{ id: 3, title: 'Movie 3', tmdbId: 3, year: 2020, hasFile: true, monitored: true, qualityCutoffNotMet: true },
				{ id: 4, title: 'Movie 4', tmdbId: 4, year: 2020, hasFile: true, monitored: true, qualityCutoffNotMet: true }
			]
		};

		const page3Response = {
			page: 3,
			pageSize: 2,
			sortKey: 'title',
			sortDirection: 'descending',
			totalRecords: 5,
			records: [
				{ id: 5, title: 'Movie 5', tmdbId: 5, year: 2020, hasFile: true, monitored: true, qualityCutoffNotMet: true }
			]
		};

		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async () => {
				callCount++;
				let response;
				if (callCount === 1) response = page1Response;
				else if (callCount === 2) response = page2Response;
				else response = page3Response;

				return new Response(JSON.stringify(response), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				});
			})
		);

		const client = new RadarrClient(validConfig);
		const result = await client.getWantedCutoff({ pageSize: 2 });

		expect(callCount).toBe(3); // Should make 3 requests to get all 5 items
		expect(result).toHaveLength(5);
		expect(result[0]?.id).toBe(1);
		expect(result[4]?.id).toBe(5);
	});

	it('should skip malformed movie records', async () => {
		const mockResponse = {
			page: 1,
			pageSize: 1000,
			sortKey: 'title',
			sortDirection: 'descending',
			totalRecords: 3,
			records: [
				{ id: 1, title: 'Valid Movie 1', tmdbId: 1, year: 2020, hasFile: true, monitored: true, qualityCutoffNotMet: true },
				{ id: 2, title: 'Invalid Movie' }, // Invalid: missing required fields
				{ id: 3, title: 'Valid Movie 2', tmdbId: 3, year: 2020, hasFile: true, monitored: true, qualityCutoffNotMet: true }
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

		const client = new RadarrClient(validConfig);
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
			sortKey: 'title',
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

		const client = new RadarrClient(validConfig);
		await client.getWantedCutoff();

		expect(capturedHeaders?.get('X-Api-Key')).toBe('test-api-key-12345');
	});
});

describe('RadarrClient.sendMoviesSearch()', () => {
	const validConfig = {
		baseUrl: 'http://localhost:7878',
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

	it('should POST to /api/v3/command with MoviesSearch name and movieIds', async () => {
		let capturedUrl: string | undefined;
		let capturedBody: unknown;

		const mockResponse = {
			id: 12345,
			name: 'MoviesSearch',
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

		const client = new RadarrClient(validConfig);
		await client.sendMoviesSearch([1, 2, 3]);

		expect(capturedUrl).toBe('http://localhost:7878/api/v3/command');
		expect(capturedBody).toEqual({
			name: 'MoviesSearch',
			movieIds: [1, 2, 3]
		});
	});

	it('should return parsed CommandResponse with queued status', async () => {
		const mockResponse = {
			id: 12345,
			name: 'MoviesSearch',
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

		const client = new RadarrClient(validConfig);
		const result = await client.sendMoviesSearch([1]);

		expect(result.id).toBe(12345);
		expect(result.name).toBe('MoviesSearch');
		expect(result.status).toBe('queued');
	});

	it('should use POST method', async () => {
		let capturedMethod: string | undefined;

		const mockResponse = {
			id: 12345,
			name: 'MoviesSearch',
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

		const client = new RadarrClient(validConfig);
		await client.sendMoviesSearch([1]);

		expect(capturedMethod).toBe('POST');
	});

	it('should include X-Api-Key header', async () => {
		let capturedHeaders: Headers | undefined;

		const mockResponse = {
			id: 12345,
			name: 'MoviesSearch',
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

		const client = new RadarrClient(validConfig);
		await client.sendMoviesSearch([1]);

		expect(capturedHeaders?.get('X-Api-Key')).toBe('test-api-key-12345');
	});

	it('should handle single movie ID', async () => {
		let capturedBody: unknown;

		const mockResponse = {
			id: 12345,
			name: 'MoviesSearch',
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

		const client = new RadarrClient(validConfig);
		await client.sendMoviesSearch([999]);

		expect(capturedBody).toEqual({
			name: 'MoviesSearch',
			movieIds: [999]
		});
	});

	it('should handle empty movie IDs array', async () => {
		let capturedBody: unknown;

		const mockResponse = {
			id: 12345,
			name: 'MoviesSearch',
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

		const client = new RadarrClient(validConfig);
		await client.sendMoviesSearch([]);

		expect(capturedBody).toEqual({
			name: 'MoviesSearch',
			movieIds: []
		});
	});

	it('should handle multiple movie IDs (batch)', async () => {
		let capturedBody: unknown;

		const mockResponse = {
			id: 12345,
			name: 'MoviesSearch',
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

		const client = new RadarrClient(validConfig);
		await client.sendMoviesSearch([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

		expect(capturedBody).toEqual({
			name: 'MoviesSearch',
			movieIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
		});
	});
});

describe('RadarrClient.getCommandStatus()', () => {
	const validConfig = {
		baseUrl: 'http://localhost:7878',
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
			name: 'MoviesSearch',
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

		const client = new RadarrClient(validConfig);
		await client.getCommandStatus(12345);

		expect(capturedUrl).toBe('http://localhost:7878/api/v3/command/12345');
	});

	it('should return parsed CommandResponse with queued status', async () => {
		const mockResponse = {
			id: 12345,
			name: 'MoviesSearch',
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

		const client = new RadarrClient(validConfig);
		const result = await client.getCommandStatus(12345);

		expect(result.id).toBe(12345);
		expect(result.status).toBe('queued');
	});

	it('should return parsed CommandResponse with started status', async () => {
		const mockResponse = {
			id: 12345,
			name: 'MoviesSearch',
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

		const client = new RadarrClient(validConfig);
		const result = await client.getCommandStatus(12345);

		expect(result.status).toBe('started');
		expect(result.started).toBe('2024-01-15T12:00:01Z');
	});

	it('should return parsed CommandResponse with completed status', async () => {
		const mockResponse = {
			id: 12345,
			name: 'MoviesSearch',
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

		const client = new RadarrClient(validConfig);
		const result = await client.getCommandStatus(12345);

		expect(result.status).toBe('completed');
		expect(result.ended).toBe('2024-01-15T12:00:10Z');
	});

	it('should return parsed CommandResponse with failed status', async () => {
		const mockResponse = {
			id: 12345,
			name: 'MoviesSearch',
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

		const client = new RadarrClient(validConfig);
		const result = await client.getCommandStatus(12345);

		expect(result.status).toBe('failed');
		expect(result.message).toBe('No indexers available');
	});

	it('should include X-Api-Key header', async () => {
		let capturedHeaders: Headers | undefined;

		const mockResponse = {
			id: 12345,
			name: 'MoviesSearch',
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

		const client = new RadarrClient(validConfig);
		await client.getCommandStatus(12345);

		expect(capturedHeaders?.get('X-Api-Key')).toBe('test-api-key-12345');
	});

	it('should use GET method (default)', async () => {
		let capturedMethod: string | undefined;

		const mockResponse = {
			id: 12345,
			name: 'MoviesSearch',
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

		const client = new RadarrClient(validConfig);
		await client.getCommandStatus(12345);

		expect(capturedMethod).toBe('GET');
	});
});
