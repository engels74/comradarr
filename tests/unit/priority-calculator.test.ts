/**
 * Unit tests for priority calculation.
 *
 * Tests cover:
 * - calculatePriority() with various inputs
 * - Content age scoring (newer = higher)
 * - Missing duration scoring (longer = higher)
 * - User priority override
 * - Failure penalty
 * - Search type bonus (gap vs upgrade)
 * - comparePriority() sorting
 * - Edge cases and boundary conditions
 *

 */

import { describe, it, expect } from 'vitest';
// Import directly from specific files to avoid loading database-dependent queue-service.ts
import {
	calculatePriority,
	comparePriority
} from '../../src/lib/server/services/queue/priority-calculator';
import {
	DEFAULT_PRIORITY_WEIGHTS,
	PRIORITY_CONSTANTS
} from '../../src/lib/server/services/queue/config';
import type { PriorityInput, PriorityWeights } from '../../src/lib/server/services/queue/types';

/**
 * Helper to create a Date representing N days ago.
 */
function daysAgo(days: number, from: Date = new Date()): Date {
	return new Date(from.getTime() - days * 24 * 60 * 60 * 1000);
}

/**
 * Helper to create a base priority input with sensible defaults.
 */
function createInput(overrides: Partial<PriorityInput> = {}): PriorityInput {
	return {
		searchType: 'gap',
		contentDate: new Date('2024-06-01'),
		discoveredAt: new Date('2024-06-15'),
		userPriorityOverride: 0,
		attemptCount: 0,
		...overrides
	};
}

