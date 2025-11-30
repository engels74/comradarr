/**
 * Queue service configuration constants.
 *
 * Defines default priority weights and constants used for
 * priority score calculation.
 *
 * @module services/queue/config
 * @requirements 5.1
 */

import type { PriorityWeights } from './types';

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
