import { createLogger } from '$lib/server/logger';
import { BaseArrClient } from '../common/base-client.js';
import { parseCommandResponse } from '../common/parsers.js';
import type { CommandResponse, PaginationOptions } from '../common/types.js';
import {
	parsePaginatedWhisparrEpisodesLenient,
	parseWhisparrEpisode,
	parseWhisparrSeries
} from './parsers.js';
import type { WhisparrEpisode, WhisparrSeries } from './types.js';

const logger = createLogger('whisparr-client');

export interface WantedOptions extends PaginationOptions {
	monitored?: boolean;
}

export class WhisparrClient extends BaseArrClient {
	async getSeries(): Promise<WhisparrSeries[]> {
		const response = await this.requestWithRetry<unknown[]>('series');

		if (!Array.isArray(response)) {
			throw new Error(`Expected array response from /series endpoint, got ${typeof response}`);
		}

		const series: WhisparrSeries[] = [];
		let skipped = 0;
		for (const item of response) {
			const result = parseWhisparrSeries(item);
			if (result.success) {
				series.push(result.data);
			} else {
				skipped++;
				if (skipped <= 3) {
					const safeItem =
						item && typeof item === 'object'
							? {
									id: (item as Record<string, unknown>).id,
									title: (item as Record<string, unknown>).title,
									foreignId: (item as Record<string, unknown>).foreignId
								}
							: { type: typeof item };
					logger.warn('Failed to parse series record', { error: result.error, sample: safeItem });
				}
			}
		}

		if (skipped > 0) {
			logger.warn('Skipped malformed series records', {
				skipped,
				total: response.length,
				parsed: series.length
			});
		}

		if (series.length === 0 && response.length > 0) {
			throw new Error(
				`All ${response.length} series failed parsing - possible API schema mismatch`
			);
		}

		logger.info('Series fetched successfully', { total: series.length });
		return series;
	}

	async getEpisodes(seriesId: number): Promise<WhisparrEpisode[]> {
		const response = await this.requestWithRetry<unknown[]>(`episode?seriesId=${seriesId}`);

		if (!Array.isArray(response)) {
			throw new Error(`Expected array response from /episode endpoint, got ${typeof response}`);
		}

		const episodes: WhisparrEpisode[] = [];
		let skipped = 0;
		for (const item of response) {
			const result = parseWhisparrEpisode(item);
			if (result.success) {
				episodes.push(result.data);
			} else {
				skipped++;
				if (skipped <= 3) {
					const safeItem =
						item && typeof item === 'object'
							? {
									id: (item as Record<string, unknown>).id,
									episodeNumber: (item as Record<string, unknown>).episodeNumber,
									seasonNumber: (item as Record<string, unknown>).seasonNumber
								}
							: { type: typeof item };
					logger.warn('Failed to parse episode record', { error: result.error, sample: safeItem });
				}
			}
		}

		if (skipped > 0) {
			logger.warn('Skipped malformed episode records', {
				seriesId,
				skipped,
				total: response.length,
				parsed: episodes.length
			});
		}

		logger.debug('Episodes fetched', { seriesId, total: episodes.length });
		return episodes;
	}

	private async fetchAllWantedEpisodes(
		endpoint: string,
		options?: WantedOptions
	): Promise<WhisparrEpisode[]> {
		const pageSize = options?.pageSize ?? 1000;
		const monitored = options?.monitored ?? true;
		const sortKey = options?.sortKey ?? 'airDateUtc';
		const sortDirection = options?.sortDirection ?? 'descending';

		let page = options?.page ?? 1;
		const allEpisodes: WhisparrEpisode[] = [];

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

			const result = parsePaginatedWhisparrEpisodesLenient(response);
			if (!result.success) {
				throw new Error(result.error);
			}

			allEpisodes.push(...result.data.records);

			// Continue until we've fetched all records
			if (page * pageSize >= result.data.totalRecords) {
				break;
			}

			page++;
		}

		return allEpisodes;
	}

	async getWantedMissing(options?: WantedOptions): Promise<WhisparrEpisode[]> {
		return this.fetchAllWantedEpisodes('wanted/missing', options);
	}

	async getWantedCutoff(options?: WantedOptions): Promise<WhisparrEpisode[]> {
		return this.fetchAllWantedEpisodes('wanted/cutoff', options);
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

	async getCommandStatus(commandId: number): Promise<CommandResponse> {
		const response = await this.requestWithRetry<unknown>(`command/${commandId}`);

		const result = parseCommandResponse(response);
		if (!result.success) {
			throw new Error(result.error);
		}
		return result.data;
	}
}
