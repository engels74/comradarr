/**
 * Radarr API client
 *
 * Extends BaseArrClient with Radarr-specific functionality.
 * Inherits ping(), getSystemStatus(), and getHealth() from base class.
 *
 * @module connectors/radarr/client

 */

import { createLogger } from '$lib/server/logger';
import { BaseArrClient } from '../common/base-client.js';
import { parseCommandResponse } from '../common/parsers.js';
import type { CommandResponse, PaginationOptions } from '../common/types.js';
import { parsePaginatedMoviesLenient, parseRadarrMovie } from './parsers.js';
import type { RadarrMovie } from './types.js';

const logger = createLogger('radarr-client');

/**
 * Options for fetching wanted movies (missing or cutoff unmet)
 */
export interface WantedOptions extends PaginationOptions {
	/**
	 * Filter by monitored status (default: true)
	 * When true, only returns movies that are monitored
	 */
	monitored?: boolean;
}

/**
 * API version detection result
 */
export interface ApiVersionInfo {
	/** The full Radarr application version string (e.g., "5.2.0.8171") */
	appVersion: string;
	/** The major version number (e.g., 5) */
	majorVersion: number;
	/** The API version path to use (e.g., "v3") */
	apiVersion: string;
}

/**
 * Radarr API client for movie library management
 *
 * Provides methods for communicating with Radarr's API v3:
 * - Connection testing via ping()
 * - System status retrieval via getSystemStatus()
 * - Health check via getHealth()
 * - API version detection via detectApiVersion()
 * - Library data retrieval via getMovies()
 *
 * @example
 * ```typescript
 * const client = new RadarrClient({
 *   baseUrl: 'http://localhost:7878',
 *   apiKey: 'your-api-key'
 * });
 *
 * const isReachable = await client.ping();
 * const status = await client.getSystemStatus();
 * const health = await client.getHealth();
 * const version = await client.detectApiVersion();
 * const movies = await client.getMovies();
 * ```
 */
export class RadarrClient extends BaseArrClient {
	// Inherited from BaseArrClient:
	// - ping(): Promise<boolean>
	// - getSystemStatus(): Promise<SystemStatus>
	// - getHealth(): Promise<HealthCheck[]>

	/**
	 * Detect the Radarr API version from system status
	 *
	 * Radarr versions 3, 4, and 5 all use API v3. This method provides
	 * version detection for potential future API version differences
	 * and feature compatibility checking.
	 *
	 * @returns API version information including app version and API version
	 * @throws {ArrClientError} On any API error (network, auth, rate limit, etc.)

	 *
	 * @example
	 * ```typescript
	 * const client = new RadarrClient({ baseUrl, apiKey });
	 * const versionInfo = await client.detectApiVersion();
	 * console.log(`Radarr ${versionInfo.appVersion} using API ${versionInfo.apiVersion}`);
	 *
	 * if (versionInfo.majorVersion >= 5) {
	 *   // Use v5-specific features
	 * }
	 * ```
	 */
	async detectApiVersion(): Promise<ApiVersionInfo> {
		const status = await this.getSystemStatus();

		// Parse major version from app version (e.g., "5.2.0.8171" -> 5)
		const versionParts = status.version.split('.');
		const majorVersion = parseInt(versionParts[0] ?? '3', 10);

		// Radarr v3, v4, and v5 all currently use API v3
		// This provides forward compatibility for detecting version-specific behavior
		const apiVersion = 'v3';

		return {
			appVersion: status.version,
			majorVersion: Number.isNaN(majorVersion) ? 3 : majorVersion,
			apiVersion
		};
	}

	/**
	 * Get all movies from Radarr
	 *
	 * Fetches the complete library of movies from Radarr.
	 * Each movie is validated and malformed records are skipped.
	 *
	 * @returns Array of all movies in the library
	 * @throws {ArrClientError} On API error (network, auth, rate limit, etc.)

	 *
	 * @example
	 * ```typescript
	 * const client = new RadarrClient({ baseUrl, apiKey });
	 * const movies = await client.getMovies();
	 * console.log(`Found ${movies.length} movies`);
	 * ```
	 */
	async getMovies(): Promise<RadarrMovie[]> {
		const response = await this.requestWithRetry<unknown[]>('movie');

		logger.debug('API response received', {
			responseLength: Array.isArray(response) ? response.length : 'not an array',
			responseType: typeof response
		});

		const movies: RadarrMovie[] = [];
		let skipped = 0;
		for (const item of response) {
			const result = parseRadarrMovie(item);
			if (result.success) {
				movies.push(result.data);
			} else {
				skipped++;
				// Log first few parsing failures for debugging
				if (skipped <= 3) {
					logger.warn('Failed to parse movie record', {
						error: result.error,
						sample: JSON.stringify(item).slice(0, 500)
					});
				}
			}
		}

		if (skipped > 0) {
			logger.warn('Skipped malformed movie records', {
				skipped,
				total: response.length,
				parsed: movies.length
			});
		}

		// If ALL records failed, throw an error to surface schema mismatch
		if (movies.length === 0 && response.length > 0) {
			throw new Error(
				`All ${response.length} movies failed parsing - possible API schema mismatch`
			);
		}

		logger.info('Movies fetched successfully', {
			total: movies.length
		});

		return movies;
	}

