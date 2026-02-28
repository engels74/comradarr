import { createLogger } from '$lib/server/logger';
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
import type { LenientParseResult, ParseResult } from './parsers.js';
import { parseCommandResponse } from './parsers.js';
import { DEFAULT_RETRY_CONFIG, withRetry } from './retry.js';
import type {
	BaseClientConfig,
	CommandResponse,
	HealthCheck,
	PaginatedResponse,
	RequestOptions,
	RetryConfig,
	SystemStatus,
	WantedOptions
} from './types.js';

const logger = createLogger('arr-client');

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
		const method = options.method ?? 'GET';
		const startTime = performance.now();

		logger.debug('API request', { method, endpoint, baseUrl: this.baseUrl });

		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), timeout);

		if (options.signal) {
			options.signal.addEventListener('abort', () => controller.abort());
		}

		try {
			const requestInit: RequestInit = {
				method,
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
			const durationMs = Math.round(performance.now() - startTime);

			clearTimeout(timeoutId);

			if (!response.ok) {
				throw this.handleErrorResponse(response, endpoint);
			}

			// Warn on slow API responses (>5 seconds)
			if (durationMs > 5000) {
				logger.warn('Slow API response', {
					method,
					endpoint,
					statusCode: response.status,
					durationMs
				});
			} else {
				logger.debug('API response', { method, endpoint, statusCode: response.status, durationMs });
			}

			return (await response.json()) as T;
		} catch (error) {
			clearTimeout(timeoutId);
			const categorized = this.categorizeError(error, timeout);
			const durationMs = Math.round(performance.now() - startTime);
			logger.warn('API request failed', {
				method,
				endpoint,
				durationMs,
				errorType: categorized.name,
				errorCategory: categorized.category,
				errorMessage: categorized.message,
				...('statusCode' in categorized && { statusCode: categorized.statusCode }),
				...('retryAfter' in categorized && { retryAfterSeconds: categorized.retryAfter })
			});
			throw categorized;
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

	private isSSLError(message: string): boolean {
		const lower = message.toLowerCase();
		return (
			lower.includes('ssl') ||
			lower.includes('certificate') ||
			lower.includes('cert_') ||
			lower.includes('unable_to_verify') ||
			lower.includes('self signed') ||
			lower.includes('self-signed')
		);
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

		if (error instanceof Error) {
			if (this.isSSLError(error.message)) {
				return new SSLError(error.message);
			}

			if (error instanceof TypeError) {
				const message = error.message.toLowerCase();
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
		}

		return new NetworkError(
			error instanceof Error ? error.message : 'Unknown network error',
			'unknown'
		);
	}

	protected parseArrayLenient<T>(
		response: unknown[],
		parser: (item: unknown) => ParseResult<T>,
		options: {
			resourceType: string;
			safeFields: string[];
			context?: Record<string, unknown>;
		}
	): T[] {
		if (!Array.isArray(response)) {
			throw new Error(
				`Expected array response from /${options.resourceType} endpoint, got ${typeof response}`
			);
		}

		const results: T[] = [];
		let skipped = 0;
		for (const item of response) {
			const result = parser(item);
			if (result.success) {
				results.push(result.data);
			} else {
				skipped++;
				if (skipped <= 3) {
					const safeItem =
						item && typeof item === 'object'
							? Object.fromEntries(
									options.safeFields.map((f) => [f, (item as Record<string, unknown>)[f]])
								)
							: { type: typeof item };
					logger.warn(`Failed to parse ${options.resourceType} record`, {
						error: result.error,
						sample: safeItem
					});
				}
			}
		}

		if (skipped > 0) {
			logger.warn(`Skipped malformed ${options.resourceType} records`, {
				...options.context,
				skipped,
				total: response.length,
				parsed: results.length
			});
		}

		if (results.length === 0 && response.length > 0) {
			throw new Error(
				`All ${response.length} ${options.resourceType} failed parsing - possible API schema mismatch`
			);
		}

		return results;
	}

	protected async fetchAllPaginated<T>(
		endpoint: string,
		parser: (data: unknown) => LenientParseResult<PaginatedResponse<T>>,
		options?: WantedOptions
	): Promise<T[]> {
		const pageSize = options?.pageSize ?? 1000;
		const monitored = options?.monitored ?? true;
		const sortKey = options?.sortKey ?? 'airDateUtc';
		const sortDirection = options?.sortDirection ?? 'descending';

		let page = options?.page ?? 1;
		const allRecords: T[] = [];

		while (true) {
			const queryParams = new URLSearchParams({
				page: String(page),
				pageSize: String(pageSize),
				monitored: String(monitored),
				sortKey,
				sortDirection
			});

			const response = await this.requestWithRetry<unknown>(
				`${endpoint}?${queryParams.toString()}`
			);

			const result = parser(response);
			if (!result.success) {
				throw new Error(result.error);
			}

			allRecords.push(...result.data.records);

			if (page * pageSize >= result.data.totalRecords) {
				break;
			}

			page++;
		}

		return allRecords;
	}

	async getCommandStatus(commandId: number): Promise<CommandResponse> {
		const response = await this.requestWithRetry<unknown>(`command/${commandId}`);

		const result = parseCommandResponse(response);
		if (!result.success) {
			throw new Error(result.error);
		}
		return result.data;
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
