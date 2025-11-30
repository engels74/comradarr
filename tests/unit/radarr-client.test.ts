/**
 * Unit tests for RadarrClient
 *
 * Tests cover:
 * - Constructor inheritance from BaseArrClient
 * - Inherited methods (ping, getSystemStatus, getHealth)
 * - API version detection (detectApiVersion)
 *
 * @requirements 25.6
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
