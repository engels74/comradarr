/**
 * Unit tests for BaseArrClient
 *
 * Tests cover:
 * - Constructor behavior (URL normalization, default values)
 * - URL building
 * - Error categorization
 * - Ping behavior
 *
 * @requirements 23.1, 23.2
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import {
	BaseArrClient,
	NetworkError,
	AuthenticationError,
	RateLimitError,
	ServerError,
	TimeoutError
} from '../../src/lib/server/connectors/index';

// Helper to create a mock fetch that satisfies TypeScript
function createMockFetch(impl: Mock): typeof fetch {
	return impl as unknown as typeof fetch;
}

// Create a test subclass to expose protected methods
class TestableBaseArrClient extends BaseArrClient {
	public exposedBuildUrl(endpoint: string): string {
		return this.buildUrl(endpoint);
	}

	public get exposedBaseUrl(): string {
		return this.baseUrl;
	}

	public get exposedApiKey(): string {
		return this.apiKey;
	}

	public get exposedTimeout(): number {
		return this.timeout;
	}

	public get exposedUserAgent(): string {
		return this.userAgent;
	}

	// Expose request method for testing
	public async exposedRequest<T>(
		endpoint: string,
		options?: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown; timeout?: number }
	): Promise<T> {
		return this.request<T>(endpoint, options);
	}
}

describe('BaseArrClient', () => {
	const validConfig = {
		baseUrl: 'http://localhost:8989',
		apiKey: 'test-api-key-12345'
	};

	describe('Constructor', () => {
		it('should initialize with required config', () => {
			const client = new TestableBaseArrClient(validConfig);

			expect(client.exposedBaseUrl).toBe('http://localhost:8989');
			expect(client.exposedApiKey).toBe('test-api-key-12345');
		});

		it('should use default timeout of 30000ms', () => {
			const client = new TestableBaseArrClient(validConfig);

			expect(client.exposedTimeout).toBe(30000);
		});

		it('should use custom timeout when provided', () => {
			const client = new TestableBaseArrClient({
				...validConfig,
				timeout: 60000
			});

			expect(client.exposedTimeout).toBe(60000);
		});

		it('should use default User-Agent', () => {
			const client = new TestableBaseArrClient(validConfig);

			expect(client.exposedUserAgent).toBe('Comradarr/1.0');
		});

		it('should use custom User-Agent when provided', () => {
			const client = new TestableBaseArrClient({
				...validConfig,
				userAgent: 'CustomAgent/2.0'
			});

			expect(client.exposedUserAgent).toBe('CustomAgent/2.0');
		});
	});

	describe('URL Normalization', () => {
		it('should remove trailing slash from baseUrl', () => {
			const client = new TestableBaseArrClient({
				...validConfig,
				baseUrl: 'http://localhost:8989/'
			});

			expect(client.exposedBaseUrl).toBe('http://localhost:8989');
		});

		it('should remove multiple trailing slashes from baseUrl', () => {
			const client = new TestableBaseArrClient({
				...validConfig,
				baseUrl: 'http://localhost:8989///'
			});

			expect(client.exposedBaseUrl).toBe('http://localhost:8989');
		});

		it('should handle baseUrl without trailing slash', () => {
			const client = new TestableBaseArrClient({
				...validConfig,
				baseUrl: 'http://localhost:8989'
			});

			expect(client.exposedBaseUrl).toBe('http://localhost:8989');
		});
	});

	describe('URL Building', () => {
		const client = new TestableBaseArrClient(validConfig);

		it('should build URL with API version path', () => {
			const url = client.exposedBuildUrl('system/status');

			expect(url).toBe('http://localhost:8989/api/v3/system/status');
		});

		it('should handle endpoint with leading slash', () => {
			const url = client.exposedBuildUrl('/system/status');

			expect(url).toBe('http://localhost:8989/api/v3/system/status');
		});

		it('should handle various endpoints', () => {
			expect(client.exposedBuildUrl('health')).toBe('http://localhost:8989/api/v3/health');
			expect(client.exposedBuildUrl('series')).toBe('http://localhost:8989/api/v3/series');
			expect(client.exposedBuildUrl('movie')).toBe('http://localhost:8989/api/v3/movie');
			expect(client.exposedBuildUrl('command')).toBe('http://localhost:8989/api/v3/command');
		});
	});
});

describe('BaseArrClient HTTP Requests', () => {
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

	describe('Request Headers', () => {
		it('should include X-Api-Key header', async () => {
			let capturedHeaders: Headers | undefined;

			globalThis.fetch = createMockFetch(
				vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
					capturedHeaders = new Headers(init?.headers);
					return new Response(JSON.stringify({ success: true }), {
						status: 200,
						headers: { 'Content-Type': 'application/json' }
					});
				})
			);

			const client = new TestableBaseArrClient(validConfig);
			await client.exposedRequest('system/status');

			expect(capturedHeaders?.get('X-Api-Key')).toBe('test-api-key-12345');
		});

		it('should include User-Agent header', async () => {
			let capturedHeaders: Headers | undefined;

			globalThis.fetch = createMockFetch(
				vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
					capturedHeaders = new Headers(init?.headers);
					return new Response(JSON.stringify({ success: true }), {
						status: 200,
						headers: { 'Content-Type': 'application/json' }
					});
				})
			);

			const client = new TestableBaseArrClient(validConfig);
			await client.exposedRequest('system/status');

			expect(capturedHeaders?.get('User-Agent')).toBe('Comradarr/1.0');
		});

		it('should include Content-Type header', async () => {
			let capturedHeaders: Headers | undefined;

			globalThis.fetch = createMockFetch(
				vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
					capturedHeaders = new Headers(init?.headers);
					return new Response(JSON.stringify({ success: true }), {
						status: 200,
						headers: { 'Content-Type': 'application/json' }
					});
				})
			);

			const client = new TestableBaseArrClient(validConfig);
			await client.exposedRequest('system/status');

			expect(capturedHeaders?.get('Content-Type')).toBe('application/json');
		});

		it('should include Accept header', async () => {
			let capturedHeaders: Headers | undefined;

			globalThis.fetch = createMockFetch(
				vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
					capturedHeaders = new Headers(init?.headers);
					return new Response(JSON.stringify({ success: true }), {
						status: 200,
						headers: { 'Content-Type': 'application/json' }
					});
				})
			);

			const client = new TestableBaseArrClient(validConfig);
			await client.exposedRequest('system/status');

			expect(capturedHeaders?.get('Accept')).toBe('application/json');
		});
	});

	describe('Error Handling', () => {
		it('should throw AuthenticationError for HTTP 401', async () => {
			globalThis.fetch = createMockFetch(
				vi.fn().mockResolvedValue(
					new Response('Unauthorized', {
						status: 401,
						statusText: 'Unauthorized'
					})
				)
			);

			const client = new TestableBaseArrClient(validConfig);

			await expect(client.exposedRequest('system/status')).rejects.toThrow(AuthenticationError);
		});

		it('should throw RateLimitError for HTTP 429', async () => {
			globalThis.fetch = createMockFetch(
				vi.fn().mockResolvedValue(
					new Response('Too Many Requests', {
						status: 429,
						statusText: 'Too Many Requests'
					})
				)
			);

			const client = new TestableBaseArrClient(validConfig);

			await expect(client.exposedRequest('system/status')).rejects.toThrow(RateLimitError);
		});

		it('should include Retry-After in RateLimitError when provided', async () => {
			globalThis.fetch = createMockFetch(
				vi.fn().mockResolvedValue(
					new Response('Too Many Requests', {
						status: 429,
						statusText: 'Too Many Requests',
						headers: { 'Retry-After': '60' }
					})
				)
			);

			const client = new TestableBaseArrClient(validConfig);

			try {
				await client.exposedRequest('system/status');
				expect.fail('Should have thrown RateLimitError');
			} catch (error) {
				expect(error).toBeInstanceOf(RateLimitError);
				expect((error as RateLimitError).retryAfter).toBe(60);
			}
		});

		it('should throw ServerError for HTTP 500', async () => {
			globalThis.fetch = createMockFetch(
				vi.fn().mockResolvedValue(
					new Response('Internal Server Error', {
						status: 500,
						statusText: 'Internal Server Error'
					})
				)
			);

			const client = new TestableBaseArrClient(validConfig);

			try {
				await client.exposedRequest('system/status');
				expect.fail('Should have thrown ServerError');
			} catch (error) {
				expect(error).toBeInstanceOf(ServerError);
				expect((error as ServerError).statusCode).toBe(500);
			}
		});

		it('should throw ServerError for HTTP 502', async () => {
			globalThis.fetch = createMockFetch(
				vi.fn().mockResolvedValue(
					new Response('Bad Gateway', {
						status: 502,
						statusText: 'Bad Gateway'
					})
				)
			);

			const client = new TestableBaseArrClient(validConfig);

			try {
				await client.exposedRequest('system/status');
				expect.fail('Should have thrown ServerError');
			} catch (error) {
				expect(error).toBeInstanceOf(ServerError);
				expect((error as ServerError).statusCode).toBe(502);
			}
		});

		it('should throw ServerError for HTTP 503', async () => {
			globalThis.fetch = createMockFetch(
				vi.fn().mockResolvedValue(
					new Response('Service Unavailable', {
						status: 503,
						statusText: 'Service Unavailable'
					})
				)
			);

			const client = new TestableBaseArrClient(validConfig);

			try {
				await client.exposedRequest('system/status');
				expect.fail('Should have thrown ServerError');
			} catch (error) {
				expect(error).toBeInstanceOf(ServerError);
				expect((error as ServerError).statusCode).toBe(503);
			}
		});

		it('should throw NetworkError for connection refused', async () => {
			globalThis.fetch = createMockFetch(vi.fn().mockRejectedValue(new TypeError('fetch failed')));

			const client = new TestableBaseArrClient(validConfig);

			try {
				await client.exposedRequest('system/status');
				expect.fail('Should have thrown NetworkError');
			} catch (error) {
				expect(error).toBeInstanceOf(NetworkError);
				expect((error as NetworkError).errorCause).toBe('connection_refused');
			}
		});

		it('should throw TimeoutError for AbortError', async () => {
			const abortError = new DOMException('The operation was aborted', 'AbortError');
			globalThis.fetch = createMockFetch(vi.fn().mockRejectedValue(abortError));

			const client = new TestableBaseArrClient(validConfig);

			try {
				await client.exposedRequest('system/status');
				expect.fail('Should have thrown TimeoutError');
			} catch (error) {
				expect(error).toBeInstanceOf(TimeoutError);
			}
		});
	});

	describe('Successful Responses', () => {
		it('should parse JSON response', async () => {
			const mockData = { appName: 'Sonarr', version: '4.0.0' };

			globalThis.fetch = createMockFetch(
				vi.fn().mockResolvedValue(
					new Response(JSON.stringify(mockData), {
						status: 200,
						headers: { 'Content-Type': 'application/json' }
					})
				)
			);

			const client = new TestableBaseArrClient(validConfig);
			const result = await client.exposedRequest<typeof mockData>('system/status');

			expect(result).toEqual(mockData);
		});
	});
});

describe('BaseArrClient.ping()', () => {
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

	it('should return true when server responds OK', async () => {
		globalThis.fetch = createMockFetch(
			vi.fn().mockResolvedValue(new Response('Pong', { status: 200 }))
		);

		const client = new BaseArrClient(validConfig);
		const result = await client.ping();

		expect(result).toBe(true);
	});

	it('should return false when server returns error', async () => {
		globalThis.fetch = createMockFetch(
			vi.fn().mockResolvedValue(new Response('Unauthorized', { status: 401 }))
		);

		const client = new BaseArrClient(validConfig);
		const result = await client.ping();

		expect(result).toBe(false);
	});

	it('should return false when network error occurs', async () => {
		globalThis.fetch = createMockFetch(vi.fn().mockRejectedValue(new TypeError('fetch failed')));

		const client = new BaseArrClient(validConfig);
		const result = await client.ping();

		expect(result).toBe(false);
	});

	it('should call /ping endpoint directly (not /api/v3/ping)', async () => {
		let capturedUrl: string | undefined;

		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async (url: string) => {
				capturedUrl = url;
				return new Response('Pong', { status: 200 });
			})
		);

		const client = new BaseArrClient(validConfig);
		await client.ping();

		expect(capturedUrl).toBe('http://localhost:8989/ping');
	});
});

describe('Error Properties', () => {
	describe('NetworkError', () => {
		it('should have correct properties', () => {
			const error = new NetworkError('Connection failed', 'connection_refused');

			expect(error.name).toBe('NetworkError');
			expect(error.message).toBe('Connection failed');
			expect(error.errorCause).toBe('connection_refused');
			expect(error.category).toBe('network');
			expect(error.retryable).toBe(true);
			expect(error.timestamp).toBeInstanceOf(Date);
		});
	});

	describe('AuthenticationError', () => {
		it('should have correct properties', () => {
			const error = new AuthenticationError();

			expect(error.name).toBe('AuthenticationError');
			expect(error.message).toBe('Invalid API key');
			expect(error.category).toBe('authentication');
			expect(error.retryable).toBe(false);
			expect(error.timestamp).toBeInstanceOf(Date);
		});

		it('should accept custom message', () => {
			const error = new AuthenticationError('API key expired');

			expect(error.message).toBe('API key expired');
		});
	});

	describe('RateLimitError', () => {
		it('should have correct properties without retryAfter', () => {
			const error = new RateLimitError();

			expect(error.name).toBe('RateLimitError');
			expect(error.message).toBe('Rate limit exceeded');
			expect(error.category).toBe('rate_limit');
			expect(error.retryable).toBe(true);
			expect(error.retryAfter).toBeUndefined();
			expect(error.timestamp).toBeInstanceOf(Date);
		});

		it('should have correct properties with retryAfter', () => {
			const error = new RateLimitError(60);

			expect(error.retryAfter).toBe(60);
		});
	});

	describe('ServerError', () => {
		it('should have correct properties', () => {
			const error = new ServerError(503, 'Service Unavailable');

			expect(error.name).toBe('ServerError');
			expect(error.message).toBe('Service Unavailable');
			expect(error.statusCode).toBe(503);
			expect(error.category).toBe('server');
			expect(error.retryable).toBe(true);
			expect(error.timestamp).toBeInstanceOf(Date);
		});
	});

	describe('TimeoutError', () => {
		it('should have correct properties', () => {
			const error = new TimeoutError(30000);

			expect(error.name).toBe('TimeoutError');
			expect(error.message).toBe('Request timed out after 30000ms');
			expect(error.timeoutMs).toBe(30000);
			expect(error.category).toBe('timeout');
			expect(error.retryable).toBe(true);
			expect(error.timestamp).toBeInstanceOf(Date);
		});
	});
});
