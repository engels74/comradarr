/**
 * Priority calculator for queue items.
 *
 * Calculates priority scores based on multiple factors:
 * - Content age (newer content scores higher)
 * - Missing duration (longer missing scores higher)
 * - User priority override (manual adjustments)
 * - Failure penalty (fewer failures scores higher)
 * - Search type (gaps prioritized over upgrades)
 *
 * Properties guaranteed:
 * - Deterministic: Same inputs always produce same output
 * - Newer content >= older content (all else equal)
 * - Fewer failures >= more failures (all else equal)
 * - Output is always a finite integer
 *
 * @module services/queue/priority-calculator
 * @requirements 5.1
 */

import type { PriorityInput, PriorityResult, PriorityWeights, PriorityBreakdown } from './types';
import { DEFAULT_PRIORITY_WEIGHTS, PRIORITY_CONSTANTS } from './config';

/**
 * Calculate the priority score for a queue item.
 *
 * The scoring formula is:
 * ```
 * score = BASE_SCORE
 *       + contentAgeScore * (contentAgeWeight / WEIGHT_SCALE)
 *       + missingDurationScore * (missingDurationWeight / WEIGHT_SCALE)
 *       + userPriorityOverride * (userPriorityWeight / WEIGHT_SCALE)
 *       - (attemptCount * failurePenalty)
 *       + (searchType === 'gap' ? gapBonus : 0)
 * ```
 *
 * @param input - Priority calculation input data
 * @param weights - Configurable priority weights (defaults used if not provided)
 * @param now - Current time for age calculations (defaults to current time)
 * @returns Priority result with score and breakdown
 *
 * @example
 * ```typescript
 * const result = calculatePriority({
 *   searchType: 'gap',
 *   contentDate: new Date('2024-01-15'),
 *   discoveredAt: new Date('2024-06-01'),
 *   userPriorityOverride: 0,
 *   attemptCount: 0
 * });
 * console.log(`Priority: ${result.score}`);
 * ```
 *
 * @requirements 5.1
 */
export function calculatePriority(
	input: PriorityInput,
	weights: PriorityWeights = DEFAULT_PRIORITY_WEIGHTS,
	now: Date = new Date()
): PriorityResult {
	// Calculate individual factor scores
	const contentAgeRaw = calculateContentAgeScore(input.contentDate, now);
	const missingDurationRaw = calculateMissingDurationScore(input.discoveredAt, now);
	const searchTypeBonus = input.searchType === 'gap' ? weights.gapBonus : 0;

	// Apply weights (normalized by WEIGHT_SCALE)
	const contentAgeScore = contentAgeRaw * (weights.contentAge / PRIORITY_CONSTANTS.WEIGHT_SCALE);
	const missingDurationScore =
		missingDurationRaw * (weights.missingDuration / PRIORITY_CONSTANTS.WEIGHT_SCALE);
	const userPriorityScore =
		input.userPriorityOverride * (weights.userPriority / PRIORITY_CONSTANTS.WEIGHT_SCALE);
	const failurePenalty = input.attemptCount * weights.failurePenalty;

	// Calculate final score
	const rawScore =
		PRIORITY_CONSTANTS.BASE_SCORE +
		contentAgeScore +
		missingDurationScore +
		userPriorityScore -
		failurePenalty +
		searchTypeBonus;

	// Round to integer for deterministic results
	const score = Math.round(rawScore);

	const breakdown: PriorityBreakdown = {
		contentAgeScore,
		missingDurationScore,
		userPriorityScore,
		failurePenalty,
		searchTypeBonus
	};

	return { score, breakdown };
}

/**
 * Calculate content age score (0 to FACTOR_SCALE).
 *
 * Newer content receives higher scores. The score decreases linearly
 * with age up to MAX_CONTENT_AGE_DAYS, after which it remains at 0.
 *
 * @param contentDate - Content release/air date (null returns 0)
 * @param now - Current time for age calculation
 * @returns Score from 0 to FACTOR_SCALE (100)
 */
function calculateContentAgeScore(contentDate: Date | null, now: Date): number {
	if (contentDate === null) {
		// Unknown date gets neutral score (middle of range)
		return PRIORITY_CONSTANTS.FACTOR_SCALE * 0.5;
	}

	const ageDays = Math.max(0, (now.getTime() - contentDate.getTime()) / (1000 * 60 * 60 * 24));
	const normalizedAge = Math.min(ageDays / PRIORITY_CONSTANTS.MAX_CONTENT_AGE_DAYS, 1);

	// Invert: newer content (smaller age) gets higher score
	return PRIORITY_CONSTANTS.FACTOR_SCALE * (1 - normalizedAge);
}

/**
 * Calculate missing duration score (0 to FACTOR_SCALE).
 *
 * Items missing longer receive higher scores. The score increases linearly
 * with duration up to MAX_MISSING_DURATION_DAYS, after which it caps at max.
 *
 * @param discoveredAt - When item was first found missing
 * @param now - Current time for duration calculation
 * @returns Score from 0 to FACTOR_SCALE (100)
 */
function calculateMissingDurationScore(discoveredAt: Date, now: Date): number {
	const durationDays = Math.max(
		0,
		(now.getTime() - discoveredAt.getTime()) / (1000 * 60 * 60 * 24)
	);
	const normalizedDuration = Math.min(
		durationDays / PRIORITY_CONSTANTS.MAX_MISSING_DURATION_DAYS,
		1
	);

	// Direct: longer missing gets higher score
	return PRIORITY_CONSTANTS.FACTOR_SCALE * normalizedDuration;
}

/**
 * Compare two priority results for sorting.
 *
 * Returns a negative value if `a` should come before `b` (higher priority),
 * positive if `b` should come before `a`, or 0 if equal.
 *
 * @param a - First priority result
 * @param b - Second priority result
 * @returns Comparison result for Array.sort()
 *
 * @example
 * ```typescript
 * const items = [...];
 * const results = items.map(i => ({ item: i, priority: calculatePriority(i) }));
 * results.sort((a, b) => comparePriority(a.priority, b.priority));
 * // results[0] has highest priority
 * ```
 */
export function comparePriority(a: PriorityResult, b: PriorityResult): number {
	// Higher score = higher priority = comes first
	return b.score - a.score;
}
