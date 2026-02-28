import { createLogger } from '$lib/server/logger';
import { BaseArrClient } from '../common/base-client.js';
import { parseCommandResponse } from '../common/parsers.js';
import type { CommandResponse, WantedOptions } from '../common/types.js';
import {
	parsePaginatedWhisparrEpisodesLenient,
	parseWhisparrEpisode,
	parseWhisparrSeries
} from './parsers.js';
import type { WhisparrEpisode, WhisparrSeries } from './types.js';

const logger = createLogger('whisparr-client');

export class WhisparrClient extends BaseArrClient {
	async getSeries(): Promise<WhisparrSeries[]> {
		const response = await this.requestWithRetry<unknown[]>('series');

		const series = this.parseArrayLenient(response, parseWhisparrSeries, {
			resourceType: 'series',
			safeFields: ['id', 'title', 'foreignId']
		});

		logger.info('Series fetched successfully', { total: series.length });
		return series;
	}

	async getEpisodes(seriesId: number): Promise<WhisparrEpisode[]> {
		const response = await this.requestWithRetry<unknown[]>(`episode?seriesId=${seriesId}`);

		const episodes = this.parseArrayLenient(response, parseWhisparrEpisode, {
			resourceType: 'episode',
			safeFields: ['id', 'episodeNumber', 'seasonNumber'],
			context: { seriesId }
		});

		logger.debug('Episodes fetched', { seriesId, total: episodes.length });
		return episodes;
	}

	async getWantedMissing(options?: WantedOptions): Promise<WhisparrEpisode[]> {
		return this.fetchAllPaginated('wanted/missing', parsePaginatedWhisparrEpisodesLenient, options);
	}

	async getWantedCutoff(options?: WantedOptions): Promise<WhisparrEpisode[]> {
		return this.fetchAllPaginated('wanted/cutoff', parsePaginatedWhisparrEpisodesLenient, options);
	}

	async sendEpisodeSearch(episodeIds: number[]): Promise<CommandResponse> {
		logger.info('Sending episode search command', { episodeIds, count: episodeIds.length });

		const response = await this.requestWithRetry<unknown>('command', {
			method: 'POST',
			body: {
				name: 'EpisodeSearch',
				episodeIds
			}
		});

		const result = parseCommandResponse(response);
		if (!result.success) {
			throw new Error(result.error);
		}

		logger.info('Episode search command accepted', { commandId: result.data.id });
		return result.data;
	}

	async sendSeasonSearch(seriesId: number, seasonNumber: number): Promise<CommandResponse> {
		logger.info('Sending season search command', { seriesId, seasonNumber });

		const response = await this.requestWithRetry<unknown>('command', {
			method: 'POST',
			body: {
				name: 'SeasonSearch',
				seriesId,
				seasonNumber
			}
		});

		const result = parseCommandResponse(response);
		if (!result.success) {
			throw new Error(result.error);
		}

		logger.info('Season search command accepted', { commandId: result.data.id });
		return result.data;
	}
}
