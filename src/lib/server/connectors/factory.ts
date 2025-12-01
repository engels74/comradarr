/**
 * Connector client factory for instantiating the correct client type.
 *
 * @module connectors/factory
 */

import type { Connector } from '$lib/server/db/schema';
import type { BaseClientConfig } from './common/types.js';
import { BaseArrClient } from './common/base-client.js';
import { SonarrClient } from './sonarr/client.js';
import { RadarrClient } from './radarr/client.js';
import { WhisparrClient } from './whisparr/client.js';

/**
 * Creates a connector client instance based on the connector type.
 *
 * @param connector - The connector database record
 * @param apiKey - The decrypted API key
 * @param timeout - Optional timeout override (default: 15000ms for health checks)
 * @returns The appropriate client instance (SonarrClient, RadarrClient, or WhisparrClient)
 * @throws Error if the connector type is unknown
 */
export function createConnectorClient(
	connector: Connector,
	apiKey: string,
	timeout: number = 15000
): BaseArrClient {
	const config: BaseClientConfig = {
		baseUrl: connector.url,
		apiKey,
		timeout
	};

	switch (connector.type) {
		case 'sonarr':
			return new SonarrClient(config);
		case 'radarr':
			return new RadarrClient(config);
		case 'whisparr':
			return new WhisparrClient(config);
		default:
			throw new Error(`Unknown connector type: ${connector.type}`);
	}
}
