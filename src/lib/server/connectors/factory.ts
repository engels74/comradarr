import type { Connector } from '$lib/server/db/schema';
import type { BaseArrClient } from './common/base-client.js';
import type { BaseClientConfig } from './common/types.js';
import { RadarrClient } from './radarr/client.js';
import { SonarrClient } from './sonarr/client.js';
import { WhisparrClient } from './whisparr/client.js';

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
