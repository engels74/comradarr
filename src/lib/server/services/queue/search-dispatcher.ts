import { eq } from 'drizzle-orm';
import {
	type CommandResponse,
	isArrClientError,
	RadarrClient,
	RateLimitError,
	SonarrClient,
	WhisparrClient
} from '$lib/server/connectors';
import { db } from '$lib/server/db';
import { getConnector, getDecryptedApiKey } from '$lib/server/db/queries/connectors';
import { episodes, movies, seasons, series } from '$lib/server/db/schema';
import { createLogger } from '$lib/server/logger';
import { prowlarrHealthMonitor } from '$lib/server/services/prowlarr';
import { throttleEnforcer } from '$lib/server/services/throttle';
import type { ContentType, SearchType } from './types';

const logger = createLogger('dispatcher');

/**
 * Options for dispatching a search command.
 * All IDs are DB IDs (from search_registry.contentId), NOT *arr IDs.
 * The dispatcher translates these to *arr IDs before calling the API.
 */
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

interface ContentInfo {
	contentTitle: string;
	seriesTitle?: string;
	seasonNumber?: number;
	episodeNumber?: number;
	year?: number;
	arrId: number;
	arrSeriesId?: number;
}

async function getEpisodeInfo(contentId: number): Promise<ContentInfo | null> {
	const result = await db
		.select({
			title: episodes.title,
			seasonNumber: episodes.seasonNumber,
			episodeNumber: episodes.episodeNumber,
			seriesTitle: series.title,
			arrId: episodes.arrId,
			arrSeriesId: series.arrId
		})
		.from(episodes)
		.innerJoin(seasons, eq(episodes.seasonId, seasons.id))
		.innerJoin(series, eq(seasons.seriesId, series.id))
		.where(eq(episodes.id, contentId))
		.limit(1);

	if (result.length === 0) return null;
	const row = result[0]!;
	const epTitle = row.title ?? `S${row.seasonNumber}E${String(row.episodeNumber).padStart(2, '0')}`;
	return {
		contentTitle: epTitle,
		seriesTitle: row.seriesTitle,
		seasonNumber: row.seasonNumber,
		episodeNumber: row.episodeNumber,
		arrId: row.arrId,
		arrSeriesId: row.arrSeriesId
	};
}

async function getMovieInfo(contentId: number): Promise<ContentInfo | null> {
	const result = await db
		.select({
			title: movies.title,
			year: movies.year,
			arrId: movies.arrId
		})
		.from(movies)
		.where(eq(movies.id, contentId))
		.limit(1);

	if (result.length === 0) return null;
	const row = result[0]!;
	return {
		contentTitle: row.title ?? 'Unknown Movie',
		...(row.year != null && { year: row.year }),
		arrId: row.arrId
	};
}

async function executeSearchCommand(
	client: SonarrClient | RadarrClient | WhisparrClient,
	connectorType: string,
	options: DispatchOptions
): Promise<CommandResponse> {
	if (connectorType === 'radarr') {
		if (!options.movieIds || options.movieIds.length === 0) {
			throw new Error('movieIds required for Radarr search');
		}
		return (client as RadarrClient).sendMoviesSearch(options.movieIds);
	}

	const sonarrClient = client as SonarrClient | WhisparrClient;

	if (options.seriesId !== undefined && options.seasonNumber !== undefined) {
		return sonarrClient.sendSeasonSearch(options.seriesId, options.seasonNumber);
	}

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
		logger.warn('Prowlarr health check failed (continuing dispatch)', {
			error: error instanceof Error ? error.message : 'Unknown error'
		});
	}
}

