/**
 * Episode batching decision logic.
 *
 * Determines whether to use SeasonSearch (season pack) or individual
 * EpisodeSearch commands based on season statistics and configurable thresholds.
 *
 * Decision rules (from Requirements 6.1, 6.2, 6.3):
 * - SeasonSearch: Season fully aired AND missing% >= threshold AND missingCount >= minCount
 * - EpisodeSearch: Season currently airing OR below threshold
 *
 * @module services/queue/episode-batcher
 * @requirements 6.1, 6.2, 6.3
 */

import { BATCHING_CONFIG } from './config';

// =============================================================================
// Types
// =============================================================================

/**
 * Search command types for TV content.
 *
 * - `SeasonSearch`: Search for entire season (season pack)
 * - `EpisodeSearch`: Search for individual episodes
 */
export type EpisodeSearchCommand = 'SeasonSearch' | 'EpisodeSearch';

/**
 * Statistics required to make a batching decision for a season.
 *
 * These values come from the seasons table in the content mirror.
 */
export interface SeasonStatistics {
	/**
	 * Total number of episodes in the season.
	 * Must be >= 0.
	 */
	totalEpisodes: number;

	/**
	 * Number of episodes already downloaded.
	 * Must be >= 0 and <= totalEpisodes.
	 */
	downloadedEpisodes: number;

	/**
	 * Next airing date for the season.
	 * - null: Season is fully aired (no more episodes expected)
	 * - Date: Season is currently airing (more episodes expected)
	 */
	nextAiring: Date | null;
}

/**
 * Configuration for batching thresholds.
 *
 * All values must be non-negative.
 */
export interface BatchingConfig {
	/**
	 * Minimum missing percentage to qualify for SeasonSearch (0-100).
	 * @default 50
	 */
	seasonSearchMinMissingPercent: number;

	/**
	 * Minimum missing episode count to qualify for SeasonSearch.
	 * @default 3
	 */
	seasonSearchMinMissingCount: number;
}

/**
 * Reason codes for batching decisions.
 *
 * These codes indicate why a particular search command was chosen:
 * - `season_fully_aired_high_missing`: Requirement 6.1 - SeasonSearch
 * - `season_currently_airing`: Requirement 6.2 - EpisodeSearch
 * - `below_missing_threshold`: Requirement 6.3 - EpisodeSearch
 * - `no_missing_episodes`: Edge case - no search needed
 * - `season_pack_fallback`: Requirement 6.5 - EpisodeSearch fallback after season pack failure
 */
export type BatchingReason =
	| 'season_fully_aired_high_missing'
	| 'season_currently_airing'
	| 'below_missing_threshold'
	| 'no_missing_episodes'
	| 'season_pack_fallback';

/**
 * Result of a batching decision.
 *
 * Contains the chosen command and the reason for the decision.
 */
export interface BatchingDecision {
	/**
	 * The search command to use.
	 */
	command: EpisodeSearchCommand;

	/**
	 * Reason code explaining why this command was chosen.
	 */
	reason: BatchingReason;
}

// =============================================================================
// Episode Grouping Types (Requirements 6.4, 29.4)
// =============================================================================

/**
 * Episode with series information for grouping.
 *
 * Used to batch episodes by series before creating search commands.
 *
 * @requirements 6.4
 */
export interface EpisodeForGrouping {
	/**
	 * Episode content ID (from episodes.id in the content mirror).
	 */
	episodeId: number;

	/**
	 * Series ID for grouping (from series.id in the content mirror).
	 */
	seriesId: number;

	/**
	 * *arr application episode ID (for EpisodeSearch API calls).
	 */
	arrEpisodeId: number;
}

/**
 * Movie for batching.
 *
 * Used to create batched movie search commands.
 *
 * @requirements 29.5
 */
export interface MovieForBatching {
	/**
	 * Movie content ID (from movies.id in the content mirror).
	 */
	movieId: number;

	/**
	 * *arr application movie ID (for MoviesSearch API calls).
	 */
	arrMovieId: number;
}

/**
 * A batch of episode IDs to search (grouped by series).
 *
 * Each batch contains episodes from a single series,
 * with at most MAX_EPISODES_PER_SEARCH episodes.
 *
 * @requirements 6.4, 29.4
 */
