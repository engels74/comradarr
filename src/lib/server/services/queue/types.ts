/**
 * Type definitions for the queue service.
 *
 * The queue service handles priority calculation and queue management for
 * search requests. Priority scores determine the order in which searches
 * are dispatched to *arr applications.
 *
 * @module services/queue/types
 * @requirements 5.1
 */

/**
 * Search types supported by the system.
 *
 * - `gap`: Missing content (hasFile=false)
 * - `upgrade`: Content below quality cutoff (qualityCutoffNotMet=true)
 */
export type SearchType = 'gap' | 'upgrade';

/**
 * Content types supported by the system.
 *
 * - `episode`: TV series episodes (Sonarr/Whisparr)
 * - `movie`: Movies (Radarr)
 */
export type ContentType = 'episode' | 'movie';

/**
 * Configurable weights for priority calculation.
 *
 * All weights are multipliers that scale the contribution of each factor.
 * Higher weight = greater influence on final score.
 *
 * @example
 * ```typescript
 * const customWeights: PriorityWeights = {
 *   contentAge: 40,      // Prioritize newer content more
 *   missingDuration: 20, // Less emphasis on how long it's been missing
 *   userPriority: 50,    // Strong user override influence
 *   failurePenalty: 15,  // Moderate penalty per failure
 *   gapBonus: 25         // Prioritize gaps over upgrades
 * };
 * ```
 */
export interface PriorityWeights {
	/**
	 * Weight for content age factor (0-100).
	 * Newer content scores higher. Applied to normalized age score.
	 * @default 30
	 */
	contentAge: number;

	/**
	 * Weight for missing duration factor (0-100).
	 * Items missing longer score higher. Applied to normalized duration score.
	 * @default 25
	 */
	missingDuration: number;

	/**
	 * Weight for user priority override (0-100).
	 * Manual priority adjustments. Applied to user-set priority value.
	 * @default 40
	 */
	userPriority: number;

	/**
	 * Penalty points per failed search attempt.
	 * More failures = lower score. Applied as negative factor.
	 * @default 10
	 */
	failurePenalty: number;

	/**
	 * Bonus points for gap searches over upgrade searches.
	 * Missing content is typically more urgent than upgrades.
	 * @default 20
	 */
	gapBonus: number;
}

/**
 * Input data required to calculate priority for a queue item.
 *
 * @requirements 5.1
 */
export interface PriorityInput {
	/**
	 * Type of search (gap or upgrade).
	 * Gaps receive a bonus over upgrades by default.
	 */
	searchType: SearchType;

	/**
	 * Content release/air date (null if unknown).
	 * For episodes: airDate from the episode record.
	 * For movies: year converted to January 1st of that year.
	 */
	contentDate: Date | null;

	/**
	 * When the item was first discovered as missing/upgradeable.
	 * Typically the createdAt timestamp of the search registry entry.
	 */
	discoveredAt: Date;

	/**
	 * User-specified priority override (-100 to 100, 0 = neutral).
	 * Positive values increase priority, negative values decrease it.
	 * @default 0
	 */
	userPriorityOverride: number;

	/**
	 * Number of failed search attempts.
	 * Each failure reduces priority to deprioritize hard-to-find content.
	 */
	attemptCount: number;
}

/**
 * Detailed breakdown of priority score components.
 *
 * Useful for debugging and understanding score composition.
 */
export interface PriorityBreakdown {
	/** Weighted content age contribution (higher = newer content) */
	contentAgeScore: number;

	/** Weighted missing duration contribution (higher = longer missing) */
	missingDurationScore: number;

	/** Weighted user priority contribution */
	userPriorityScore: number;

	/** Total failure penalty applied (negative value) */
	failurePenalty: number;

	/** Search type bonus (gapBonus for gaps, 0 for upgrades) */
	searchTypeBonus: number;
}

/**
 * Result of priority calculation.
 *
 * @requirements 5.1
 */
export interface PriorityResult {
	/**
	 * Final calculated priority score (integer, higher = more urgent).
	 * The score is deterministic - same inputs always produce same output.
	 */
	score: number;

	/**
	 * Breakdown of score components for debugging/display.
	 * All component values contribute to the final score.
	 */
	breakdown: PriorityBreakdown;
}

// =============================================================================
// Queue Service Types (Requirement 5.2)
// =============================================================================

/**
 * A single item in the request queue with joined data from search registry.
 *
 * @requirements 5.2
 */
export interface QueueItem {
	/** Request queue row ID */
	id: number;

	/** Reference to the search registry entry */
	searchRegistryId: number;

	/** Connector this item belongs to */
	connectorId: number;

	/** Type of content (episode or movie) */
	contentType: ContentType;

	/** Reference to the content (episodes.id or movies.id) */
	contentId: number;

	/** Type of search (gap or upgrade) */
	searchType: SearchType;

	/** Calculated priority score (higher = more urgent) */
	priority: number;

	/** When this item was scheduled for processing */
	scheduledAt: Date;
}