// On HTTP 429: pauses connector via ThrottleEnforcer.handleRateLimitResponse()
export async function dispatchSearch(
	connectorId: number,
	searchRegistryId: number,
	contentType: ContentType,
	searchType: SearchType,
	options: DispatchOptions
): Promise<DispatchResult> {
	const startTime = Date.now();

	const contentInfo =
		contentType === 'movie'
			? await getMovieInfo(options.movieIds?.[0] ?? 0)
			: await getEpisodeInfo(options.episodeIds?.[0] ?? 0);

	const connector = await getConnector(connectorId);
	const connectorName = connector?.name ?? `Connector ${connectorId}`;

	const throttleResult = await throttleEnforcer.canDispatch(connectorId);
	if (!throttleResult.allowed) {
		const throttleStatus = await throttleEnforcer.getStatus(connectorId);
		logger.warn('Search throttled', {
			contentType,
			contentTitle: contentInfo?.contentTitle ?? 'Unknown',
			...(contentInfo?.seriesTitle && { seriesTitle: contentInfo.seriesTitle }),
			connectorName,
			searchType,
			reason: throttleResult.reason,
			retryAfterMs: throttleResult.retryAfterMs,
			throttle: {
				requestsThisMinute: throttleStatus.requestsThisMinute,
				remainingToday: throttleStatus.remainingToday,
				isPaused: throttleStatus.isPaused
			}
		});
		return {
			success: false,
			searchRegistryId,
			connectorId,
			error: `Throttled: ${throttleResult.reason}`,
			rateLimited: throttleResult.reason === 'rate_limit'
		};
	}

	await checkProwlarrHealth();

	const connectorResult = await createConnectorClient(connectorId);
	if (!connectorResult) {
		logger.error('Search failed - connector not found', {
			contentType,
			contentTitle: contentInfo?.contentTitle ?? 'Unknown',
			connectorId,
			searchType
		});
		return {
			success: false,
			searchRegistryId,
			connectorId,
			error: 'Connector not found or unsupported type'
		};
	}

	const { client, type: connectorType } = connectorResult;

	// Translate DB IDs to *arr IDs for the API call
	// options.movieIds/episodeIds contain DB IDs (from search_registry.contentId),
	// but the *arr API expects *arr IDs (movies.arrId/episodes.arrId)
	if (!contentInfo) {
		logger.error('Search failed - content not found in database', {
			contentType,
			contentId: options.movieIds?.[0] ?? options.episodeIds?.[0],
			connectorId,
			searchType
		});
		return {
			success: false,
			searchRegistryId,
			connectorId,
			error: 'Content not found in database'
		};
	}

	const arrOptions: DispatchOptions =
		contentType === 'movie'
			? { movieIds: [contentInfo.arrId] }
			: options.seriesId !== undefined &&
					options.seasonNumber !== undefined &&
					contentInfo.arrSeriesId !== undefined
				? { seriesId: contentInfo.arrSeriesId, seasonNumber: options.seasonNumber }
				: { episodeIds: [contentInfo.arrId] };

	try {
		const commandResponse = await executeSearchCommand(client, connectorType, arrOptions);
		await throttleEnforcer.recordRequest(connectorId);
		const durationMs = Date.now() - startTime;

		logger.info('Search dispatched', {
			contentType,
			contentTitle: contentInfo?.contentTitle ?? 'Unknown',
			...(contentInfo?.seriesTitle && { seriesTitle: contentInfo.seriesTitle }),
			...(contentInfo?.year && { year: contentInfo.year }),
			connectorName,
			searchType,
			commandId: commandResponse.id,
			durationMs
		});

		return {
			success: true,
			searchRegistryId,
			connectorId,
			commandId: commandResponse.id
		};
	} catch (error) {
		const durationMs = Date.now() - startTime;

		if (error instanceof RateLimitError) {
			await throttleEnforcer.handleRateLimitResponse(connectorId, error.retryAfter);
			const throttleStatus = await throttleEnforcer.getStatus(connectorId);

			logger.warn('Search rate limited by *arr API', {
				contentType,
				contentTitle: contentInfo?.contentTitle ?? 'Unknown',
				connectorName,
				searchType,
				retryAfterSeconds: error.retryAfter,
				durationMs,
				throttle: {
					requestsThisMinute: throttleStatus.requestsThisMinute,
					remainingToday: throttleStatus.remainingToday,
					isPaused: throttleStatus.isPaused,
					pausedUntil: throttleStatus.pauseExpiresInMs
						? new Date(Date.now() + throttleStatus.pauseExpiresInMs).toISOString()
						: null
				}
			});

			return {
				success: false,
				searchRegistryId,
				connectorId,
				error: 'Rate limited by *arr API',
				rateLimited: true,
				connectorPaused: true
			};
		}

		if (isArrClientError(error)) {
			logger.error('Search failed - API error', {
				contentType,
				contentTitle: contentInfo?.contentTitle ?? 'Unknown',
				connectorName,
				searchType,
				errorCategory: error.category,
				errorMessage: error.message,
				durationMs
			});

			return {
				success: false,
				searchRegistryId,
				connectorId,
				error: `API error: ${error.message} (${error.category})`
			};
		}

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

		if (result.rateLimited && result.connectorPaused) {
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
