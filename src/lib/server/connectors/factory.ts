import type { Connector } from '$lib/server/db/schema';
import { createLogger, sanitizeUrl } from '$lib/server/logger';
import type { BaseArrClient } from './common/base-client.js';
import type { BaseClientConfig } from './common/types.js';
import { RadarrClient } from './radarr/client.js';
import { SonarrClient } from './sonarr/client.js';
import { WhisparrClient } from './whisparr/client.js';

const logger = createLogger('connector-factory');

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

	logger.debug('Creating connector client', {
		connectorId: connector.id,
		type: connector.type,
		url: sanitizeUrl(connector.url)
	});

	switch (connector.type) {
		case 'sonarr':
			return new SonarrClient(config);
		case 'radarr':
			return new RadarrClient(config);
		case 'whisparr':
			return new WhisparrClient(config);
		default:
			logger.error('Unknown connector type', { type: connector.type });
			throw new Error(`Unknown connector type: ${connector.type}`);
	}
}