/**
 * Result of an enqueue operation.
 *
 * @requirements 5.2
 */
export interface EnqueueResult {
	/** Whether the operation completed successfully */
	success: boolean;

	/** Connector ID the items were enqueued for */
	connectorId: number;

	/** Number of items successfully enqueued */
	itemsEnqueued: number;

	/** Number of items skipped (already queued or not eligible) */
	itemsSkipped: number;

	/** Duration of the operation in milliseconds */
	durationMs: number;

	/** Error message if success is false */
	error?: string;
}

/**
 * Result of a dequeue operation.
 *
 * @requirements 5.2
 */
export interface DequeueResult {
	/** Whether the operation completed successfully */
	success: boolean;

	/** Connector ID the items were dequeued from */
	connectorId: number;

	/** Items dequeued, in priority order (highest priority first) */
	items: QueueItem[];

	/** Duration of the operation in milliseconds */
	durationMs: number;

	/** Error message if success is false */
	error?: string;
}

/**
 * Result of a queue control operation (pause/resume/clear).
 *
 * @requirements 5.2
 */
export interface QueueControlResult {
	/** Whether the operation completed successfully */
	success: boolean;

	/** Connector ID affected (null for global operations) */
	connectorId: number | null;

	/** Number of items affected by the operation */
	itemsAffected: number;

	/** Duration of the operation in milliseconds */
	durationMs: number;

	/** Error message if success is false */
	error?: string;
}

/**
 * Queue status information for a connector.
 *
 * @requirements 5.2
 */
export interface QueueStatus {
	/** Connector ID */
	connectorId: number;

	/** Whether queue processing is paused */
	isPaused: boolean;

	/** Number of items currently in the queue */
	queueDepth: number;

	/** Timestamp of the next scheduled item (null if queue is empty) */
	nextScheduledAt: Date | null;
}

/**
 * Options for the enqueue operation.
 */
export interface EnqueueOptions {
	/** Batch size for database operations (default: 1000) */
	batchSize?: number;

	/** When to schedule items for processing (default: now) */
	scheduledAt?: Date;
}

/**
 * Options for the dequeue operation.
 */
export interface DequeueOptions {
	/** Maximum number of items to dequeue (default: 10, max: 100) */
	limit?: number;

	/** Only dequeue items scheduled at or before this time (default: now) */
	scheduledBefore?: Date;
}

// =============================================================================
// State Transition Types (Requirement 5.5, 5.6)
// =============================================================================

/**
 * Valid states for a search registry entry.
 *
 * State machine flow:
 * - pending: Discovered but not yet queued for search
 * - queued: Added to request queue, waiting for dispatch
 * - searching: Search command sent to *arr application
 * - cooldown: Failed search, waiting for retry eligibility
 * - exhausted: Max attempts reached, no more automatic retries
 *
 * @requirements 5.5, 5.6
 */
export type SearchState = 'pending' | 'queued' | 'searching' | 'cooldown' | 'exhausted';

/**
 * Categories of search failures.
 *
 * Used to track and report on failure reasons.
 *
 * - `no_results`: Search completed but found no matching releases
 * - `network_error`: Connection or DNS failure
 * - `rate_limited`: HTTP 429 from indexer or *arr application
 * - `server_error`: HTTP 5xx from *arr application
 * - `timeout`: Request timed out
 *
 * @requirements 5.5
 */
export type FailureCategory =
	| 'no_results'
	| 'network_error'
	| 'rate_limited'
	| 'server_error'
	| 'timeout';

/**
 * Input for marking a search as failed.
 *
 * @requirements 5.5
 */
export interface MarkSearchFailedInput {
	/** ID of the search registry entry */
	searchRegistryId: number;

	/** Category of the failure */
	failureCategory: FailureCategory;
}

/**
 * Result of a state transition operation.
 *
 * @requirements 5.5, 5.6
 */
export interface StateTransitionResult {
	/** Whether the operation completed successfully */
	success: boolean;

	/** ID of the search registry entry that was transitioned */
	searchRegistryId: number;

	/** State before the transition */
	previousState: SearchState;

	/** State after the transition */
	newState: SearchState;

	/** Current attempt count after transition */
	attemptCount?: number;

	/** Next eligible time for retry (for cooldown state) */
	nextEligible?: Date;

	/** Error message if success is false */
	error?: string;
}

/**
 * Result of re-enqueue operation for cooldown items.
 *
 * @requirements 5.5
 */
export interface ReenqueueCooldownResult {
	/** Whether the operation completed successfully */
	success: boolean;

	/** Connector ID if filtered (undefined for all connectors) */
	connectorId?: number;

	/** Number of items transitioned from cooldown to pending */
	itemsReenqueued: number;

	/** Number of items still in cooldown (not yet eligible) */
	itemsSkipped: number;

	/** Duration of the operation in milliseconds */
	durationMs: number;

	/** Error message if success is false */
	error?: string;
}
