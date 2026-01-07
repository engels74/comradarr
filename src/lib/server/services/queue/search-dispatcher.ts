import {
	type CommandResponse,
	isArrClientError,
	RadarrClient,
	RateLimitError,
	SonarrClient,
	WhisparrClient
} from '$lib/server/connectors';
import { getConnector, getDecryptedApiKey } from '$lib/server/db/queries/connectors';
import { createLogger } from '$lib/server/logger';
import { prowlarrHealthMonitor } from '$lib/server/services/prowlarr';
import { throttleEnforcer } from '$lib/server/services/throttle';
import type { ContentType, SearchType } from './types';

const logger = createLogger('dispatcher');

export interface DispatchOptions {
	episodeIds?: number[];
	seriesId?: number;
	seasonNumber?: number;
	movieIds?: number[];
}

export interface DispatchResult {
	success: boolean;
	searchRegistryId: number;
	connectorId: number;
	commandId?: number;
	error?: string;
	rateLimited?: boolean;
	connectorPaused?: boolean;
}

export type DispatchFailureReason =
	| 'throttled'
	| 'rate_limited'
	| 'connector_not_found'
	| 'api_error'
	| 'invalid_options';

async function createConnectorClient(
	connectorId: number
): Promise<{ client: SonarrClient | RadarrClient | WhisparrClient; type: string } | null> {
	const connector = await getConnector(connectorId);
	if (!connector) {
		return null;
	}

	const apiKey = await getDecryptedApiKey(connector);
	const config = { baseUrl: connector.url, apiKey };

	switch (connector.type) {
		case 'sonarr':
			return { client: new SonarrClient(config), type: 'sonarr' };
		case 'radarr':
			return { client: new RadarrClient(config), type: 'radarr' };
		case 'whisparr':
			return { client: new WhisparrClient(config), type: 'whisparr' };
		default:
			return null;
	}
}

async function executeSearchCommand(
	client: SonarrClient | RadarrClient | WhisparrClient,
	connectorType: string,
	options: DispatchOptions
): Promise<CommandResponse> {
	// Radarr - movie search
	if (connectorType === 'radarr') {
		if (!options.movieIds || options.movieIds.length === 0) {
			throw new Error('movieIds required for Radarr search');
		}
		return (client as RadarrClient).sendMoviesSearch(options.movieIds);
	}

	// Sonarr/Whisparr - episode or season search
	const sonarrClient = client as SonarrClient | WhisparrClient;

	// Season search
	if (options.seriesId !== undefined && options.seasonNumber !== undefined) {
		return sonarrClient.sendSeasonSearch(options.seriesId, options.seasonNumber);
	}

	// Episode search
	if (options.episodeIds && options.episodeIds.length > 0) {
		return sonarrClient.sendEpisodeSearch(options.episodeIds);
	}

	throw new Error('Invalid search options: provide episodeIds, movieIds, or seriesId+seasonNumber');
}

// Informational only - does NOT block dispatch; uses cached data
async function checkProwlarrHealth(): Promise<void> {
	try {
		const cachedHealth = await prowlarrHealthMonitor.getAllCachedHealth();

		if (cachedHealth.length === 0) {
			// No Prowlarr instances configured, skip check
			return;
		}

		const rateLimitedIndexers = cachedHealth.filter((h) => h.isRateLimited);
		const staleData = cachedHealth.some((h) => h.isStale);

		if (rateLimitedIndexers.length > 0) {
			logger.warn('Prowlarr health warning', {
				rateLimitedIndexers: rateLimitedIndexers.length,
				totalIndexers: cachedHealth.length,
				indexerNames: rateLimitedIndexers.map((h) => h.name),
				dataStale: staleData
			});
		}
	} catch (error) {
		// Continue normal operation if Prowlarr unreachable
		// Log error but do not throw - this check is purely informational
		logger.warn('Prowlarr health check failed (continuing dispatch)', {
			error: error instanceof Error ? error.message : 'Unknown error'
		});
	}
}

// On HTTP 429: pauses connector via ThrottleEnforcer.handleRateLimitResponse()
export async function dispatchSearch(
	connectorId: number,
	searchRegistryId: number,
	_contentType: ContentType,
	_searchType: SearchType,
	options: DispatchOptions
): Promise<DispatchResult> {
	// 1. Check if dispatch is allowed by throttle enforcer
	const throttleResult = await throttleEnforcer.canDispatch(connectorId);
	if (!throttleResult.allowed) {
		return {
			success: false,
			searchRegistryId,
			connectorId,
			error: `Throttled: ${throttleResult.reason}`,
			rateLimited: throttleResult.reason === 'rate_limit'
		};
	}

	// 1.5. Optional Prowlarr health check (informational only, does NOT block dispatch)
	await checkProwlarrHealth();

	// 2. Create connector client
	const connectorResult = await createConnectorClient(connectorId);
	if (!connectorResult) {
		return {
			success: false,
			searchRegistryId,
			connectorId,
			error: 'Connector not found or unsupported type'
		};
	}

	const { client, type: connectorType } = connectorResult;

	try {
		// 3. Execute search command
		const commandResponse = await executeSearchCommand(client, connectorType, options);

		// 4. Record successful request for rate limiting
		await throttleEnforcer.recordRequest(connectorId);

		return {
			success: true,
			searchRegistryId,
			connectorId,
			commandId: commandResponse.id
		};
	} catch (error) {
		// HTTP 429: pause connector, respects Retry-After or uses profile's rateLimitPauseSeconds
		if (error instanceof RateLimitError) {
			await throttleEnforcer.handleRateLimitResponse(connectorId, error.retryAfter);

			return {
				success: false,
				searchRegistryId,
				connectorId,
				error: 'Rate limited by *arr API',
				rateLimited: true,
				connectorPaused: true
			};
		}

		// Handle other API errors
		if (isArrClientError(error)) {
			return {
				success: false,
				searchRegistryId,
				connectorId,
				error: `API error: ${error.message} (${error.category})`
			};
		}

		// Re-throw unknown errors
		throw error;
	}
}

// Stops processing on rate limit to prevent overwhelming *arr API
export async function dispatchBatch(
	dispatches: Array<{
		connectorId: number;
		searchRegistryId: number;
		contentType: ContentType;
		searchType: SearchType;
		options: DispatchOptions;
	}>
): Promise<DispatchResult[]> {
	const results: DispatchResult[] = [];

	for (const dispatch of dispatches) {
		const result = await dispatchSearch(
			dispatch.connectorId,
			dispatch.searchRegistryId,
			dispatch.contentType,
			dispatch.searchType,
			dispatch.options
		);

		results.push(result);

		// Stop processing if we hit a rate limit
		if (result.rateLimited && result.connectorPaused) {
			// Add remaining dispatches as skipped due to rate limit
			const remainingIndex = dispatches.indexOf(dispatch) + 1;
			for (let i = remainingIndex; i < dispatches.length; i++) {
				const remaining = dispatches[i]!;
				results.push({
					success: false,
					searchRegistryId: remaining.searchRegistryId,
					connectorId: remaining.connectorId,
					error: 'Skipped: connector paused due to rate limiting',
					rateLimited: true
				});
			}
			break;
		}
	}

	return results;
}
