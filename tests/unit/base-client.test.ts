/**
 * Unit tests for BaseArrClient
 *
 * Tests cover:
 * - Constructor behavior (URL normalization, default values)
 * - URL building
 * - Error categorization
 * - Ping behavior
 *

 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import {
	BaseArrClient,
	NetworkError,
	AuthenticationError,
	RateLimitError,
	ServerError,
	TimeoutError,
	NotFoundError,
	SSLError
} from '../../src/lib/server/connectors/index';

// Helper to create a mock fetch that satisfies TypeScript
function createMockFetch(impl: Mock): typeof fetch {
	return impl as unknown as typeof fetch;
}

import type { RetryConfig } from '../../src/lib/server/connectors/index';

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

	public get exposedRetryConfig(): Required<RetryConfig> {
		return this.retryConfig;
	}

	// Expose request method for testing
	public async exposedRequest<T>(
		endpoint: string,
		options?: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown; timeout?: number }
	): Promise<T> {
		return this.request<T>(endpoint, options);
	}

	// Expose requestWithRetry method for testing
	public async exposedRequestWithRetry<T>(
		endpoint: string,
		options?: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown; timeout?: number }
	): Promise<T> {
		return this.requestWithRetry<T>(endpoint, options);
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

		it('should throw NotFoundError for HTTP 404', async () => {
			globalThis.fetch = createMockFetch(
				vi.fn().mockResolvedValue(
					new Response('Not Found', {
						status: 404,
						statusText: 'Not Found'
					})
				)
			);

			const client = new TestableBaseArrClient(validConfig);

			try {
				await client.exposedRequest('series/12345');
				expect.fail('Should have thrown NotFoundError');
			} catch (error) {
				expect(error).toBeInstanceOf(NotFoundError);
				expect((error as NotFoundError).resource).toBe('series/12345');
				expect((error as NotFoundError).retryable).toBe(false);
			}
		});

		it('should throw SSLError for SSL certificate errors', async () => {
			const sslError = new TypeError('self signed certificate in certificate chain');
			globalThis.fetch = createMockFetch(vi.fn().mockRejectedValue(sslError));

			const client = new TestableBaseArrClient(validConfig);

			try {
				await client.exposedRequest('system/status');
				expect.fail('Should have thrown SSLError');
			} catch (error) {
				expect(error).toBeInstanceOf(SSLError);
				expect((error as SSLError).retryable).toBe(false);
			}
		});

		it('should throw SSLError for certificate validation failure', async () => {
			const sslError = new TypeError('unable to verify the first certificate');
			globalThis.fetch = createMockFetch(vi.fn().mockRejectedValue(sslError));

			const client = new TestableBaseArrClient(validConfig);

			try {
				await client.exposedRequest('system/status');
				expect.fail('Should have thrown SSLError');
			} catch (error) {
				expect(error).toBeInstanceOf(SSLError);
				expect((error as SSLError).category).toBe('ssl');
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

	describe('NotFoundError', () => {
		it('should have correct properties', () => {
			const error = new NotFoundError('series/12345');

			expect(error.name).toBe('NotFoundError');
			expect(error.message).toBe('Resource not found: series/12345');
			expect(error.resource).toBe('series/12345');
			expect(error.category).toBe('not_found');
			expect(error.retryable).toBe(false);
			expect(error.timestamp).toBeInstanceOf(Date);
		});

		it('should accept custom message', () => {
			const error = new NotFoundError('series/12345', 'Series does not exist');

			expect(error.message).toBe('Series does not exist');
			expect(error.resource).toBe('series/12345');
		});
	});

	describe('SSLError', () => {
		it('should have correct properties with default message', () => {
			const error = new SSLError();

			expect(error.name).toBe('SSLError');
			expect(error.message).toBe('SSL certificate validation failed');
			expect(error.category).toBe('ssl');
			expect(error.retryable).toBe(false);
			expect(error.timestamp).toBeInstanceOf(Date);
		});

		it('should accept custom message', () => {
			const error = new SSLError('self signed certificate in certificate chain');

			expect(error.message).toBe('self signed certificate in certificate chain');
		});
	});
});

describe('BaseArrClient Retry Configuration', () => {
	const validConfig = {
		baseUrl: 'http://localhost:8989',
		apiKey: 'test-api-key-12345'
	};

	describe('Default retry config', () => {
		it('should use default retry configuration when not provided', () => {
			const client = new TestableBaseArrClient(validConfig);

			expect(client.exposedRetryConfig.maxRetries).toBe(3);
			expect(client.exposedRetryConfig.baseDelay).toBe(1000);
			expect(client.exposedRetryConfig.maxDelay).toBe(30000);
			expect(client.exposedRetryConfig.multiplier).toBe(2);
			expect(client.exposedRetryConfig.jitter).toBe(true);
		});
	});

	describe('Custom retry config', () => {
		it('should use custom retry configuration when provided', () => {
			const client = new TestableBaseArrClient({
				...validConfig,
				retry: {
					maxRetries: 5,
					baseDelay: 500,
					maxDelay: 10000,
					multiplier: 1.5,
					jitter: false
				}
			});

			expect(client.exposedRetryConfig.maxRetries).toBe(5);
			expect(client.exposedRetryConfig.baseDelay).toBe(500);
			expect(client.exposedRetryConfig.maxDelay).toBe(10000);
			expect(client.exposedRetryConfig.multiplier).toBe(1.5);
			expect(client.exposedRetryConfig.jitter).toBe(false);
		});

		it('should merge partial retry config with defaults', () => {
			const client = new TestableBaseArrClient({
				...validConfig,
				retry: {
					maxRetries: 5
				}
			});

			expect(client.exposedRetryConfig.maxRetries).toBe(5);
			expect(client.exposedRetryConfig.baseDelay).toBe(1000); // default
			expect(client.exposedRetryConfig.maxDelay).toBe(30000); // default
			expect(client.exposedRetryConfig.multiplier).toBe(2); // default
			expect(client.exposedRetryConfig.jitter).toBe(true); // default
		});
	});
});

describe('BaseArrClient.requestWithRetry()', () => {
	const validConfig = {
		baseUrl: 'http://localhost:8989',
		apiKey: 'test-api-key-12345'
	};

	let originalFetch: typeof fetch;

	beforeEach(() => {
		originalFetch = globalThis.fetch;
		vi.useFakeTimers();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	it('should return data on successful request', async () => {
		const mockData = { status: 'ok' };

		globalThis.fetch = createMockFetch(
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify(mockData), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				})
			)
		);

		const client = new TestableBaseArrClient(validConfig);
		const result = await client.exposedRequestWithRetry<typeof mockData>('system/status');

		expect(result).toEqual(mockData);
	});

	it('should retry on server error and succeed', async () => {
		const mockData = { status: 'ok' };
		let callCount = 0;

		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async () => {
				callCount++;
				if (callCount === 1) {
					return new Response('Server Error', { status: 500 });
				}
				return new Response(JSON.stringify(mockData), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				});
			})
		);

		const client = new TestableBaseArrClient({
			...validConfig,
			retry: { maxRetries: 3, jitter: false }
		});

		const resultPromise = (async () => {
			const promise = client.exposedRequestWithRetry<typeof mockData>('system/status');
			await vi.runAllTimersAsync();
			return promise;
		})();

		const result = await resultPromise;
		expect(result).toEqual(mockData);
		expect(callCount).toBe(2);
	});

	it('should not retry on authentication error', async () => {
		let callCount = 0;

		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async () => {
				callCount++;
				return new Response('Unauthorized', { status: 401 });
			})
		);

		const client = new TestableBaseArrClient({
			...validConfig,
			retry: { maxRetries: 3 }
		});

		await expect(client.exposedRequestWithRetry('system/status')).rejects.toThrow(AuthenticationError);
		expect(callCount).toBe(1);
	});

	it('should not retry on not found error', async () => {
		let callCount = 0;

		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async () => {
				callCount++;
				return new Response('Not Found', { status: 404 });
			})
		);

		const client = new TestableBaseArrClient({
			...validConfig,
			retry: { maxRetries: 3 }
		});

		await expect(client.exposedRequestWithRetry('series/123')).rejects.toThrow(NotFoundError);
		expect(callCount).toBe(1);
	});

	it('should exhaust retries and throw last error', async () => {
		let callCount = 0;

		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async () => {
				callCount++;
				return new Response('Service Unavailable', { status: 503 });
			})
		);

		const client = new TestableBaseArrClient({
			...validConfig,
			retry: { maxRetries: 2, jitter: false }
		});

		// Create promise and immediately set up error handling
		let caughtError: unknown;
		const promise = client.exposedRequestWithRetry('system/status').catch((e) => {
			caughtError = e;
		});

		// Advance timers to complete all retries
		await vi.runAllTimersAsync();
		await promise;

		expect(caughtError).toBeInstanceOf(ServerError);
		expect(callCount).toBe(3); // 1 initial + 2 retries
	});
});
