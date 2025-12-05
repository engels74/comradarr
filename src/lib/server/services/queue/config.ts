/**
 * Queue service configuration constants.
 *
 * Defines default priority weights and constants used for
 * priority score calculation.
 *
 * @module services/queue/config
 * @requirements 5.1, 21.4
 */

import type { PriorityWeights } from './types';

// Note: Database imports are done dynamically to avoid breaking unit tests
// that run in vitest (Node.js) which doesn't have access to Bun's SQL driver.
type SearchSettings = Awaited<
	ReturnType<typeof import('$lib/server/db/queries/settings').getSearchSettings>
>;

/**
 * Default priority weights for score calculation.
 *
 * These values provide a balanced starting point that:
 * - Prioritizes newer content slightly (recency bias)
 * - Rewards items missing longer (fairness)
 * - Respects user manual overrides strongly
 * - Penalizes repeated failures moderately
 * - Prioritizes gaps over upgrades
 *
 * @requirements 5.1
 */
export const DEFAULT_PRIORITY_WEIGHTS: Readonly<PriorityWeights> = {
	/** Weight for content age factor */
	contentAge: 30,

	/** Weight for missing duration factor */
	missingDuration: 25,

	/** Weight for user priority override */
	userPriority: 40,

	/** Penalty points per failed attempt */
	failurePenalty: 10,

	/** Bonus points for gap searches */
	gapBonus: 20
} as const;

/**
 * Priority calculation constants.
 *
 * These constants define boundaries and scaling factors
 * for the priority calculation algorithm.
 */
export const PRIORITY_CONSTANTS = {
	/**
	 * Maximum content age in days for scoring (10 years).
	 * Content older than this receives minimum age score.
	 */
	MAX_CONTENT_AGE_DAYS: 3650,

	/**
	 * Maximum missing duration in days for full score (1 year).
	 * Items missing longer than this receive maximum duration score.
	 */
	MAX_MISSING_DURATION_DAYS: 365,

	/**
	 * Base score before factors are applied.
	 * Final scores typically range around this value.
	 */
	BASE_SCORE: 1000,

	/**
	 * Scale factor for normalizing weighted contributions.
	 * Weights are divided by this to convert percentages to multipliers.
	 */
	WEIGHT_SCALE: 100,

	/**
	 * Raw score scale for age/duration factors.
	 * Normalized values (0-1) are multiplied by this.
	 */
	FACTOR_SCALE: 100
} as const;

/** Type for the priority constants */
export type PriorityConstantsType = typeof PRIORITY_CONSTANTS;

// =============================================================================
// Queue Service Configuration (Requirement 5.2)
// =============================================================================

/**
 * Queue service configuration constants.
 *
 * Defines batch sizes and limits for queue operations.
 *
 * @requirements 5.2
 */
export const QUEUE_CONFIG = {
	/**
	 * Default batch size for database operations.
	 * Controls how many items are inserted/updated per query.
	 */
	DEFAULT_BATCH_SIZE: 1000,

	/**
	 * Chunk size for priority calculation.
	 * Controls how many items are processed per iteration.
	 */
	PRIORITY_CHUNK_SIZE: 500,

	/**
	 * Default number of items to dequeue in a single call.
	 */
	DEFAULT_DEQUEUE_LIMIT: 10,

	/**
	 * Maximum number of items that can be dequeued in a single call.
	 */
	MAX_DEQUEUE_LIMIT: 100
} as const;

/** Type for the queue config constants */
export type QueueConfigType = typeof QUEUE_CONFIG;

// =============================================================================
// State Transition Configuration (Requirement 5.5, 5.6)
// =============================================================================

/**
 * State transition configuration constants.
 *
 * Defines cooldown timing and exhaustion thresholds for
 * the search state machine transitions.
 *
 * @requirements 5.5, 5.6
 */
export const STATE_TRANSITION_CONFIG = {
	/**
	 * Maximum search attempts before marking exhausted.
	 * After this many failures, the item is marked as exhausted
	 * and will not be retried automatically.
	 */
	MAX_ATTEMPTS: 5,

	/**
	 * Base cooldown delay in milliseconds (1 hour).
	 * This is the initial delay after the first failure.
	 */
	COOLDOWN_BASE_DELAY: 3600000,

	/**
	 * Maximum cooldown delay in milliseconds (24 hours).
	 * Delays are capped at this value regardless of attempt count.
	 */
	COOLDOWN_MAX_DELAY: 86400000,

	/**
	 * Backoff multiplier for cooldown calculation.
	 * Each subsequent failure multiplies the delay by this factor.
	 */
	COOLDOWN_MULTIPLIER: 2,

	/**
	 * Whether to apply jitter to cooldown delays.
	 * Jitter adds ±25% randomness to prevent thundering herd.
	 */
	COOLDOWN_JITTER: true
} as const;

/** Type for the state transition config constants */
export type StateTransitionConfigType = typeof STATE_TRANSITION_CONFIG;

// =============================================================================
// Episode Batching Configuration (Requirement 6.1, 6.2, 6.3)
// =============================================================================

