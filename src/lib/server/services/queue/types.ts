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