describe('calculatePriority', () => {
	// Fixed reference date for deterministic tests
	const now = new Date('2024-07-01T12:00:00Z');

	describe('content age factor', () => {
		it('should give newer content higher priority', () => {
			const newerInput = createInput({
				contentDate: daysAgo(7, now) // 7 days old
			});
			const olderInput = createInput({
				contentDate: daysAgo(365, now) // 1 year old
			});

			const newerResult = calculatePriority(newerInput, DEFAULT_PRIORITY_WEIGHTS, now);
			const olderResult = calculatePriority(olderInput, DEFAULT_PRIORITY_WEIGHTS, now);

			expect(newerResult.score).toBeGreaterThan(olderResult.score);
			expect(newerResult.breakdown.contentAgeScore).toBeGreaterThan(
				olderResult.breakdown.contentAgeScore
			);
		});

		it('should cap content age at maximum threshold', () => {
			const veryOldInput = createInput({
				contentDate: daysAgo(5000, now) // ~14 years old
			});
			const maxAgeInput = createInput({
				contentDate: daysAgo(PRIORITY_CONSTANTS.MAX_CONTENT_AGE_DAYS, now) // 10 years
			});

			const veryOldResult = calculatePriority(veryOldInput, DEFAULT_PRIORITY_WEIGHTS, now);
			const maxAgeResult = calculatePriority(maxAgeInput, DEFAULT_PRIORITY_WEIGHTS, now);

			// Both should have the same minimum age score
			expect(veryOldResult.breakdown.contentAgeScore).toBeCloseTo(
				maxAgeResult.breakdown.contentAgeScore,
				1
			);
		});

		it('should handle null content date with neutral score', () => {
			const nullDateInput = createInput({
				contentDate: null
			});

			const result = calculatePriority(nullDateInput, DEFAULT_PRIORITY_WEIGHTS, now);

			// Neutral score is 50 (half of FACTOR_SCALE)
			const expectedRaw = PRIORITY_CONSTANTS.FACTOR_SCALE * 0.5;
			const expectedWeighted =
				expectedRaw * (DEFAULT_PRIORITY_WEIGHTS.contentAge / PRIORITY_CONSTANTS.WEIGHT_SCALE);
			expect(result.breakdown.contentAgeScore).toBeCloseTo(expectedWeighted, 1);
		});

		it('should give maximum score for content released today', () => {
			const todayInput = createInput({
				contentDate: now
			});

			const result = calculatePriority(todayInput, DEFAULT_PRIORITY_WEIGHTS, now);

			// Maximum raw score is FACTOR_SCALE (100)
			const expectedMaxRaw = PRIORITY_CONSTANTS.FACTOR_SCALE;
			const expectedMaxWeighted =
				expectedMaxRaw * (DEFAULT_PRIORITY_WEIGHTS.contentAge / PRIORITY_CONSTANTS.WEIGHT_SCALE);
			expect(result.breakdown.contentAgeScore).toBeCloseTo(expectedMaxWeighted, 1);
		});
	});

	describe('missing duration factor', () => {
		it('should give items missing longer higher priority', () => {
			const longMissingInput = createInput({
				discoveredAt: daysAgo(100, now) // Missing for 100 days
			});
			const shortMissingInput = createInput({
				discoveredAt: daysAgo(7, now) // Missing for 7 days
			});

			const longResult = calculatePriority(longMissingInput, DEFAULT_PRIORITY_WEIGHTS, now);
			const shortResult = calculatePriority(shortMissingInput, DEFAULT_PRIORITY_WEIGHTS, now);

			expect(longResult.score).toBeGreaterThan(shortResult.score);
			expect(longResult.breakdown.missingDurationScore).toBeGreaterThan(
				shortResult.breakdown.missingDurationScore
			);
		});

		it('should cap missing duration at maximum threshold', () => {
			const veryLongInput = createInput({
				discoveredAt: daysAgo(500, now) // ~1.4 years
			});
			const maxDurationInput = createInput({
				discoveredAt: daysAgo(PRIORITY_CONSTANTS.MAX_MISSING_DURATION_DAYS, now) // 1 year
			});

			const veryLongResult = calculatePriority(veryLongInput, DEFAULT_PRIORITY_WEIGHTS, now);
			const maxDurationResult = calculatePriority(maxDurationInput, DEFAULT_PRIORITY_WEIGHTS, now);

			// Both should have the same maximum duration score
			expect(veryLongResult.breakdown.missingDurationScore).toBeCloseTo(
				maxDurationResult.breakdown.missingDurationScore,
				1
			);
		});

		it('should give minimum score for items just discovered', () => {
			const justDiscoveredInput = createInput({
				discoveredAt: now
			});

			const result = calculatePriority(justDiscoveredInput, DEFAULT_PRIORITY_WEIGHTS, now);

			// Minimum raw score is 0
			expect(result.breakdown.missingDurationScore).toBeCloseTo(0, 1);
		});
	});

	describe('user priority override', () => {
		it('should increase priority for positive override', () => {
			const normalInput = createInput({
				userPriorityOverride: 0
			});
			const boostedInput = createInput({
				userPriorityOverride: 50
			});

			const normalResult = calculatePriority(normalInput, DEFAULT_PRIORITY_WEIGHTS, now);
			const boostedResult = calculatePriority(boostedInput, DEFAULT_PRIORITY_WEIGHTS, now);

			expect(boostedResult.score).toBeGreaterThan(normalResult.score);
			expect(boostedResult.breakdown.userPriorityScore).toBeGreaterThan(
				normalResult.breakdown.userPriorityScore
			);
		});

		it('should decrease priority for negative override', () => {
			const normalInput = createInput({
				userPriorityOverride: 0
			});
			const demotedInput = createInput({
				userPriorityOverride: -50
			});

			const normalResult = calculatePriority(normalInput, DEFAULT_PRIORITY_WEIGHTS, now);
			const demotedResult = calculatePriority(demotedInput, DEFAULT_PRIORITY_WEIGHTS, now);

			expect(demotedResult.score).toBeLessThan(normalResult.score);
			expect(demotedResult.breakdown.userPriorityScore).toBeLessThan(
				normalResult.breakdown.userPriorityScore
			);
		});

		it('should have maximum effect at +100 override', () => {
			const maxBoostInput = createInput({
				userPriorityOverride: 100
			});

			const result = calculatePriority(maxBoostInput, DEFAULT_PRIORITY_WEIGHTS, now);

			// 100 * (40 / 100) = 40
			expect(result.breakdown.userPriorityScore).toBeCloseTo(40, 1);
		});

		it('should have maximum negative effect at -100 override', () => {
			const maxDemoteInput = createInput({
				userPriorityOverride: -100
			});

			const result = calculatePriority(maxDemoteInput, DEFAULT_PRIORITY_WEIGHTS, now);

			// -100 * (40 / 100) = -40
			expect(result.breakdown.userPriorityScore).toBeCloseTo(-40, 1);
		});
	});

	describe('failure penalty', () => {
		it('should reduce priority for each failure', () => {
			const noFailuresInput = createInput({
				attemptCount: 0
			});
			const someFailuresInput = createInput({
				attemptCount: 3
			});

			const noFailuresResult = calculatePriority(noFailuresInput, DEFAULT_PRIORITY_WEIGHTS, now);
			const someFailuresResult = calculatePriority(someFailuresInput, DEFAULT_PRIORITY_WEIGHTS, now);

			expect(noFailuresResult.score).toBeGreaterThan(someFailuresResult.score);
			expect(noFailuresResult.breakdown.failurePenalty).toBeLessThan(
				someFailuresResult.breakdown.failurePenalty
			);
		});

		it('should apply linear penalty per failure', () => {
			const threeFailuresInput = createInput({
				attemptCount: 3
			});

			const result = calculatePriority(threeFailuresInput, DEFAULT_PRIORITY_WEIGHTS, now);

			// 3 * 10 = 30 penalty
			expect(result.breakdown.failurePenalty).toBe(30);
		});

		it('should have no penalty for zero failures', () => {
			const noFailuresInput = createInput({
				attemptCount: 0
			});

			const result = calculatePriority(noFailuresInput, DEFAULT_PRIORITY_WEIGHTS, now);

			expect(result.breakdown.failurePenalty).toBe(0);
		});
	});

	describe('search type bonus', () => {
		it('should give gaps higher priority than upgrades', () => {
			const gapInput = createInput({
				searchType: 'gap'
			});
			const upgradeInput = createInput({
				searchType: 'upgrade'
			});

			const gapResult = calculatePriority(gapInput, DEFAULT_PRIORITY_WEIGHTS, now);
			const upgradeResult = calculatePriority(upgradeInput, DEFAULT_PRIORITY_WEIGHTS, now);

			expect(gapResult.score).toBeGreaterThan(upgradeResult.score);
			expect(gapResult.breakdown.searchTypeBonus).toBe(DEFAULT_PRIORITY_WEIGHTS.gapBonus);
			expect(upgradeResult.breakdown.searchTypeBonus).toBe(0);
		});

		it('should apply full gapBonus for gap searches', () => {
			const gapInput = createInput({
				searchType: 'gap'
			});

			const result = calculatePriority(gapInput, DEFAULT_PRIORITY_WEIGHTS, now);

			expect(result.breakdown.searchTypeBonus).toBe(20); // Default gapBonus
		});

		it('should apply zero bonus for upgrade searches', () => {
			const upgradeInput = createInput({
				searchType: 'upgrade'
			});

			const result = calculatePriority(upgradeInput, DEFAULT_PRIORITY_WEIGHTS, now);

			expect(result.breakdown.searchTypeBonus).toBe(0);
		});
	});

	describe('custom weights', () => {
		it('should respect custom content age weight', () => {
			const input = createInput({
				contentDate: daysAgo(30, now)
			});

			const lowWeightConfig: PriorityWeights = { ...DEFAULT_PRIORITY_WEIGHTS, contentAge: 10 };
			const highWeightConfig: PriorityWeights = { ...DEFAULT_PRIORITY_WEIGHTS, contentAge: 50 };

			const lowResult = calculatePriority(input, lowWeightConfig, now);
			const highResult = calculatePriority(input, highWeightConfig, now);

			// Higher weight should amplify the score difference from base
			expect(highResult.breakdown.contentAgeScore).toBeGreaterThan(
				lowResult.breakdown.contentAgeScore
			);
		});

		it('should respect custom failure penalty', () => {
			const input = createInput({
				attemptCount: 5
			});

			const lowPenaltyConfig: PriorityWeights = { ...DEFAULT_PRIORITY_WEIGHTS, failurePenalty: 2 };
			const highPenaltyConfig: PriorityWeights = { ...DEFAULT_PRIORITY_WEIGHTS, failurePenalty: 20 };

			const lowResult = calculatePriority(input, lowPenaltyConfig, now);
			const highResult = calculatePriority(input, highPenaltyConfig, now);

			expect(lowResult.breakdown.failurePenalty).toBe(10); // 5 * 2
			expect(highResult.breakdown.failurePenalty).toBe(100); // 5 * 20
			expect(lowResult.score).toBeGreaterThan(highResult.score);
		});

		it('should allow zero weights to disable factors', () => {
			const input = createInput();

			const zeroAgeWeightConfig: PriorityWeights = { ...DEFAULT_PRIORITY_WEIGHTS, contentAge: 0 };

			const result = calculatePriority(input, zeroAgeWeightConfig, now);

			expect(result.breakdown.contentAgeScore).toBe(0);
		});
	});

	describe('determinism', () => {
		it('should produce identical results for identical inputs', () => {
			const input = createInput();

			const result1 = calculatePriority(input, DEFAULT_PRIORITY_WEIGHTS, now);
			const result2 = calculatePriority(input, DEFAULT_PRIORITY_WEIGHTS, now);

			expect(result1.score).toBe(result2.score);
			expect(result1.breakdown).toEqual(result2.breakdown);
		});
	});

	describe('score properties', () => {
		it('should produce integer scores', () => {
			const input = createInput();

			const result = calculatePriority(input, DEFAULT_PRIORITY_WEIGHTS, now);

			expect(Number.isInteger(result.score)).toBe(true);
		});

		it('should produce finite scores', () => {
			const input = createInput();

			const result = calculatePriority(input, DEFAULT_PRIORITY_WEIGHTS, now);

			expect(Number.isFinite(result.score)).toBe(true);
		});

		it('should produce scores around BASE_SCORE with neutral inputs', () => {
			const neutralInput = createInput({
				contentDate: null, // Neutral age score
				discoveredAt: now, // Zero duration score
				userPriorityOverride: 0,
				attemptCount: 0,
				searchType: 'upgrade' // No gap bonus
			});

			const result = calculatePriority(neutralInput, DEFAULT_PRIORITY_WEIGHTS, now);

			// Should be close to BASE_SCORE + neutral age contribution
			// BASE_SCORE (1000) + 50 * 0.3 = 1015
			expect(result.score).toBeGreaterThan(PRIORITY_CONSTANTS.BASE_SCORE - 100);
			expect(result.score).toBeLessThan(PRIORITY_CONSTANTS.BASE_SCORE + 100);
		});
	});

	describe('edge cases', () => {
		it('should handle future content date', () => {
			const futureInput = createInput({
				contentDate: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) // 7 days in future
			});

			const result = calculatePriority(futureInput, DEFAULT_PRIORITY_WEIGHTS, now);

			// Future content should get maximum age score (age = 0)
			expect(result.breakdown.contentAgeScore).toBeCloseTo(
				PRIORITY_CONSTANTS.FACTOR_SCALE * (DEFAULT_PRIORITY_WEIGHTS.contentAge / 100),
				1
			);
			expect(Number.isFinite(result.score)).toBe(true);
		});

		it('should handle discoveredAt in the future', () => {
			const futureDiscoveryInput = createInput({
				discoveredAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) // 7 days in future
			});

			const result = calculatePriority(futureDiscoveryInput, DEFAULT_PRIORITY_WEIGHTS, now);

			// Duration should be clamped to 0
			expect(result.breakdown.missingDurationScore).toBe(0);
			expect(Number.isFinite(result.score)).toBe(true);
		});

		it('should handle very high attempt counts', () => {
			const highFailuresInput = createInput({
				attemptCount: 1000
			});

			const result = calculatePriority(highFailuresInput, DEFAULT_PRIORITY_WEIGHTS, now);

			expect(Number.isFinite(result.score)).toBe(true);
			expect(result.breakdown.failurePenalty).toBe(10000); // 1000 * 10
		});
	});
});

