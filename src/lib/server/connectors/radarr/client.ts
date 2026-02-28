import { createLogger } from '$lib/server/logger';
import { BaseArrClient } from '../common/base-client.js';
import { parseCommandResponse } from '../common/parsers.js';
import type { CommandResponse, WantedOptions } from '../common/types.js';
import { parsePaginatedMoviesLenient, parseRadarrMovie } from './parsers.js';
import type { RadarrMovie } from './types.js';

const logger = createLogger('radarr-client');

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

		const movies = this.parseArrayLenient(response, parseRadarrMovie, {
			resourceType: 'movie',
			safeFields: ['id', 'title', 'tmdbId', 'year']
		});

		logger.info('Movies fetched successfully', { total: movies.length });
		return movies;
	}

	async getWantedMissing(options?: WantedOptions): Promise<RadarrMovie[]> {
		return this.fetchAllPaginated('wanted/missing', parsePaginatedMoviesLenient, {
			sortKey: 'title',
			...options
		});
	}

	async getWantedCutoff(options?: WantedOptions): Promise<RadarrMovie[]> {
		return this.fetchAllPaginated('wanted/cutoff', parsePaginatedMoviesLenient, {
			sortKey: 'title',
			...options
		});
	}

	async sendMoviesSearch(movieIds: number[]): Promise<CommandResponse> {
		logger.info('Sending movies search command', { movieIds, count: movieIds.length });

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

		logger.info('Movies search command accepted', { commandId: result.data.id });
		return result.data;
	}
}
