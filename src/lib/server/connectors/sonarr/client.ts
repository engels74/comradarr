/**
 * Sonarr API client
 *
 * Extends BaseArrClient with Sonarr-specific functionality.
 * Inherits ping(), getSystemStatus(), and getHealth() from base class.
 *
 * @module connectors/sonarr/client
 * @requirements 1.2, 1.3, 1.4, 24.1, 24.2
 */

import { BaseArrClient } from '../common/base-client.js';
import type { BaseClientConfig } from '../common/types.js';
import { parseSonarrSeries, parseSonarrEpisode } from './parsers.js';
import type { SonarrSeries, SonarrEpisode } from './types.js';

/**
 * Sonarr API client for TV series management
 *
 * Provides methods for communicating with Sonarr's API v3:
 * - Connection testing via ping()
 * - System status retrieval via getSystemStatus()
 * - Health check via getHealth()
 *
 * @example
 * ```typescript
 * const client = new SonarrClient({
 *   baseUrl: 'http://localhost:8989',
 *   apiKey: 'your-api-key'
 * });
 *
 * const isReachable = await client.ping();
 * const status = await client.getSystemStatus();
 * const health = await client.getHealth();
 * ```
 */
export class SonarrClient extends BaseArrClient {
	/**
	 * Create a new SonarrClient instance
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
	 * Get all series from Sonarr
	 *
	 * Fetches the complete library of TV series from Sonarr.
	 * Each series is validated and malformed records are skipped.
	 *
	 * @returns Array of all series in the library
	 * @throws {ArrClientError} On API error (network, auth, rate limit, etc.)
	 * @requirements 24.1
	 *
	 * @example
	 * ```typescript
	 * const client = new SonarrClient({ baseUrl, apiKey });
	 * const series = await client.getSeries();
	 * console.log(`Found ${series.length} series`);
	 * ```
	 */
	async getSeries(): Promise<SonarrSeries[]> {
		const response = await this.requestWithRetry<unknown[]>('series');

		const series: SonarrSeries[] = [];
		for (const item of response) {
			const result = parseSonarrSeries(item);
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
	 * @param seriesId - The Sonarr internal series ID
	 * @returns Array of episodes for the series
	 * @throws {ArrClientError} On API error (network, auth, rate limit, etc.)
	 * @requirements 24.2
	 *
	 * @example
	 * ```typescript
	 * const client = new SonarrClient({ baseUrl, apiKey });
	 * const episodes = await client.getEpisodes(123);
	 * console.log(`Series has ${episodes.length} episodes`);
	 * ```
	 */
	async getEpisodes(seriesId: number): Promise<SonarrEpisode[]> {
		const response = await this.requestWithRetry<unknown[]>(`episode?seriesId=${seriesId}`);

		const episodes: SonarrEpisode[] = [];
		for (const item of response) {
			const result = parseSonarrEpisode(item);
			if (result.success) {
				episodes.push(result.data);
			}
			// Malformed records are skipped per Requirement 27.8
		}

		return episodes;
	}

	// Future Sonarr-specific methods (tasks 8.3-8.4):
	// - getWantedMissing()
	// - getWantedCutoff()
	// - sendEpisodeSearch()
	// - sendSeasonSearch()
	// - getCommandStatus()
}