/**
 * Episode batching configuration constants.
 *
 * Defines thresholds for determining when to use SeasonSearch (season pack)
 * versus individual EpisodeSearch commands.
 *
 * Decision logic:
 * - SeasonSearch: Season fully aired AND missing% >= threshold AND missingCount >= minCount
 * - EpisodeSearch: Season currently airing OR below threshold
 *
 * @requirements 6.1, 6.2, 6.3
 */
export const BATCHING_CONFIG = {
	/**
	 * Minimum missing percentage to qualify for SeasonSearch (0-100).
	 * Only fully aired seasons with this % or more missing will use SeasonSearch.
	 * @default 50
	 */
	SEASON_SEARCH_MIN_MISSING_PERCENT: 50,

	/**
	 * Minimum missing episode count to qualify for SeasonSearch.
	 * Prevents using SeasonSearch for seasons with very few missing episodes.
	 * @default 3
	 */
	SEASON_SEARCH_MIN_MISSING_COUNT: 3,

	/**
	 * Maximum episodes allowed per EpisodeSearch command.
	 * This is an API limit from *arr applications.
	 * @default 10
	 */
	MAX_EPISODES_PER_SEARCH: 10,

	/**
	 * Maximum movies allowed per MoviesSearch command.
	 * This is an API limit from *arr applications.
	 * @default 10
	 */
	MAX_MOVIES_PER_SEARCH: 10
} as const;

/** Type for the batching config constants */
export type BatchingConfigType = typeof BATCHING_CONFIG;

// =============================================================================
// Runtime Configuration Loader (Requirement 21.4)
// =============================================================================

/**
 * Cached search settings for runtime use.
 * Uses a short-lived cache to avoid excessive database queries.
 */
let cachedSettings: SearchSettings | null = null;
let cacheTimestamp: number = 0;

/**
 * Cache TTL in milliseconds (1 minute).
 * Settings changes will be reflected within this time.
 */
const CACHE_TTL_MS = 60000;

/**
 * Get current search settings from database.
 * Uses a short-lived cache to avoid excessive database queries.
 *
 * @returns Cached or fresh search settings
 */
export async function getSearchConfig(): Promise<SearchSettings> {
	const now = Date.now();
	if (cachedSettings && now - cacheTimestamp < CACHE_TTL_MS) {
		return cachedSettings;
	}

	// Dynamic import to avoid breaking unit tests that run in vitest (Node.js)
	const { getSearchSettings } = await import('$lib/server/db/queries/settings');
	cachedSettings = await getSearchSettings();
	cacheTimestamp = now;
	return cachedSettings;
}

/**
 * Invalidate the settings cache.
 * Call this after settings are updated to ensure fresh values are used.
 */
export function invalidateSearchConfigCache(): void {
	cachedSettings = null;
	cacheTimestamp = 0;
}

/**
 * Get priority weights from database settings.
 * Uses cached settings when available.
 *
 * @returns Priority weights for score calculation
 */
export async function getPriorityWeights(): Promise<PriorityWeights> {
	const config = await getSearchConfig();
	return config.priorityWeights;
}

/**
 * Mutable batching configuration type for runtime values.
 */
export interface RuntimeBatchingConfig {
	SEASON_SEARCH_MIN_MISSING_PERCENT: number;
	SEASON_SEARCH_MIN_MISSING_COUNT: number;
	MAX_EPISODES_PER_SEARCH: number;
	MAX_MOVIES_PER_SEARCH: number;
}

/**
 * Get batching configuration from database settings.
 * Combines configurable thresholds with fixed API limits.
 *
 * @returns Batching configuration for episode/season search decisions
 */
export async function getBatchingConfig(): Promise<RuntimeBatchingConfig> {
	const config = await getSearchConfig();
	return {
		SEASON_SEARCH_MIN_MISSING_PERCENT: config.seasonPackThresholds.minMissingPercent,
		SEASON_SEARCH_MIN_MISSING_COUNT: config.seasonPackThresholds.minMissingCount,
		// API limits remain constant - not user-configurable
		MAX_EPISODES_PER_SEARCH: BATCHING_CONFIG.MAX_EPISODES_PER_SEARCH,
		MAX_MOVIES_PER_SEARCH: BATCHING_CONFIG.MAX_MOVIES_PER_SEARCH
	};
}

/**
 * Mutable state transition configuration type for runtime values.
 */
export interface RuntimeStateTransitionConfig {
	MAX_ATTEMPTS: number;
	COOLDOWN_BASE_DELAY: number;
	COOLDOWN_MAX_DELAY: number;
	COOLDOWN_MULTIPLIER: number;
	COOLDOWN_JITTER: boolean;
}

/**
 * Get state transition configuration from database settings.
 * Converts hours to milliseconds for internal use.
 *
 * @returns State transition configuration for cooldown/retry logic
 */
export async function getStateTransitionConfig(): Promise<RuntimeStateTransitionConfig> {
	const config = await getSearchConfig();
	return {
		MAX_ATTEMPTS: config.retryConfig.maxAttempts,
		// Convert hours to milliseconds for internal use
		COOLDOWN_BASE_DELAY: config.cooldownConfig.baseDelayHours * 3600000,
		COOLDOWN_MAX_DELAY: config.cooldownConfig.maxDelayHours * 3600000,
		COOLDOWN_MULTIPLIER: config.cooldownConfig.multiplier,
		COOLDOWN_JITTER: config.cooldownConfig.jitter
	};
}
