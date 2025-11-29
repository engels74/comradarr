/**
 * Sonarr API client
 *
 * Extends BaseArrClient with Sonarr-specific functionality.
 * Inherits ping(), getSystemStatus(), and getHealth() from base class.
 *
 * @module connectors/sonarr/client
 * @requirements 1.2, 1.3, 1.4, 24.1
 */

import { BaseArrClient } from '../common/base-client.js';
import type { BaseClientConfig } from '../common/types.js';

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

	// Future Sonarr-specific methods will be added here (tasks 8.2-8.4):
	// - getSeries()
	// - getEpisodes()
	// - getWantedMissing()
	// - getWantedCutoff()
	// - sendEpisodeSearch()
	// - sendSeasonSearch()
	// - getCommandStatus()
}
