// SeasonSearch: fully aired AND missing% >= threshold AND count >= min; else EpisodeSearch

import { BATCHING_CONFIG, getBatchingConfig } from './config';

export type EpisodeSearchCommand = 'SeasonSearch' | 'EpisodeSearch';

export interface SeasonStatistics {
	totalEpisodes: number;
	downloadedEpisodes: number;
	// null = fully aired, Date = currently airing
	nextAiring: Date | null;
}

export interface BatchingConfig {
	seasonSearchMinMissingPercent: number;
	seasonSearchMinMissingCount: number;
}

export type BatchingReason =
	| 'season_fully_aired_high_missing'
	| 'season_currently_airing'
	| 'below_missing_threshold'
	| 'no_missing_episodes'
	| 'season_pack_fallback';

export interface BatchingDecision {
	command: EpisodeSearchCommand;
	reason: BatchingReason;
}

export interface EpisodeForGrouping {
	episodeId: number;
	seriesId: number;
	arrEpisodeId: number;
}

export interface MovieForBatching {
	movieId: number;
	arrMovieId: number;
}

export interface EpisodeBatch {
	seriesId: number;
	arrEpisodeIds: number[];
}

export interface MovieBatch {
	arrMovieIds: number[];
}

export function calculateMissingPercent(totalEpisodes: number, downloadedEpisodes: number): number {
	if (totalEpisodes <= 0) {
		return 0;
	}

	const missingEpisodes = totalEpisodes - downloadedEpisodes;
	return (missingEpisodes / totalEpisodes) * 100;
}

export function calculateMissingCount(totalEpisodes: number, downloadedEpisodes: number): number {
	return Math.max(0, totalEpisodes - downloadedEpisodes);
}

export function isSeasonFullyAired(nextAiring: Date | null): boolean {
	return nextAiring === null;
}

const DEFAULT_BATCHING_CONFIG: BatchingConfig = {
	seasonSearchMinMissingPercent: BATCHING_CONFIG.SEASON_SEARCH_MIN_MISSING_PERCENT,
	seasonSearchMinMissingCount: BATCHING_CONFIG.SEASON_SEARCH_MIN_MISSING_COUNT
};

// Pure, deterministic decision based on season statistics
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

	// Decision 2: Season currently airing
	if (!fullyAired) {
		return {
			command: 'EpisodeSearch',
			reason: 'season_currently_airing'
		};
	}

	// Decision 3 & 4: Below threshold
	// Check both missing count and missing percentage
	if (
		missingCount < seasonSearchMinMissingCount ||
		missingPercent < seasonSearchMinMissingPercent
	) {
		return {
			command: 'EpisodeSearch',
			reason: 'below_missing_threshold'
		};
	}

	// Decision 5: Fully aired with high missing
	// At this point: fullyAired=true, missingCount>=min, missingPercent>=threshold
	return {
		command: 'SeasonSearch',
		reason: 'season_fully_aired_high_missing'
	};
}

// If season pack previously failed, fall back to individual episode searches
export function determineBatchingDecisionWithFallback(
	stats: SeasonStatistics,
	seasonPackFailed: boolean,
	config?: Partial<BatchingConfig>
): BatchingDecision {
	// If season pack search previously failed, fall back to individual episodes
	if (seasonPackFailed) {
		return {
			command: 'EpisodeSearch',
			reason: 'season_pack_fallback'
		};
	}

	// Otherwise, use normal decision logic
	return determineBatchingDecision(stats, config);
}

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

// Groups by series and splits into batches of maxBatchSize (default 10)
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

// Movies don't have parent grouping, just split into chunks of maxBatchSize
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

// Async version that fetches thresholds from database settings
export async function determineBatchingDecisionWithConfig(
	stats: SeasonStatistics
): Promise<BatchingDecision> {
	const batchingConfig = await getBatchingConfig();

	const config: BatchingConfig = {
		seasonSearchMinMissingPercent: batchingConfig.SEASON_SEARCH_MIN_MISSING_PERCENT,
		seasonSearchMinMissingCount: batchingConfig.SEASON_SEARCH_MIN_MISSING_COUNT
	};

	return determineBatchingDecision(stats, config);
}

export async function determineBatchingDecisionWithFallbackAndConfig(
	stats: SeasonStatistics,
	seasonPackFailed: boolean
): Promise<BatchingDecision> {
	const batchingConfig = await getBatchingConfig();

	const config: BatchingConfig = {
		seasonSearchMinMissingPercent: batchingConfig.SEASON_SEARCH_MIN_MISSING_PERCENT,
		seasonSearchMinMissingCount: batchingConfig.SEASON_SEARCH_MIN_MISSING_COUNT
	};

	return determineBatchingDecisionWithFallback(stats, seasonPackFailed, config);
}
