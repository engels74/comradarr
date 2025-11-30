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
 * @requirements 26.1
 */

import { BaseArrClient } from '../common/base-client.js';
import type { BaseClientConfig } from '../common/types.js';

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

	// Additional Whisparr-specific methods will be added in task 10.2:
	// - getSeries(): Promise<WhisparrSeries[]>
	// - getEpisodes(seriesId: number): Promise<WhisparrEpisode[]>
	// - getWantedMissing(options?: WantedOptions): Promise<WhisparrEpisode[]>
	// - getWantedCutoff(options?: WantedOptions): Promise<WhisparrEpisode[]>
	// - sendEpisodeSearch(episodeIds: number[]): Promise<CommandResponse>
	// - sendSeasonSearch(seriesId: number, seasonNumber: number): Promise<CommandResponse>
	// - getCommandStatus(commandId: number): Promise<CommandResponse>
}
