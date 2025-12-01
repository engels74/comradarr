/**
 * Search Dispatcher Service
 *
 * Orchestrates dispatching search commands to *arr connectors with:
 * - Pre-dispatch throttle checking
 * - Optional Prowlarr indexer health check (informational only)
 * - HTTP 429 (RateLimitError) handling
 * - Request recording for rate limiting
 *
 * @module services/queue/search-dispatcher
 * @requirements 7.3, 38.5, 38.6
 */

import { getConnector, getDecryptedApiKey } from '$lib/server/db/queries/connectors';
import {
	SonarrClient,
	RadarrClient,
	WhisparrClient,
	RateLimitError,
	isArrClientError,
	type CommandResponse
} from '$lib/server/connectors';
import { throttleEnforcer } from '$lib/server/services/throttle';
import { prowlarrHealthMonitor } from '$lib/server/services/prowlarr';
import type { ContentType, SearchType } from './types';

// =============================================================================
// Types
// =============================================================================

/**
 * Options for dispatching a search.
 */
export interface DispatchOptions {
	/** Episode IDs for EpisodeSearch (Sonarr/Whisparr) */
	episodeIds?: number[];
	/** Series ID for SeasonSearch (Sonarr/Whisparr) */
	seriesId?: number;
	/** Season number for SeasonSearch (Sonarr/Whisparr) */
	seasonNumber?: number;
	/** Movie IDs for MoviesSearch (Radarr) */
	movieIds?: number[];
}

/**
 * Result of a search dispatch operation.
 */
export interface DispatchResult {
	/** Whether the dispatch was successful */
	success: boolean;
	/** The search registry ID */
	searchRegistryId: number;
	/** The connector ID */
	connectorId: number;
	/** Command ID from *arr API (if successful) */
	commandId?: number;
	/** Error message (if failed) */
	error?: string;
	/** Whether failure was due to rate limiting */
	rateLimited?: boolean;
	/** Whether the connector is now paused due to rate limiting */
	connectorPaused?: boolean;
}

/**
 * Reason for dispatch failure.
 */
export type DispatchFailureReason =
	| 'throttled'
	| 'rate_limited'
	| 'connector_not_found'
	| 'api_error'
	| 'invalid_options';

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Creates an appropriate connector client based on connector type.
 */
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

/**
 * Dispatches a search command to the appropriate connector client.
 */
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

/**
 * Check Prowlarr indexer health and log warning if issues detected.
 * This is informational only - does NOT block dispatch.
 * Uses cached data to avoid additional API calls.
 *
 * @requirements 38.5, 38.6
 */
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
			console.warn('[dispatcher] Prowlarr health warning:', {
				rateLimitedIndexers: rateLimitedIndexers.length,
				totalIndexers: cachedHealth.length,
				indexerNames: rateLimitedIndexers.map((h) => h.name),
				dataStale: staleData
			});
		}
	} catch (error) {
		// Requirement 38.6: Continue normal operation if Prowlarr unreachable
		// Log error but do not throw - this check is purely informational
		console.warn(
			'[dispatcher] Prowlarr health check failed (continuing dispatch):',
			error instanceof Error ? error.message : 'Unknown error'
		);
	}
}

// =============================================================================
// Main Dispatch Function
// =============================================================================

/**
 * Dispatches a search request to a connector with throttle and rate limit handling.
 *
 * Flow:
 * 1. Check if dispatch is allowed via ThrottleEnforcer.canDispatch()
 * 2. Create connector client
 * 3. Execute search command
 * 4. Record request on success via ThrottleEnforcer.recordRequest()
 * 5. On HTTP 429: call ThrottleEnforcer.handleRateLimitResponse() to pause connector
 *
 * @param connectorId - The connector to dispatch to
 * @param searchRegistryId - The search registry ID for tracking
 * @param contentType - Type of content being searched
 * @param searchType - Type of search (gap or upgrade)
 * @param options - Search-specific options (episodeIds, movieIds, etc.)
 * @returns Dispatch result with success/failure info
 *
 * @example
 * ```typescript
 * // Episode search
 * const result = await dispatchSearch(1, 123, 'episode', 'gap', {
 *   episodeIds: [456, 457, 458]
 * });
 *
 * // Season search
 * const result = await dispatchSearch(1, 123, 'episode', 'gap', {
 *   seriesId: 10,
 *   seasonNumber: 1
 * });
 *
 * // Movie search
 * const result = await dispatchSearch(2, 456, 'movie', 'gap', {
 *   movieIds: [789]
 * });
 *
 * if (result.rateLimited) {
 *   console.log('Connector paused due to rate limiting');
 * }
 * ```
 *
 * @requirements 7.3
 */
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
	// Requirements 38.5, 38.6
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
		// 5. Handle HTTP 429 - catch RateLimitError and pause connector
		// Requirement 7.3: WHEN an HTTP 429 response is received THEN the System
		// SHALL pause all searches for the affected connector and apply extended cooldown
		if (error instanceof RateLimitError) {
			// Call handleRateLimitResponse to set pausedUntil in throttle_state
			// This respects Retry-After header when present, otherwise uses profile's rateLimitPauseSeconds
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

/**
 * Dispatches multiple searches in batch, stopping on rate limit.
 *
 * Processes searches sequentially, stopping if any search triggers a rate limit.
 * This prevents overwhelming the *arr API after a 429 response.
 *
 * @param dispatches - Array of dispatch parameters
 * @returns Array of dispatch results
 *
 * @requirements 7.3
 */
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
