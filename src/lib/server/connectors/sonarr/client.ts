import { createLogger } from '$lib/server/logger';
import { BaseArrClient } from '../common/base-client.js';
import { parseCommandResponse } from '../common/parsers.js';
import type { CommandResponse, WantedOptions } from '../common/types.js';
import { parsePaginatedEpisodesLenient, parseSonarrEpisode, parseSonarrSeries } from './parsers.js';
import type { SonarrEpisode, SonarrSeries } from './types.js';

const logger = createLogger('sonarr-client');

export class SonarrClient extends BaseArrClient {
	async getSeries(): Promise<SonarrSeries[]> {
		const response = await this.requestWithRetry<unknown[]>('series');

		const series = this.parseArrayLenient(response, parseSonarrSeries, {
			resourceType: 'series',
			safeFields: ['id', 'title', 'tvdbId']
		});

		logger.info('Series fetched successfully', { total: series.length });
		return series;
	}

	async getEpisodes(seriesId: number): Promise<SonarrEpisode[]> {
		const response = await this.requestWithRetry<unknown[]>(`episode?seriesId=${seriesId}`);

		const episodes = this.parseArrayLenient(response, parseSonarrEpisode, {
			resourceType: 'episode',
			safeFields: ['id', 'episodeNumber', 'seasonNumber'],
			context: { seriesId }
		});

		logger.debug('Episodes fetched', { seriesId, total: episodes.length });
		return episodes;
	}

	async getWantedMissing(options?: WantedOptions): Promise<SonarrEpisode[]> {
		return this.fetchAllPaginated('wanted/missing', parsePaginatedEpisodesLenient, options);
	}

	async getWantedCutoff(options?: WantedOptions): Promise<SonarrEpisode[]> {
		return this.fetchAllPaginated('wanted/cutoff', parsePaginatedEpisodesLenient, options);
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
