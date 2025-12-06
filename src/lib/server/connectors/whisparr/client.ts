/**
 * Whisparr API client
 *
 * Extends BaseArrClient with Whisparr-specific functionality.
 * Inherits ping(), getSystemStatus(), and getHealth() from base class.
 *
 * Whisparr uses the same API structure as Sonarr (series, episodes, seasons)
 * since it's a fork of Sonarr for adult content management.
 *
 * @module connectors/whisparr/client

 */

import { BaseArrClient } from '../common/base-client.js';
import type { BaseClientConfig, PaginationOptions, CommandResponse } from '../common/types.js';
import { parseCommandResponse } from '../common/parsers.js';
import {
	parseWhisparrSeries,
	parseWhisparrEpisode,
	parsePaginatedWhisparrEpisodesLenient
} from './parsers.js';
import type { WhisparrSeries, WhisparrEpisode } from './types.js';

/**
 * Options for fetching wanted episodes (missing or cutoff unmet)
 */
export interface WantedOptions extends PaginationOptions {
	/**
	 * Filter by monitored status (default: true)
	 * When true, only returns episodes from monitored series
	 */
	monitored?: boolean;
}

/**
 * Whisparr API client for adult content library management
 *
 * Provides methods for communicating with Whisparr's API v3:
 * - Connection testing via ping()
 * - System status retrieval via getSystemStatus()
 * - Health check via getHealth()
 *
 * @example
 * ```typescript
 * const client = new WhisparrClient({
 *   baseUrl: 'http://localhost:6969',
 *   apiKey: 'your-api-key'
 * });
 *
 * const isReachable = await client.ping();
 * const status = await client.getSystemStatus();
 * const health = await client.getHealth();
 * ```
 */
export class WhisparrClient extends BaseArrClient {
	/**
	 * Create a new WhisparrClient instance
	 *
	 * @param config - Client configuration including baseUrl and apiKey
	 */
	constructor(config: BaseClientConfig) {
		super(config);
	}

	// Inherited from BaseArrClient:
	// - ping(): Promise<boolean>
	// - getSystemStatus(): Promise<SystemStatus>
	// - getHealth(): Promise<HealthCheck[]>

	/**
	 * Get all series from Whisparr
	 *
	 * Fetches the complete library of series from Whisparr.
	 * Each series is validated and malformed records are skipped.
	 *
	 * @returns Array of all series in the library
	 * @throws {ArrClientError} On API error (network, auth, rate limit, etc.)

	 *
	 * @example
	 * ```typescript
	 * const client = new WhisparrClient({ baseUrl, apiKey });
	 * const series = await client.getSeries();
	 * console.log(`Found ${series.length} series`);
	 * ```
	 */
	async getSeries(): Promise<WhisparrSeries[]> {
		const response = await this.requestWithRetry<unknown[]>('series');

		const series: WhisparrSeries[] = [];
		for (const item of response) {
			const result = parseWhisparrSeries(item);
			if (result.success) {
				series.push(result.data);
			}
			// Malformed records are skipped per Requirement 27.8
		}

		return series;
	}

	/**
	 * Get all episodes for a specific series
	 *
	 * Fetches all episodes belonging to a series, including specials (season 0).
	 * Each episode is validated and malformed records are skipped.
	 *
	 * @param seriesId - The Whisparr internal series ID
	 * @returns Array of episodes for the series
	 * @throws {ArrClientError} On API error (network, auth, rate limit, etc.)

	 *
	 * @example
	 * ```typescript
	 * const client = new WhisparrClient({ baseUrl, apiKey });
	 * const episodes = await client.getEpisodes(123);
	 * console.log(`Series has ${episodes.length} episodes`);
	 * ```
	 */
	async getEpisodes(seriesId: number): Promise<WhisparrEpisode[]> {
		const response = await this.requestWithRetry<unknown[]>(`episode?seriesId=${seriesId}`);

		const episodes: WhisparrEpisode[] = [];
		for (const item of response) {
			const result = parseWhisparrEpisode(item);
			if (result.success) {
				episodes.push(result.data);
			}
			// Malformed records are skipped per Requirement 27.8
		}

		return episodes;
	}

	/**
	 * Fetch all paginated episodes from a wanted endpoint
	 *
	 * Handles pagination automatically, fetching all pages until complete.
	 * Uses pageSize of 1000 per Requirement 2.5 (pagination batches).
	 *
	 * @param endpoint - The wanted endpoint ('wanted/missing' or 'wanted/cutoff')
	 * @param options - Pagination and filter options
	 * @returns Array of all wanted episodes across all pages
	 * @throws {ArrClientError} On API error
	 * @throws {Error} If response parsing fails
	 */
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

			// Check if we've fetched all records (Requirement 29.2)
			// Continue until page * pageSize >= totalRecords
			if (page * pageSize >= result.data.totalRecords) {
				break;
			}

