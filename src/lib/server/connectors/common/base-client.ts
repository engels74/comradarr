import {
	type ArrClientError,
	AuthenticationError,
	isArrClientError,
	NetworkError,
	NotFoundError,
	RateLimitError,
	ServerError,
	SSLError,
	TimeoutError
} from './errors.js';
import { DEFAULT_RETRY_CONFIG, withRetry } from './retry.js';
import type {
	BaseClientConfig,
	HealthCheck,
	RequestOptions,
	RetryConfig,
	SystemStatus
} from './types.js';

const DEFAULT_TIMEOUT = 30000;
const DEFAULT_USER_AGENT = 'Comradarr/1.0';
const API_VERSION = 'v3';

export class BaseArrClient {
	protected readonly baseUrl: string;
	protected readonly apiKey: string;
	protected readonly timeout: number;
	protected readonly userAgent: string;
	protected readonly retryConfig: Required<RetryConfig>;

	constructor(config: BaseClientConfig) {
		this.baseUrl = config.baseUrl.replace(/\/+$/, '');
		this.apiKey = config.apiKey;
		this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
		this.userAgent = config.userAgent ?? DEFAULT_USER_AGENT;
		this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...config.retry };
	}

	protected buildUrl(endpoint: string): string {
		const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
		return `${this.baseUrl}/api/${API_VERSION}${path}`;
	}

	protected async request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
		const url = this.buildUrl(endpoint);
		const timeout = options.timeout ?? this.timeout;

		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), timeout);

		if (options.signal) {
			options.signal.addEventListener('abort', () => controller.abort());
		}

		try {
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

			if (options.body !== undefined) {
				requestInit.body = JSON.stringify(options.body);
			}

			const response = await fetch(url, requestInit);

			clearTimeout(timeoutId);

			if (!response.ok) {
				throw this.handleErrorResponse(response, endpoint);
			}

			return (await response.json()) as T;
		} catch (error) {
			clearTimeout(timeoutId);
			throw this.categorizeError(error, timeout);
		}
	}

	protected async requestWithRetry<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
		return withRetry(() => this.request<T>(endpoint, options), this.retryConfig);
	}

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

	private categorizeError(error: unknown, timeout: number): ArrClientError {
		if (isArrClientError(error)) {
			return error;
		}

		if (error instanceof DOMException && error.name === 'AbortError') {
			return new TimeoutError(timeout);
		}

		if (error instanceof Error && error.name === 'TimeoutError') {
			return new TimeoutError(timeout);
		}

		if (error instanceof TypeError) {
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

			if (message.includes('fetch failed') || message.includes('econnrefused')) {
				return new NetworkError('Connection refused', 'connection_refused');
			}
			if (
				message.includes('getaddrinfo') ||
				message.includes('dns') ||
				message.includes('enotfound')
			) {
				return new NetworkError('DNS lookup failed', 'dns_failure');
			}
		}

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

		return new NetworkError(
			error instanceof Error ? error.message : 'Unknown network error',
			'unknown'
		);
	}

	async ping(): Promise<boolean> {
		try {
			const response = await fetch(`${this.baseUrl}/ping`, {
				method: 'GET',
				headers: {
					'X-Api-Key': this.apiKey,
					'User-Agent': this.userAgent
				},
				signal: AbortSignal.timeout(5000)
			});
			return response.ok;
		} catch {
			return false;
		}
	}

	async getSystemStatus(): Promise<SystemStatus> {
		return this.request<SystemStatus>('system/status');
	}

	async getHealth(): Promise<HealthCheck[]> {
		return this.request<HealthCheck[]>('health');
	}
}
