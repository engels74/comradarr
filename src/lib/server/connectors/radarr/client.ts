import { createLogger } from '$lib/server/logger';
import { BaseArrClient } from '../common/base-client.js';
import { parseCommandResponse } from '../common/parsers.js';
import type { CommandResponse } from '../common/types.js';
import { parseRadarrMovie } from './parsers.js';
import type { RadarrMovie } from './types.js';

const logger = createLogger('radarr-client');

export class RadarrClient extends BaseArrClient {
	async getMovies(): Promise<RadarrMovie[]> {
		const response = await this.requestWithRetry<unknown[]>('movie');

		const movies = this.parseArrayLenient(response, parseRadarrMovie, {
			resourceType: 'movie',
			safeFields: ['id', 'title', 'tmdbId', 'year']
		});

		logger.info('Movies fetched successfully', { total: movies.length });
		return movies;
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