			page++;
		}

		return allEpisodes;
	}

	/**
	 * Get all missing episodes from Whisparr
	 *
	 * Fetches episodes where monitored=true AND hasFile=false.
	 * Automatically paginates to retrieve all results.
	 *
	 * @param options - Pagination and filter options
	 * @returns Array of all missing episodes
	 * @throws {ArrClientError} On API error (network, auth, rate limit, etc.)

	 *
	 * @example
	 * ```typescript
	 * const client = new WhisparrClient({ baseUrl, apiKey });
	 * const missing = await client.getWantedMissing();
	 * console.log(`Found ${missing.length} missing episodes`);
	 *
	 * // With custom options
	 * const recentMissing = await client.getWantedMissing({
	 *   pageSize: 50,
	 *   monitored: true
	 * });
	 * ```
	 */
	async getWantedMissing(options?: WantedOptions): Promise<WhisparrEpisode[]> {
		return this.fetchAllWantedEpisodes('wanted/missing', options);
	}

	/**
	 * Get all upgrade candidates from Whisparr
	 *
	 * Fetches episodes where monitored=true AND qualityCutoffNotMet=true.
	 * These are episodes that exist but could be upgraded to better quality.
	 * Automatically paginates to retrieve all results.
	 *
	 * @param options - Pagination and filter options
	 * @returns Array of all upgrade candidate episodes
	 * @throws {ArrClientError} On API error (network, auth, rate limit, etc.)

	 *
	 * @example
	 * ```typescript
	 * const client = new WhisparrClient({ baseUrl, apiKey });
	 * const upgrades = await client.getWantedCutoff();
	 * console.log(`Found ${upgrades.length} upgrade candidates`);
	 *
	 * // With custom options
	 * const upgradesByDate = await client.getWantedCutoff({
	 *   sortKey: 'airDateUtc',
	 *   sortDirection: 'ascending'
	 * });
	 * ```
	 */
	async getWantedCutoff(options?: WantedOptions): Promise<WhisparrEpisode[]> {
		return this.fetchAllWantedEpisodes('wanted/cutoff', options);
	}

	/**
	 * Trigger a search for specific episodes
	 *
	 * Sends an EpisodeSearch command to Whisparr to search for the specified episodes.
	 * The command is executed asynchronously - use getCommandStatus() to poll for completion.
	 *
	 * @param episodeIds - Array of episode IDs to search for (max 10 per batch per Req 29.4)
	 * @returns Command response with initial execution status
	 * @throws {ArrClientError} On API error (network, auth, rate limit, etc.)
	 * @throws {Error} If response parsing fails

	 *
	 * @example
	 * ```typescript
	 * const client = new WhisparrClient({ baseUrl, apiKey });
	 * const command = await client.sendEpisodeSearch([101, 102, 103]);
	 * console.log(`Command ${command.id} status: ${command.status}`);
	 *
	 * // Poll for completion
	 * const result = await client.getCommandStatus(command.id);
	 * if (result.status === 'completed') {
	 *   console.log('Search completed');
	 * }
	 * ```
	 */
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

	/**
	 * Trigger a search for an entire season
	 *
	 * Sends a SeasonSearch command to Whisparr to search for all episodes in a season.
	 * Use this for season pack searches when multiple episodes are missing.
	 * The command is executed asynchronously - use getCommandStatus() to poll for completion.
	 *
	 * @param seriesId - The Whisparr internal series ID
	 * @param seasonNumber - The season number to search (0 for specials)
	 * @returns Command response with initial execution status
	 * @throws {ArrClientError} On API error (network, auth, rate limit, etc.)
	 * @throws {Error} If response parsing fails

	 *
	 * @example
	 * ```typescript
	 * const client = new WhisparrClient({ baseUrl, apiKey });
	 * const command = await client.sendSeasonSearch(123, 1);
	 * console.log(`Command ${command.id} status: ${command.status}`);
	 *
	 * // Poll for completion
	 * const result = await client.getCommandStatus(command.id);
	 * if (result.status === 'completed') {
	 *   console.log('Season search completed');
	 * }
	 * ```
	 */
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

	/**
	 * Get the current status of a command
	 *
	 * Polls Whisparr for the current execution status of a previously submitted command.
	 * Use this to track command progress and determine when a search completes.
	 *
	 * @param commandId - The command ID returned from sendEpisodeSearch or sendSeasonSearch
	 * @returns Command response with current status (queued, started, completed, failed)
	 * @throws {ArrClientError} On API error (network, auth, rate limit, etc.)
	 * @throws {NotFoundError} If command ID does not exist
	 * @throws {Error} If response parsing fails

	 *
	 * @example
	 * ```typescript
	 * const client = new WhisparrClient({ baseUrl, apiKey });
	 *
	 * // Start a search
	 * const command = await client.sendEpisodeSearch([101]);
	 *
	 * // Poll until complete
	 * let status = await client.getCommandStatus(command.id);
	 * while (status.status === 'queued' || status.status === 'started') {
	 *   await new Promise(resolve => setTimeout(resolve, 1000));
	 *   status = await client.getCommandStatus(command.id);
	 * }
	 *
	 * if (status.status === 'completed') {
	 *   console.log('Search completed successfully');
	 * } else {
	 *   console.log('Search failed:', status.message);
	 * }
	 * ```
	 */
	async getCommandStatus(commandId: number): Promise<CommandResponse> {
		const response = await this.requestWithRetry<unknown>(`command/${commandId}`);

		const result = parseCommandResponse(response);
		if (!result.success) {
			throw new Error(result.error);
		}
		return result.data;
	}
}
