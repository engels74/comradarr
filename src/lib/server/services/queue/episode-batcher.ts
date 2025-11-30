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
 */
export type BatchingReason =
	| 'season_fully_aired_high_missing'
	| 'season_currently_airing'
	| 'below_missing_threshold'
	| 'no_missing_episodes';

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
