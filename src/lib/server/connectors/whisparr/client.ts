import { BaseArrClient } from '../common/base-client.js';
import { parseCommandResponse } from '../common/parsers.js';
import type { CommandResponse, PaginationOptions } from '../common/types.js';
import {
	parsePaginatedWhisparrEpisodesLenient,
	parseWhisparrEpisode,
	parseWhisparrSeries
} from './parsers.js';
import type { WhisparrEpisode, WhisparrSeries } from './types.js';

export interface WantedOptions extends PaginationOptions {
	monitored?: boolean;
}

export class WhisparrClient extends BaseArrClient {
	async getSeries(): Promise<WhisparrSeries[]> {
		const response = await this.requestWithRetry<unknown[]>('series');

		const series: WhisparrSeries[] = [];
		for (const item of response) {
			const result = parseWhisparrSeries(item);
			if (result.success) {
				series.push(result.data);
			}
			// Malformed records are skipped silently
		}

		return series;
	}

	async getEpisodes(seriesId: number): Promise<WhisparrEpisode[]> {
		const response = await this.requestWithRetry<unknown[]>(`episode?seriesId=${seriesId}`);

		const episodes: WhisparrEpisode[] = [];
		for (const item of response) {
			const result = parseWhisparrEpisode(item);
			if (result.success) {
				episodes.push(result.data);
			}
			// Malformed records are skipped silently
		}

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
		return result.data;
	}

	async sendSeasonSearch(seriesId: number, seasonNumber: number): Promise<CommandResponse> {
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
