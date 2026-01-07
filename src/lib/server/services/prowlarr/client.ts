// Prowlarr uses API v1 (not v3 like *arr apps), authentication via X-Api-Key header

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
} from '$lib/server/connectors/common/errors';
import { parseProwlarrIndexer, parseProwlarrIndexerStatus } from './parsers.js';
import type {
	IndexerHealth,
	ProwlarrClientConfig,
	ProwlarrIndexer,
	ProwlarrIndexerStatus
} from './types.js';

const DEFAULT_TIMEOUT = 30000;
const DEFAULT_USER_AGENT = 'Comradarr/1.0';
const API_VERSION = 'v1';

export class ProwlarrClient {
	private readonly baseUrl: string;
	private readonly apiKey: string;
	private readonly timeout: number;
	private readonly userAgent: string;

	constructor(config: ProwlarrClientConfig) {
		// Normalize URL by removing trailing slashes
		this.baseUrl = config.baseUrl.replace(/\/+$/, '');
		this.apiKey = config.apiKey;
		this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
		this.userAgent = config.userAgent ?? DEFAULT_USER_AGENT;
	}

	private buildUrl(endpoint: string): string {
		const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
		return `${this.baseUrl}/api/${API_VERSION}${path}`;
	}

	private async request<T>(endpoint: string): Promise<T> {
		const url = this.buildUrl(endpoint);
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), this.timeout);

		try {
			const response = await fetch(url, {
				method: 'GET',
				headers: {
					'X-Api-Key': this.apiKey,
					'Content-Type': 'application/json',
					'User-Agent': this.userAgent,
					Accept: 'application/json'
				},
				signal: controller.signal
			});

			clearTimeout(timeoutId);

			if (!response.ok) {
				throw this.handleErrorResponse(response, endpoint);
			}

			return (await response.json()) as T;
		} catch (error) {
			clearTimeout(timeoutId);
			throw this.categorizeError(error, this.timeout);
		}
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
					return new ServerError(response.status, response.statusText || 'Server Error');
				}
				return new ServerError(
					response.status,
					`HTTP ${response.status}: ${response.statusText || 'Unknown Error'}`
				);
		}
	}

	private categorizeError(error: unknown, timeout: number): ArrClientError {
		// Already an ArrClientError, pass through
		if (isArrClientError(error)) {
			return error;
		}

		// Abort signal timeout
		if (error instanceof DOMException && error.name === 'AbortError') {
			return new TimeoutError(timeout);
		}

		// Explicit timeout error
		if (error instanceof Error && error.name === 'TimeoutError') {
			return new TimeoutError(timeout);
		}

		// TypeErrors from fetch indicate network issues
		if (error instanceof TypeError) {
			const message = error.message.toLowerCase();

			// SSL/TLS errors
			if (
				message.includes('ssl') ||
				message.includes('certificate') ||
				message.includes('self signed')
			) {
				return new SSLError(error.message);
			}

			// Connection refused
			if (message.includes('fetch failed') || message.includes('econnrefused')) {
				return new NetworkError('Connection refused', 'connection_refused');
			}

			// DNS resolution failures
			if (
				message.includes('getaddrinfo') ||
				message.includes('dns') ||
				message.includes('enotfound')
			) {
				return new NetworkError('DNS lookup failed', 'dns_failure');
			}
		}

		// Unknown error - wrap as network error
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

	async getIndexerStatuses(): Promise<ProwlarrIndexerStatus[]> {
		const response = await this.request<unknown[]>('indexerstatus');

		const statuses: ProwlarrIndexerStatus[] = [];
		for (const item of response) {
			const result = parseProwlarrIndexerStatus(item);
			if (result.success) {
				statuses.push(result.data);
			}
			// Skip malformed records silently (graceful degradation)
		}

		return statuses;
	}

	async getIndexers(): Promise<ProwlarrIndexer[]> {
		const response = await this.request<unknown[]>('indexer');

		const indexers: ProwlarrIndexer[] = [];
		for (const item of response) {
			const result = parseProwlarrIndexer(item);
			if (result.success) {
				indexers.push(result.data);
			}
			// Skip malformed records silently (graceful degradation)
		}

		return indexers;
	}

	// Joins indexer definitions with status to provide unified view of availability and rate-limiting
	async getIndexerHealth(): Promise<IndexerHealth[]> {
		// Fetch both endpoints in parallel for efficiency
		const [indexers, statuses] = await Promise.all([this.getIndexers(), this.getIndexerStatuses()]);

		// Create status lookup by indexerId
		const statusMap = new Map<number, ProwlarrIndexerStatus>();
		for (const status of statuses) {
			statusMap.set(status.indexerId, status);
		}

		const now = new Date();

		return indexers.map((indexer) => {
			const status = statusMap.get(indexer.id);
			let isRateLimited = false;
			let rateLimitExpiresAt: Date | null = null;
			let mostRecentFailure: Date | null = null;

			if (status) {
				// Mark as rate-limited when disabledTill is in the future
				if (status.disabledTill) {
					const disabledUntil = new Date(status.disabledTill);
					if (disabledUntil > now) {
						isRateLimited = true;
						rateLimitExpiresAt = disabledUntil;
					}
				}

				if (status.mostRecentFailure) {
					mostRecentFailure = new Date(status.mostRecentFailure);
				}
			}

			return {
				indexerId: indexer.id,
				name: indexer.name,
				isRateLimited,
				rateLimitExpiresAt,
				mostRecentFailure,
				enabled: indexer.enable
			};
		});
	}
}
