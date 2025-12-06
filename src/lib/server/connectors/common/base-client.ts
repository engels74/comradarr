/**
 * Base API client for *arr applications
 *
 * Provides core HTTP functionality for communicating with Sonarr, Radarr, and Whisparr:
 * - X-Api-Key header authentication
 * - Configurable request timeout (default: 30s)
 * - User-Agent header
 * - Typed error handling
 * - Automatic retry with exponential backoff
 *
 * @module connectors/common/base-client

 */

import type { BaseClientConfig, RequestOptions, SystemStatus, HealthCheck, RetryConfig } from './types.js';
import { withRetry, DEFAULT_RETRY_CONFIG } from './retry.js';
import {
	type ArrClientError,
	NetworkError,
	AuthenticationError,
	RateLimitError,
	ServerError,
	TimeoutError,
	NotFoundError,
	SSLError,
	isArrClientError
} from './errors.js';

/** Default request timeout in milliseconds (30 seconds) */
const DEFAULT_TIMEOUT = 30000;

/** Default User-Agent header value */
const DEFAULT_USER_AGENT = 'Comradarr/1.0';

/** *arr API version */
const API_VERSION = 'v3';

/**
 * Base client for *arr API communication
 *
 * This class provides the foundation for connector-specific clients (Sonarr, Radarr, Whisparr).
 * It handles authentication, timeouts, and error categorization.
 *
 * @example
 * ```typescript
 * const client = new BaseArrClient({
 *   baseUrl: 'http://localhost:8989',
 *   apiKey: 'your-api-key',
 *   timeout: 30000
 * });
 *
 * const isReachable = await client.ping();
 * ```
 */
export class BaseArrClient {
	/** Normalized base URL (without trailing slash) */
	protected readonly baseUrl: string;

	/** API key for X-Api-Key header */
	protected readonly apiKey: string;

	/** Request timeout in milliseconds */
	protected readonly timeout: number;

	/** User-Agent header value */
	protected readonly userAgent: string;

	/** Retry configuration for failed requests */
	protected readonly retryConfig: Required<RetryConfig>;

