import { createLogger } from '$lib/server/logger';
import { BaseArrClient } from '../common/base-client.js';
import { parseCommandResponse } from '../common/parsers.js';
import type { CommandResponse, PaginationOptions } from '../common/types.js';
import { parsePaginatedMoviesLenient, parseRadarrMovie } from './parsers.js';
import type { RadarrMovie } from './types.js';

const logger = createLogger('radarr-client');

export interface WantedOptions extends PaginationOptions {
	monitored?: boolean;
}

export interface ApiVersionInfo {
	appVersion: string;
	majorVersion: number;
	apiVersion: string;
}

export class RadarrClient extends BaseArrClient {
	async detectApiVersion(): Promise<ApiVersionInfo> {
		const status = await this.getSystemStatus();

		// Parse major version from app version (e.g., "5.2.0.8171" -> 5)
		const versionParts = status.version.split('.');
		const majorVersion = parseInt(versionParts[0] ?? '3', 10);

		// Radarr v3, v4, and v5 all currently use API v3
		// This provides forward compatibility for detecting version-specific behavior
		const apiVersion = 'v3';

		return {
			appVersion: status.version,
			majorVersion: Number.isNaN(majorVersion) ? 3 : majorVersion,
			apiVersion
		};
	}

	async getMovies(): Promise<RadarrMovie[]> {
		const response = await this.requestWithRetry<unknown[]>('movie');

		logger.debug('API response received', {
			responseLength: Array.isArray(response) ? response.length : 'not an array',
			responseType: typeof response
		});

		// Guard against non-array responses (e.g., error objects)
		if (!Array.isArray(response)) {
			throw new Error(`Expected array response from /movie endpoint, got ${typeof response}`);
		}

		const movies: RadarrMovie[] = [];
		let skipped = 0;
		for (const item of response) {
			const result = parseRadarrMovie(item);
			if (result.success) {
				movies.push(result.data);
			} else {
				skipped++;
				// Log first few parsing failures for debugging
				// Only log non-sensitive fields to avoid leaking filesystem paths
				if (skipped <= 3) {
					const safeItem =
						item && typeof item === 'object'
							? {
									id: (item as Record<string, unknown>).id,
									title: (item as Record<string, unknown>).title,
									tmdbId: (item as Record<string, unknown>).tmdbId,
									year: (item as Record<string, unknown>).year
								}
							: { type: typeof item };
					logger.warn('Failed to parse movie record', {
						error: result.error,
						sample: safeItem
					});
				}
			}
		}

		if (skipped > 0) {
			logger.warn('Skipped malformed movie records', {
				skipped,
				total: response.length,
				parsed: movies.length
			});
		}

		// If ALL records failed, throw an error to surface schema mismatch
		if (movies.length === 0 && response.length > 0) {
			throw new Error(
				`All ${response.length} movies failed parsing - possible API schema mismatch`
			);
		}

		logger.info('Movies fetched successfully', {
			total: movies.length
		});

		return movies;
	}

	private async fetchAllWantedMovies(
		endpoint: string,
		options?: WantedOptions
	): Promise<RadarrMovie[]> {
		const pageSize = options?.pageSize ?? 1000;
		const monitored = options?.monitored ?? true;
		const sortKey = options?.sortKey ?? 'title';
		const sortDirection = options?.sortDirection ?? 'descending';

		let page = options?.page ?? 1;
		const allMovies: RadarrMovie[] = [];

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

			const result = parsePaginatedMoviesLenient(response);
			if (!result.success) {
				throw new Error(result.error);
			}

			allMovies.push(...result.data.records);

			// Continue until we've fetched all records
			if (page * pageSize >= result.data.totalRecords) {
				break;
			}

			page++;
		}

		return allMovies;
	}

	async getWantedMissing(options?: WantedOptions): Promise<RadarrMovie[]> {
		return this.fetchAllWantedMovies('wanted/missing', options);
	}

	async getWantedCutoff(options?: WantedOptions): Promise<RadarrMovie[]> {
		return this.fetchAllWantedMovies('wanted/cutoff', options);
	}

	async sendMoviesSearch(movieIds: number[]): Promise<CommandResponse> {
		const response = await this.requestWithRetry<unknown>('command', {
			method: 'POST',
			body: {
				name: 'MoviesSearch',
				movieIds
			}
		});

		const result = parseCommandResponse(response);
		if (!result.success) {
			throw new Error(result.error);
		}
		return result.data;
	}

	async getCommandStatus(commandId: number): Promise<CommandResponse> {
		const response = await this.requestWithRetry<unknown>(`command/${commandId}`);

		const result = parseCommandResponse(response);
		if (!result.success) {
			throw new Error(result.error);
		}
		return result.data;
	}
}