describe('comparePriority', () => {
	const now = new Date('2024-07-01T12:00:00Z');

	it('should sort higher priority first', () => {
		const highPriorityInput = createInput({
			contentDate: daysAgo(7, now),
			attemptCount: 0
		});
		const lowPriorityInput = createInput({
			contentDate: daysAgo(365, now),
			attemptCount: 5
		});

		const highResult = calculatePriority(highPriorityInput, DEFAULT_PRIORITY_WEIGHTS, now);
		const lowResult = calculatePriority(lowPriorityInput, DEFAULT_PRIORITY_WEIGHTS, now);

		const comparison = comparePriority(highResult, lowResult);

		// Negative value means highResult comes first
		expect(comparison).toBeLessThan(0);
	});

	it('should return 0 for equal priorities', () => {
		const input = createInput();
		const result1 = calculatePriority(input, DEFAULT_PRIORITY_WEIGHTS, now);
		const result2 = calculatePriority(input, DEFAULT_PRIORITY_WEIGHTS, now);

		expect(comparePriority(result1, result2)).toBe(0);
	});

	it('should correctly sort an array of priorities', () => {
		const inputs = [
			createInput({ attemptCount: 5 }),
			createInput({ attemptCount: 0 }),
			createInput({ attemptCount: 2 }),
			createInput({ attemptCount: 10 })
		];

		const results = inputs.map((input) => calculatePriority(input, DEFAULT_PRIORITY_WEIGHTS, now));
		results.sort(comparePriority);

		// Should be sorted by score descending (fewer failures first)
		for (let i = 0; i < results.length - 1; i++) {
			expect(results[i]!.score).toBeGreaterThanOrEqual(results[i + 1]!.score);
		}
	});
});

describe('DEFAULT_PRIORITY_WEIGHTS', () => {
	it('should have expected default values', () => {
		expect(DEFAULT_PRIORITY_WEIGHTS.contentAge).toBe(30);
		expect(DEFAULT_PRIORITY_WEIGHTS.missingDuration).toBe(25);
		expect(DEFAULT_PRIORITY_WEIGHTS.userPriority).toBe(40);
		expect(DEFAULT_PRIORITY_WEIGHTS.failurePenalty).toBe(10);
		expect(DEFAULT_PRIORITY_WEIGHTS.gapBonus).toBe(20);
	});
});

describe('PRIORITY_CONSTANTS', () => {
	it('should have expected constant values', () => {
		expect(PRIORITY_CONSTANTS.MAX_CONTENT_AGE_DAYS).toBe(3650);
		expect(PRIORITY_CONSTANTS.MAX_MISSING_DURATION_DAYS).toBe(365);
		expect(PRIORITY_CONSTANTS.BASE_SCORE).toBe(1000);
		expect(PRIORITY_CONSTANTS.WEIGHT_SCALE).toBe(100);
		expect(PRIORITY_CONSTANTS.FACTOR_SCALE).toBe(100);
	});
});