	/**
	 * Create a new BaseArrClient instance
	 *
	 * @param config - Client configuration

	 */
	constructor(config: BaseClientConfig) {
		// Normalize URL by removing trailing slashes
		this.baseUrl = config.baseUrl.replace(/\/+$/, '');
		this.apiKey = config.apiKey;
		this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
		this.userAgent = config.userAgent ?? DEFAULT_USER_AGENT;
		this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...config.retry };
	}

	/**
	 * Build the full API URL for an endpoint
	 *
	 * @param endpoint - API endpoint path (e.g., 'system/status' or '/system/status')
	 * @returns Full URL including base URL and API version
	 */
	protected buildUrl(endpoint: string): string {
		const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
		return `${this.baseUrl}/api/${API_VERSION}${path}`;
	}

	/**
	 * Make an HTTP request to the *arr API
	 *
	 * @param endpoint - API endpoint path
	 * @param options - Request options (method, body, timeout, signal)
	 * @returns Parsed JSON response
	 * @throws {AuthenticationError} When API key is invalid (HTTP 401)
	 * @throws {RateLimitError} When rate limited (HTTP 429)
	 * @throws {ServerError} When server error occurs (HTTP 5xx)
	 * @throws {TimeoutError} When request times out
	 * @throws {NetworkError} When network error occurs

	 */
	protected async request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
		const url = this.buildUrl(endpoint);
		const timeout = options.timeout ?? this.timeout;

		// Create abort controller for timeout management
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), timeout);

		// Combine with external signal if provided
		if (options.signal) {
			options.signal.addEventListener('abort', () => controller.abort());
		}

		try {
			// Build request init - only include body for non-GET requests when provided
			const requestInit: RequestInit = {
				method: options.method ?? 'GET',
				headers: {
					'X-Api-Key': this.apiKey,
					'Content-Type': 'application/json',
					'User-Agent': this.userAgent,
					Accept: 'application/json'
				},
				signal: controller.signal
			};

			// Only add body if it's provided (satisfies exactOptionalPropertyTypes)
			if (options.body !== undefined) {
				requestInit.body = JSON.stringify(options.body);
			}

			const response = await fetch(url, requestInit);

			clearTimeout(timeoutId);

			// Handle error responses
			if (!response.ok) {
				throw this.handleErrorResponse(response, endpoint);
			}

			// Parse JSON response
			return (await response.json()) as T;
		} catch (error) {
			clearTimeout(timeoutId);
			throw this.categorizeError(error, timeout);
		}
	}

	/**
	 * Make an HTTP request with automatic retry logic
	 *
	 * Wraps the standard request method with retry behavior:
	 * - Retries on network errors, server errors (5xx), timeouts, and rate limits
	 * - Does NOT retry on authentication errors (401), not found (404), or SSL errors
	 * - Uses exponential backoff with configurable delays
	 * - Respects Retry-After header for rate limit errors
	 *
	 * @param endpoint - API endpoint path
	 * @param options - Request options (method, body, timeout, signal)
	 * @returns Parsed JSON response
	 * @throws {ArrClientError} After all retries exhausted or for non-retryable errors

	 */
	protected async requestWithRetry<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
		return withRetry(() => this.request<T>(endpoint, options), this.retryConfig);
	}

	/**
	 * Convert HTTP error responses to typed errors
	 *
	 * @param response - Failed HTTP response
	 * @param endpoint - The API endpoint that was called (for error context)
	 * @returns Typed error based on status code

	 */
	private handleErrorResponse(response: Response, endpoint: string): ArrClientError {
		switch (response.status) {
			case 401:
				return new AuthenticationError();

			case 404:
				return new NotFoundError(endpoint);

			case 429: {
				const retryAfterHeader = response.headers.get('Retry-After');
				const retryAfter = retryAfterHeader ? parseInt(retryAfterHeader, 10) : undefined;
				return new RateLimitError(Number.isNaN(retryAfter) ? undefined : retryAfter);
			}

			default:
				if (response.status >= 500) {
					return new ServerError(response.status, response.statusText || `Server Error`);
				}
				return new ServerError(
					response.status,
					`HTTP ${response.status}: ${response.statusText || 'Unknown Error'}`
				);
		}
	}

	/**
	 * Categorize fetch errors into typed errors
	 *
	 * @param error - The caught error
	 * @param timeout - Timeout value for timeout error creation
	 * @returns Typed error

	 */
	private categorizeError(error: unknown, timeout: number): ArrClientError {
		// Already a typed error, pass through
		if (isArrClientError(error)) {
			return error;
		}

		// Abort/timeout error (from AbortController or AbortSignal.timeout)
		if (error instanceof DOMException && error.name === 'AbortError') {
			return new TimeoutError(timeout);
		}

		// Also handle TimeoutError from AbortSignal.timeout
		if (error instanceof Error && error.name === 'TimeoutError') {
			return new TimeoutError(timeout);
		}

		// Network errors (TypeError from fetch)
		if (error instanceof TypeError) {
			const message = error.message.toLowerCase();

			// SSL certificate errors
			if (
				message.includes('ssl') ||
				message.includes('certificate') ||
				message.includes('cert_') ||
				message.includes('unable_to_verify') ||
				message.includes('self signed') ||
				message.includes('self-signed')
			) {
				return new SSLError(error.message);
			}

			// Connection refused
			if (message.includes('fetch failed') || message.includes('econnrefused')) {
				return new NetworkError('Connection refused', 'connection_refused');
			}

			// DNS failure
			if (message.includes('getaddrinfo') || message.includes('dns') || message.includes('enotfound')) {
				return new NetworkError('DNS lookup failed', 'dns_failure');
			}
		}

		// Check for SSL errors in other error types
		if (error instanceof Error) {
			const message = error.message.toLowerCase();
			if (
				message.includes('ssl') ||
				message.includes('certificate') ||
				message.includes('cert_') ||
				message.includes('unable_to_verify') ||
				message.includes('self signed') ||
				message.includes('self-signed')
			) {
				return new SSLError(error.message);
			}
		}

		// Unknown error - wrap as NetworkError
		return new NetworkError(
			error instanceof Error ? error.message : 'Unknown network error',
			'unknown'
		);
	}

	/**
	 * Test connectivity to the *arr application
	 *
	 * Uses the /ping endpoint which returns "Pong" if the server is reachable.
	 * This endpoint may or may not require authentication depending on the *arr version.
	 *
	 * @returns true if the server responds successfully, false otherwise

	 */
	async ping(): Promise<boolean> {
		try {
			const response = await fetch(`${this.baseUrl}/ping`, {
				method: 'GET',
				headers: {
					'X-Api-Key': this.apiKey,
					'User-Agent': this.userAgent
				},
				signal: AbortSignal.timeout(5000) // Short timeout for ping
			});
			return response.ok;
		} catch {
			return false;
		}
	}

	/**
	 * Get system status from the *arr application
	 *
	 * @returns System status information including version, build time, etc.
	 * @throws {ArrClientError} On any API error

	 */
	async getSystemStatus(): Promise<SystemStatus> {
		return this.request<SystemStatus>('system/status');
	}

	/**
	 * Get health check results from the *arr application
	 *
	 * @returns Array of health check items with status and messages
	 * @throws {ArrClientError} On any API error

	 */
	async getHealth(): Promise<HealthCheck[]> {
		return this.request<HealthCheck[]>('health');
	}
}