export interface EpisodeBatch {
	/**
	 * Series ID that all episodes in this batch belong to.
	 */
	seriesId: number;

	/**
	 * *arr application episode IDs to search (max 10).
	 */
	arrEpisodeIds: number[];
}

/**
 * A batch of movie IDs to search.
 *
 * Each batch contains at most MAX_MOVIES_PER_SEARCH movies.
 *
 * @requirements 29.5
 */
export interface MovieBatch {
	/**
	 * *arr application movie IDs to search (max 10).
	 */
	arrMovieIds: number[];
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Calculates the missing episode percentage for a season.
 *
 * @param totalEpisodes - Total number of episodes
 * @param downloadedEpisodes - Number of episodes downloaded
 * @returns Missing percentage (0-100), or 0 if totalEpisodes is 0
 */
export function calculateMissingPercent(totalEpisodes: number, downloadedEpisodes: number): number {
	if (totalEpisodes <= 0) {
		return 0;
	}

	const missingEpisodes = totalEpisodes - downloadedEpisodes;
	return (missingEpisodes / totalEpisodes) * 100;
}

/**
 * Calculates the number of missing episodes for a season.
 *
 * @param totalEpisodes - Total number of episodes
 * @param downloadedEpisodes - Number of episodes downloaded
 * @returns Number of missing episodes (>= 0)
 */
export function calculateMissingCount(totalEpisodes: number, downloadedEpisodes: number): number {
	return Math.max(0, totalEpisodes - downloadedEpisodes);
}

/**
 * Checks if a season is fully aired (no more episodes expected).
 *
 * @param nextAiring - Next airing date (null if fully aired)
 * @returns true if season is fully aired
 */
export function isSeasonFullyAired(nextAiring: Date | null): boolean {
	return nextAiring === null;
}

// =============================================================================
// Main Decision Function
// =============================================================================

/**
 * Default batching configuration derived from BATCHING_CONFIG.
 */
const DEFAULT_BATCHING_CONFIG: BatchingConfig = {
	seasonSearchMinMissingPercent: BATCHING_CONFIG.SEASON_SEARCH_MIN_MISSING_PERCENT,
	seasonSearchMinMissingCount: BATCHING_CONFIG.SEASON_SEARCH_MIN_MISSING_COUNT
};

/**
 * Determines the appropriate search command based on season statistics.
 *
 * Decision logic (in order of priority):
 * 1. If no missing episodes → EpisodeSearch with 'no_missing_episodes' reason
 * 2. If season currently airing (nextAiring set) → EpisodeSearch (Requirement 6.2)
 * 3. If missing count < minimum threshold → EpisodeSearch (Requirement 6.3)
 * 4. If missing % < threshold → EpisodeSearch (Requirement 6.3)
 * 5. If season fully aired AND missing% >= threshold AND count >= min → SeasonSearch (Requirement 6.1)
 *
 * This function is pure (no side effects) and deterministic (same inputs = same output).
 *
 * @param stats - Season statistics (totalEpisodes, downloadedEpisodes, nextAiring)
 * @param config - Optional batching configuration (uses defaults if not provided)
 * @returns Batching decision with command and reason
 *
 * @example
 * ```typescript
 * // Fully aired season with 60% missing → SeasonSearch
 * const result = determineBatchingDecision({
 *   totalEpisodes: 10,
 *   downloadedEpisodes: 4,
 *   nextAiring: null
 * });
 * // { command: 'SeasonSearch', reason: 'season_fully_aired_high_missing' }
 *
 * // Currently airing season → EpisodeSearch
 * const result = determineBatchingDecision({
 *   totalEpisodes: 10,
 *   downloadedEpisodes: 2,
 *   nextAiring: new Date('2025-12-01')
 * });
 * // { command: 'EpisodeSearch', reason: 'season_currently_airing' }
 * ```
 *
 * @requirements 6.1, 6.2, 6.3
 */
export function determineBatchingDecision(
	stats: SeasonStatistics,
	config?: Partial<BatchingConfig>
): BatchingDecision {
	// Merge provided config with defaults
	const effectiveConfig: BatchingConfig = {
		...DEFAULT_BATCHING_CONFIG,
		...config
	};

	const { totalEpisodes, downloadedEpisodes, nextAiring } = stats;
	const { seasonSearchMinMissingPercent, seasonSearchMinMissingCount } = effectiveConfig;

	// Calculate derived values
	const missingCount = calculateMissingCount(totalEpisodes, downloadedEpisodes);
	const missingPercent = calculateMissingPercent(totalEpisodes, downloadedEpisodes);
	const fullyAired = isSeasonFullyAired(nextAiring);

	// Decision 1: No missing episodes
	if (missingCount === 0) {
		return {
			command: 'EpisodeSearch',
			reason: 'no_missing_episodes'
		};
	}

	// Decision 2: Season currently airing (Requirement 6.2)
	if (!fullyAired) {
		return {
			command: 'EpisodeSearch',
			reason: 'season_currently_airing'
		};
	}

	// Decision 3 & 4: Below threshold (Requirement 6.3)
	// Check both missing count and missing percentage
	if (missingCount < seasonSearchMinMissingCount || missingPercent < seasonSearchMinMissingPercent) {
		return {
			command: 'EpisodeSearch',
			reason: 'below_missing_threshold'
		};
	}

	// Decision 5: Fully aired with high missing (Requirement 6.1)
	// At this point: fullyAired=true, missingCount>=min, missingPercent>=threshold
	return {
		command: 'SeasonSearch',
		reason: 'season_fully_aired_high_missing'
	};
}

/**
 * Extended batching decision that considers season pack failure history.
 *
 * If a previous SeasonSearch (season pack) failed for this season,
 * this function will return EpisodeSearch to fall back to individual
 * episode searches, regardless of the normal decision logic.
 *
 * This function is pure (no side effects) and deterministic (same inputs = same output).
 *
 * @param stats - Season statistics (totalEpisodes, downloadedEpisodes, nextAiring)
 * @param seasonPackFailed - Whether a season pack search previously failed for this season
 * @param config - Optional batching configuration (uses defaults if not provided)
 * @returns Batching decision with command and reason
 *
 * @example
 * ```typescript
 * // Season pack previously failed → force EpisodeSearch fallback
 * const result = determineBatchingDecisionWithFallback(
 *   { totalEpisodes: 10, downloadedEpisodes: 4, nextAiring: null },
 *   true  // season pack failed
 * );
 * // { command: 'EpisodeSearch', reason: 'season_pack_fallback' }
 *
 * // No previous failure → normal decision logic
 * const result = determineBatchingDecisionWithFallback(
 *   { totalEpisodes: 10, downloadedEpisodes: 4, nextAiring: null },
 *   false
 * );
 * // { command: 'SeasonSearch', reason: 'season_fully_aired_high_missing' }
 * ```
 *
 * @requirements 6.5
 */
export function determineBatchingDecisionWithFallback(
	stats: SeasonStatistics,
	seasonPackFailed: boolean,
	config?: Partial<BatchingConfig>
): BatchingDecision {
	// Requirement 6.5: If season pack search previously failed, fall back to individual episodes
	if (seasonPackFailed) {
		return {
			command: 'EpisodeSearch',
			reason: 'season_pack_fallback'
		};
	}

	// Otherwise, use normal decision logic
	return determineBatchingDecision(stats, config);
}

// =============================================================================
// Episode Grouping Functions (Requirements 6.4, 29.4, 29.5)
// =============================================================================

/**
 * Groups episodes by their series ID.
 *
 * This function is pure (no side effects) and deterministic (same inputs = same output).
 *
 * @param episodes - Array of episodes with series information
 * @returns Map of seriesId to array of episodes belonging to that series
 *
 * @example
 * ```typescript
 * const episodes = [
 *   { episodeId: 1, seriesId: 100, arrEpisodeId: 1001 },
 *   { episodeId: 2, seriesId: 100, arrEpisodeId: 1002 },
 *   { episodeId: 3, seriesId: 200, arrEpisodeId: 2001 }
 * ];
 * const grouped = groupEpisodesBySeries(episodes);
 * // Map {
 * //   100 => [{ episodeId: 1, ... }, { episodeId: 2, ... }],
 * //   200 => [{ episodeId: 3, ... }]
 * // }
 * ```
 *
 * @requirements 6.4
 */
export function groupEpisodesBySeries(
	episodes: readonly EpisodeForGrouping[]
): Map<number, EpisodeForGrouping[]> {
	const grouped = new Map<number, EpisodeForGrouping[]>();

	for (const episode of episodes) {
		const existing = grouped.get(episode.seriesId);
		if (existing) {
			existing.push(episode);
		} else {
			grouped.set(episode.seriesId, [episode]);
		}
	}

	return grouped;
}

/**
 * Creates episode batches grouped by series with a maximum batch size.
 *
 * Each batch contains only episodes from a single series, and no batch
 * exceeds the maximum size (default: MAX_EPISODES_PER_SEARCH = 10).
 *
 * This function is pure (no side effects) and deterministic (same inputs = same output).
 *
 * @param episodes - Array of episodes with series information
 * @param maxBatchSize - Maximum episodes per batch (default: MAX_EPISODES_PER_SEARCH)
 * @returns Array of episode batches, each grouped by series
 *
 * @example
 * ```typescript
 * // 12 episodes from series 100, 3 episodes from series 200
 * const batches = createEpisodeBatches(episodes);
 * // [
 * //   { seriesId: 100, arrEpisodeIds: [1001, 1002, ..., 1010] },  // 10 episodes
 * //   { seriesId: 100, arrEpisodeIds: [1011, 1012] },             // 2 episodes
 * //   { seriesId: 200, arrEpisodeIds: [2001, 2002, 2003] }        // 3 episodes
 * // ]
 * ```
 *
 * @requirements 6.4, 29.4
 */
export function createEpisodeBatches(
	episodes: readonly EpisodeForGrouping[],
	maxBatchSize: number = BATCHING_CONFIG.MAX_EPISODES_PER_SEARCH
): EpisodeBatch[] {
	// Edge case: empty input
	if (episodes.length === 0) {
		return [];
	}

	// Edge case: invalid batch size
	if (maxBatchSize <= 0) {
		return [];
	}

	const batches: EpisodeBatch[] = [];
	const groupedBySeries = groupEpisodesBySeries(episodes);

	// Process each series group
	for (const [seriesId, seriesEpisodes] of groupedBySeries) {
		// Split series episodes into batches of maxBatchSize
		for (let i = 0; i < seriesEpisodes.length; i += maxBatchSize) {
			const batchEpisodes = seriesEpisodes.slice(i, i + maxBatchSize);
			batches.push({
				seriesId,
				arrEpisodeIds: batchEpisodes.map((ep) => ep.arrEpisodeId)
			});
		}
	}

	return batches;
}

/**
 * Creates movie batches with a maximum batch size.
 *
 * Unlike episodes, movies don't have a parent grouping container,
 * so batching is simply splitting into chunks of the maximum size.
 *
 * This function is pure (no side effects) and deterministic (same inputs = same output).
 *
 * @param movies - Array of movies to batch
 * @param maxBatchSize - Maximum movies per batch (default: MAX_MOVIES_PER_SEARCH)
 * @returns Array of movie batches
 *
 * @example
 * ```typescript
 * const movies = [
 *   { movieId: 1, arrMovieId: 101 },
 *   { movieId: 2, arrMovieId: 102 },
 *   // ... 12 total movies
 * ];
 * const batches = createMovieBatches(movies);
 * // [
 * //   { arrMovieIds: [101, 102, ..., 110] },  // 10 movies
 * //   { arrMovieIds: [111, 112] }              // 2 movies
 * // ]
 * ```
 *
 * @requirements 29.5
 */
export function createMovieBatches(
	movies: readonly MovieForBatching[],
	maxBatchSize: number = BATCHING_CONFIG.MAX_MOVIES_PER_SEARCH
): MovieBatch[] {
	// Edge case: empty input
	if (movies.length === 0) {
		return [];
	}

	// Edge case: invalid batch size
	if (maxBatchSize <= 0) {
		return [];
	}

	const batches: MovieBatch[] = [];

	// Split movies into batches of maxBatchSize
	for (let i = 0; i < movies.length; i += maxBatchSize) {
		const batchMovies = movies.slice(i, i + maxBatchSize);
		batches.push({
			arrMovieIds: batchMovies.map((movie) => movie.arrMovieId)
		});
	}

	return batches;
}