	/**
	 * Fetch all paginated movies from a wanted endpoint
	 *
	 * Handles pagination automatically, fetching all pages until complete.
	 * Uses pageSize of 1000 per Requirement 2.5 (pagination batches).
	 *
	 * @param endpoint - The wanted endpoint ('wanted/missing' or 'wanted/cutoff')
	 * @param options - Pagination and filter options
	 * @returns Array of all wanted movies across all pages
	 * @throws {ArrClientError} On API error
	 * @throws {Error} If response parsing fails
	 */
	private async fetchAllWantedMovies(
		endpoint: string,
		options?: WantedOptions
	): Promise<RadarrMovie[]> {
		const pageSize = options?.pageSize ?? 1000;
		const monitored = options?.monitored ?? true;
		const sortKey = options?.sortKey ?? 'title';
		const sortDirection = options?.sortDirection ?? 'descending';

		let page = options?.page ?? 1;
		const allMovies: RadarrMovie[] = [];

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

			const result = parsePaginatedMoviesLenient(response);
			if (!result.success) {
				throw new Error(result.error);
			}

			allMovies.push(...result.data.records);

			// Check if we've fetched all records (Requirement 29.2)
			// Continue until page * pageSize >= totalRecords
			if (page * pageSize >= result.data.totalRecords) {
				break;
			}

			page++;
		}

		return allMovies;
	}

	/**
	 * Get all missing movies from Radarr
	 *
	 * Fetches movies where monitored=true AND hasFile=false.
	 * Automatically paginates to retrieve all results.
	 *
	 * @param options - Pagination and filter options
	 * @returns Array of all missing movies
	 * @throws {ArrClientError} On API error (network, auth, rate limit, etc.)

	 *
	 * @example
	 * ```typescript
	 * const client = new RadarrClient({ baseUrl, apiKey });
	 * const missing = await client.getWantedMissing();
	 * console.log(`Found ${missing.length} missing movies`);
	 *
	 * // With custom options
	 * const recentMissing = await client.getWantedMissing({
	 *   pageSize: 50,
	 *   monitored: true
	 * });
	 * ```
	 */
	async getWantedMissing(options?: WantedOptions): Promise<RadarrMovie[]> {
		return this.fetchAllWantedMovies('wanted/missing', options);
	}

	/**
	 * Get all upgrade candidates from Radarr
	 *
	 * Fetches movies where monitored=true AND qualityCutoffNotMet=true.
	 * These are movies that exist but could be upgraded to better quality.
	 * Automatically paginates to retrieve all results.
	 *
	 * @param options - Pagination and filter options
	 * @returns Array of all upgrade candidate movies
	 * @throws {ArrClientError} On API error (network, auth, rate limit, etc.)

	 *
	 * @example
	 * ```typescript
	 * const client = new RadarrClient({ baseUrl, apiKey });
	 * const upgrades = await client.getWantedCutoff();
	 * console.log(`Found ${upgrades.length} upgrade candidates`);
	 *
	 * // With custom options
	 * const upgradesByTitle = await client.getWantedCutoff({
	 *   sortKey: 'title',
	 *   sortDirection: 'ascending'
	 * });
	 * ```
	 */
	async getWantedCutoff(options?: WantedOptions): Promise<RadarrMovie[]> {
		return this.fetchAllWantedMovies('wanted/cutoff', options);
	}

	/**
	 * Trigger a search for specific movies
	 *
	 * Sends a MoviesSearch command to Radarr to search for the specified movies.
	 * The command is executed asynchronously - use getCommandStatus() to poll for completion.
	 *
	 * @param movieIds - Array of movie IDs to search for (max 10 per batch per Requirement 29.5)
	 * @returns Command response with initial execution status
	 * @throws {ArrClientError} On API error (network, auth, rate limit, etc.)
	 * @throws {Error} If response parsing fails

	 *
	 * @example
	 * ```typescript
	 * const client = new RadarrClient({ baseUrl, apiKey });
	 * const command = await client.sendMoviesSearch([1, 2, 3]);
	 * console.log(`Command ${command.id} status: ${command.status}`);
	 *
	 * // Poll for completion
	 * const result = await client.getCommandStatus(command.id);
	 * if (result.status === 'completed') {
	 *   console.log('Search completed');
	 * }
	 * ```
	 */
	async sendMoviesSearch(movieIds: number[]): Promise<CommandResponse> {
		const response = await this.requestWithRetry<unknown>('command', {
			method: 'POST',
			body: {
				name: 'MoviesSearch',
				movieIds
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
	 * Polls Radarr for the current execution status of a previously submitted command.
	 * Use this to track command progress and determine when a search completes.
	 *
	 * @param commandId - The command ID returned from sendMoviesSearch
	 * @returns Command response with current status (queued, started, completed, failed)
	 * @throws {ArrClientError} On API error (network, auth, rate limit, etc.)
	 * @throws {NotFoundError} If command ID does not exist
	 * @throws {Error} If response parsing fails

	 *
	 * @example
	 * ```typescript
	 * const client = new RadarrClient({ baseUrl, apiKey });
	 *
	 * // Start a search
	 * const command = await client.sendMoviesSearch([1]);
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
