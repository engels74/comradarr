/**
 * Property-based tests for priority calculation.
 *
 * Verifies that priority calculation is deterministic and follows expected ordering:
 * newer content > older content, fewer failures > more failures.
 */

import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PRIORITY_WEIGHTS } from '../../src/lib/server/services/queue/config';
// Import directly from specific files to avoid loading database-dependent queue-service.ts
import {
	calculatePriority,
	comparePriority
} from '../../src/lib/server/services/queue/priority-calculator';
import type { PriorityInput, PriorityWeights } from '../../src/lib/server/services/queue/types';

/**
 * Arbitrary generator for SearchType.
 */
const searchTypeArbitrary = fc.constantFrom('gap', 'upgrade') as fc.Arbitrary<'gap' | 'upgrade'>;

/**
 * Helper to create a valid date arbitrary that filters out invalid dates.
 * Uses timestamp to avoid fc.date() edge cases.
 */
const validDateArbitrary = (min: Date, max: Date): fc.Arbitrary<Date> =>
	fc
		.integer({ min: min.getTime(), max: max.getTime() })
		.map((ts) => new Date(ts))
		.filter((d) => !Number.isNaN(d.getTime()));

/**
 * Arbitrary generator for dates within a reasonable range.
 * Range: 2010-01-01 to 2030-12-31
 */
const dateArbitrary = validDateArbitrary(new Date('2010-01-01'), new Date('2030-12-31'));

/**
 * Arbitrary generator for nullable dates.
 */
const nullableDateArbitrary = fc.option(dateArbitrary, { nil: null });

/**
 * Arbitrary generator for user priority override (-100 to 100).
 */
const userPriorityArbitrary = fc.integer({ min: -100, max: 100 });

/**
 * Arbitrary generator for attempt count (0 to 100).
 */
const attemptCountArbitrary = fc.integer({ min: 0, max: 100 });

/**
 * Arbitrary generator for PriorityInput.
 */
const priorityInputArbitrary: fc.Arbitrary<PriorityInput> = fc.record({
	searchType: searchTypeArbitrary,
	contentDate: nullableDateArbitrary,
	discoveredAt: dateArbitrary,
	userPriorityOverride: userPriorityArbitrary,
	attemptCount: attemptCountArbitrary
});

/**
 * Arbitrary generator for PriorityWeights with valid ranges.
 */
const priorityWeightsArbitrary: fc.Arbitrary<PriorityWeights> = fc.record({
	contentAge: fc.integer({ min: 0, max: 100 }),
	missingDuration: fc.integer({ min: 0, max: 100 }),
	userPriority: fc.integer({ min: 0, max: 100 }),
	failurePenalty: fc.integer({ min: 0, max: 50 }),
	gapBonus: fc.integer({ min: 0, max: 100 })
});

/**
 * Arbitrary generator for a reference date ("now").
 */
const nowArbitrary = validDateArbitrary(new Date('2020-01-01'), new Date('2030-12-31'));

describe('Priority Calculation Properties', () => {
	describe('Property: Determinism', () => {
		it('same inputs always produce same output', () => {
			fc.assert(
				fc.property(
					priorityInputArbitrary,
					priorityWeightsArbitrary,
					nowArbitrary,
					(input, weights, now) => {
						const result1 = calculatePriority(input, weights, now);
						const result2 = calculatePriority(input, weights, now);

						expect(result1.score).toBe(result2.score);
						expect(result1.breakdown).toEqual(result2.breakdown);
					}
				),
				{ numRuns: 100 }
			);
		});
	});

	describe('Property: Content Age Ordering', () => {
		it('newer content scores >= older content (all else equal)', () => {
			fc.assert(
				fc.property(
					searchTypeArbitrary,
					dateArbitrary,
					userPriorityArbitrary,
					attemptCountArbitrary,
					dateArbitrary, // newer date
					dateArbitrary, // older date
					nowArbitrary,
					(searchType, discoveredAt, userPriority, attemptCount, date1, date2, now) => {
						// Ensure date1 and date2 are different
						if (date1.getTime() === date2.getTime()) return;

						const newerDate = date1 > date2 ? date1 : date2;
						const olderDate = date1 > date2 ? date2 : date1;

						const newerInput: PriorityInput = {
							searchType,
							contentDate: newerDate,
							discoveredAt,
							userPriorityOverride: userPriority,
							attemptCount
						};
						const olderInput: PriorityInput = {
							searchType,
							contentDate: olderDate,
							discoveredAt,
							userPriorityOverride: userPriority,
							attemptCount
						};

						const newerResult = calculatePriority(newerInput, DEFAULT_PRIORITY_WEIGHTS, now);
						const olderResult = calculatePriority(olderInput, DEFAULT_PRIORITY_WEIGHTS, now);

						expect(newerResult.score).toBeGreaterThanOrEqual(olderResult.score);
					}
				),
				{ numRuns: 100 }
			);
		});
	});

	describe('Property: Failure Penalty Ordering', () => {
		it('fewer failures scores >= more failures (all else equal)', () => {
			fc.assert(
				fc.property(
					searchTypeArbitrary,
					nullableDateArbitrary,
					dateArbitrary,
					userPriorityArbitrary,
					attemptCountArbitrary,
					attemptCountArbitrary,
					nowArbitrary,
					(searchType, contentDate, discoveredAt, userPriority, failures1, failures2, now) => {
						const fewerFailures = Math.min(failures1, failures2);
						const moreFailures = Math.max(failures1, failures2);

						const fewerInput: PriorityInput = {
							searchType,
							contentDate,
							discoveredAt,
							userPriorityOverride: userPriority,
							attemptCount: fewerFailures
						};
						const moreInput: PriorityInput = {
							searchType,
							contentDate,
							discoveredAt,
							userPriorityOverride: userPriority,
							attemptCount: moreFailures
						};

						const fewerResult = calculatePriority(fewerInput, DEFAULT_PRIORITY_WEIGHTS, now);
						const moreResult = calculatePriority(moreInput, DEFAULT_PRIORITY_WEIGHTS, now);

						expect(fewerResult.score).toBeGreaterThanOrEqual(moreResult.score);
					}
				),
				{ numRuns: 100 }
			);
		});
	});

	describe('Property: Gap vs Upgrade Ordering', () => {
		it('gaps score >= upgrades (all else equal, with default weights)', () => {
			fc.assert(
				fc.property(
					nullableDateArbitrary,
					dateArbitrary,
					userPriorityArbitrary,
					attemptCountArbitrary,
					nowArbitrary,
					(contentDate, discoveredAt, userPriority, attemptCount, now) => {
						const gapInput: PriorityInput = {
							searchType: 'gap',
							contentDate,
							discoveredAt,
							userPriorityOverride: userPriority,
							attemptCount
						};
						const upgradeInput: PriorityInput = {
							searchType: 'upgrade',
							contentDate,
							discoveredAt,
							userPriorityOverride: userPriority,
							attemptCount
						};

						const gapResult = calculatePriority(gapInput, DEFAULT_PRIORITY_WEIGHTS, now);
						const upgradeResult = calculatePriority(upgradeInput, DEFAULT_PRIORITY_WEIGHTS, now);

						expect(gapResult.score).toBeGreaterThanOrEqual(upgradeResult.score);
					}
				),
				{ numRuns: 100 }
			);
		});
	});

	describe('Property: Score is Finite Integer', () => {
		it('score is always a finite integer', () => {
			fc.assert(
				fc.property(
					priorityInputArbitrary,
					priorityWeightsArbitrary,
					nowArbitrary,
					(input, weights, now) => {
						const result = calculatePriority(input, weights, now);

						expect(Number.isFinite(result.score)).toBe(true);
						expect(Number.isInteger(result.score)).toBe(true);
					}
				),
				{ numRuns: 100 }
			);
		});
	});

	describe('Property: Breakdown Components are Finite', () => {
		it('all breakdown values are finite numbers', () => {
			fc.assert(
				fc.property(
					priorityInputArbitrary,
					priorityWeightsArbitrary,
					nowArbitrary,
					(input, weights, now) => {
						const result = calculatePriority(input, weights, now);

						expect(Number.isFinite(result.breakdown.contentAgeScore)).toBe(true);
						expect(Number.isFinite(result.breakdown.missingDurationScore)).toBe(true);
						expect(Number.isFinite(result.breakdown.userPriorityScore)).toBe(true);
						expect(Number.isFinite(result.breakdown.failurePenalty)).toBe(true);
						expect(Number.isFinite(result.breakdown.searchTypeBonus)).toBe(true);
					}
				),
				{ numRuns: 100 }
			);
		});
	});

	describe('Property: Zero Weight Eliminates Factor', () => {
		it('zero contentAge weight eliminates content age contribution', () => {
			fc.assert(
				fc.property(priorityInputArbitrary, nowArbitrary, (input, now) => {
					const zeroWeightConfig: PriorityWeights = {
						...DEFAULT_PRIORITY_WEIGHTS,
						contentAge: 0
					};

					const result = calculatePriority(input, zeroWeightConfig, now);

					expect(result.breakdown.contentAgeScore).toBe(0);
				}),
				{ numRuns: 100 }
			);
		});

		it('zero missingDuration weight eliminates duration contribution', () => {
			fc.assert(
				fc.property(priorityInputArbitrary, nowArbitrary, (input, now) => {
					const zeroWeightConfig: PriorityWeights = {
						...DEFAULT_PRIORITY_WEIGHTS,
						missingDuration: 0
					};

					const result = calculatePriority(input, zeroWeightConfig, now);

					expect(result.breakdown.missingDurationScore).toBe(0);
				}),
				{ numRuns: 100 }
			);
		});

		it('zero userPriority weight eliminates user override contribution', () => {
			fc.assert(
				fc.property(priorityInputArbitrary, nowArbitrary, (input, now) => {
					const zeroWeightConfig: PriorityWeights = {
						...DEFAULT_PRIORITY_WEIGHTS,
						userPriority: 0
					};

					const result = calculatePriority(input, zeroWeightConfig, now);

					// Use Object.is-safe comparison (handles -0 vs 0)
					expect(Math.abs(result.breakdown.userPriorityScore)).toBe(0);
				}),
				{ numRuns: 100 }
			);
		});

		it('zero failurePenalty eliminates failure deduction', () => {
			fc.assert(
				fc.property(priorityInputArbitrary, nowArbitrary, (input, now) => {
					const zeroWeightConfig: PriorityWeights = {
						...DEFAULT_PRIORITY_WEIGHTS,
						failurePenalty: 0
					};

					const result = calculatePriority(input, zeroWeightConfig, now);

					expect(result.breakdown.failurePenalty).toBe(0);
				}),
				{ numRuns: 100 }
			);
		});

		it('zero gapBonus eliminates gap advantage', () => {
			fc.assert(
				fc.property(
					nullableDateArbitrary,
					dateArbitrary,
					userPriorityArbitrary,
					attemptCountArbitrary,
					nowArbitrary,
					(contentDate, discoveredAt, userPriority, attemptCount, now) => {
						const zeroWeightConfig: PriorityWeights = {
							...DEFAULT_PRIORITY_WEIGHTS,
							gapBonus: 0
						};

						const gapInput: PriorityInput = {
							searchType: 'gap',
							contentDate,
							discoveredAt,
							userPriorityOverride: userPriority,
							attemptCount
						};
						const upgradeInput: PriorityInput = {
							searchType: 'upgrade',
							contentDate,
							discoveredAt,
							userPriorityOverride: userPriority,
							attemptCount
						};

						const gapResult = calculatePriority(gapInput, zeroWeightConfig, now);
						const upgradeResult = calculatePriority(upgradeInput, zeroWeightConfig, now);

						// With zero gapBonus, gap and upgrade should have same score
						expect(gapResult.score).toBe(upgradeResult.score);
					}
				),
				{ numRuns: 100 }
			);
		});
	});

	describe('Property: User Priority Override Effect', () => {
		it('positive user override increases score (all else equal)', () => {
			fc.assert(
				fc.property(
					searchTypeArbitrary,
					nullableDateArbitrary,
					dateArbitrary,
					attemptCountArbitrary,
					// Use min: 3 to ensure the override produces at least 1 point difference
					// (3 * 0.4 = 1.2, which rounds to 1)
					fc.integer({ min: 3, max: 100 }),
					nowArbitrary,
					(searchType, contentDate, discoveredAt, attemptCount, positiveOverride, now) => {
						const neutralInput: PriorityInput = {
							searchType,
							contentDate,
							discoveredAt,
							userPriorityOverride: 0,
							attemptCount
						};
						const boostedInput: PriorityInput = {
							searchType,
							contentDate,
							discoveredAt,
							userPriorityOverride: positiveOverride,
							attemptCount
						};

						const neutralResult = calculatePriority(neutralInput, DEFAULT_PRIORITY_WEIGHTS, now);
						const boostedResult = calculatePriority(boostedInput, DEFAULT_PRIORITY_WEIGHTS, now);

						expect(boostedResult.score).toBeGreaterThan(neutralResult.score);
					}
				),
				{ numRuns: 100 }
			);
		});

		it('negative user override decreases score (all else equal)', () => {
			fc.assert(
				fc.property(
					searchTypeArbitrary,
					nullableDateArbitrary,
					dateArbitrary,
					attemptCountArbitrary,
					// Use max: -3 to ensure the override produces at least 1 point difference
					// (-3 * 0.4 = -1.2, which rounds to -1)
					fc.integer({ min: -100, max: -3 }),
					nowArbitrary,
					(searchType, contentDate, discoveredAt, attemptCount, negativeOverride, now) => {
						const neutralInput: PriorityInput = {
							searchType,
							contentDate,
							discoveredAt,
							userPriorityOverride: 0,
							attemptCount
						};
						const demotedInput: PriorityInput = {
							searchType,
							contentDate,
							discoveredAt,
							userPriorityOverride: negativeOverride,
							attemptCount
						};

						const neutralResult = calculatePriority(neutralInput, DEFAULT_PRIORITY_WEIGHTS, now);
						const demotedResult = calculatePriority(demotedInput, DEFAULT_PRIORITY_WEIGHTS, now);

						expect(demotedResult.score).toBeLessThan(neutralResult.score);
					}
				),
				{ numRuns: 100 }
			);
		});
	});

	describe('Property: Missing Duration Ordering', () => {
		it('longer missing duration scores >= shorter (all else equal)', () => {
			fc.assert(
				fc.property(
					searchTypeArbitrary,
					nullableDateArbitrary,
					userPriorityArbitrary,
					attemptCountArbitrary,
					dateArbitrary, // discoveredAt1
					dateArbitrary, // discoveredAt2
					nowArbitrary,
					(searchType, contentDate, userPriority, attemptCount, discovered1, discovered2, now) => {
						// Ensure discovered dates are different
						if (discovered1.getTime() === discovered2.getTime()) return;

						// Earlier discovered = longer missing
						const longerMissing = discovered1 < discovered2 ? discovered1 : discovered2;
						const shorterMissing = discovered1 < discovered2 ? discovered2 : discovered1;

						const longerInput: PriorityInput = {
							searchType,
							contentDate,
							discoveredAt: longerMissing,
							userPriorityOverride: userPriority,
							attemptCount
						};
						const shorterInput: PriorityInput = {
							searchType,
							contentDate,
							discoveredAt: shorterMissing,
							userPriorityOverride: userPriority,
							attemptCount
						};

						const longerResult = calculatePriority(longerInput, DEFAULT_PRIORITY_WEIGHTS, now);
						const shorterResult = calculatePriority(shorterInput, DEFAULT_PRIORITY_WEIGHTS, now);

						expect(longerResult.score).toBeGreaterThanOrEqual(shorterResult.score);
					}
				),
				{ numRuns: 100 }
			);
		});
	});
});

describe('comparePriority Properties', () => {
	describe('Property: Comparison Consistency', () => {
		it('comparePriority is consistent with score ordering', () => {
			fc.assert(
				fc.property(
					priorityInputArbitrary,
					priorityInputArbitrary,
					nowArbitrary,
					(input1, input2, now) => {
						const result1 = calculatePriority(input1, DEFAULT_PRIORITY_WEIGHTS, now);
						const result2 = calculatePriority(input2, DEFAULT_PRIORITY_WEIGHTS, now);

						const comparison = comparePriority(result1, result2);

						if (result1.score > result2.score) {
							expect(comparison).toBeLessThan(0); // result1 comes first
						} else if (result1.score < result2.score) {
							expect(comparison).toBeGreaterThan(0); // result2 comes first
						} else {
							expect(comparison).toBe(0);
						}
					}
				),
				{ numRuns: 100 }
			);
		});
	});

	describe('Property: Sorting Stability', () => {
		it('sorted array is in descending score order', () => {
			fc.assert(
				fc.property(
					fc.array(priorityInputArbitrary, { minLength: 1, maxLength: 20 }),
					nowArbitrary,
					(inputs, now) => {
						const results = inputs.map((input) =>
							calculatePriority(input, DEFAULT_PRIORITY_WEIGHTS, now)
						);
						const sorted = [...results].sort(comparePriority);

						// Verify descending order
						for (let i = 0; i < sorted.length - 1; i++) {
							expect(sorted[i]!.score).toBeGreaterThanOrEqual(sorted[i + 1]!.score);
						}
					}
				),
				{ numRuns: 100 }
			);
		});
	});
});

describe('Edge Cases', () => {
	it('should handle all minimum values', () => {
		const minInput: PriorityInput = {
			searchType: 'upgrade',
			contentDate: null,
			discoveredAt: new Date('2030-01-01'), // Future (clamped to 0 duration)
			userPriorityOverride: -100,
			attemptCount: 0
		};

		const result = calculatePriority(minInput, DEFAULT_PRIORITY_WEIGHTS, new Date('2020-01-01'));

		expect(Number.isFinite(result.score)).toBe(true);
		expect(Number.isInteger(result.score)).toBe(true);
	});

	it('should handle all maximum values', () => {
		const maxInput: PriorityInput = {
			searchType: 'gap',
			contentDate: new Date('2020-01-01'), // Very new relative to reference
			discoveredAt: new Date('2010-01-01'), // Very long missing
			userPriorityOverride: 100,
			attemptCount: 100
		};

		const result = calculatePriority(maxInput, DEFAULT_PRIORITY_WEIGHTS, new Date('2020-01-01'));

		expect(Number.isFinite(result.score)).toBe(true);
		expect(Number.isInteger(result.score)).toBe(true);
	});

	it('should handle extreme weight values', () => {
		const extremeWeights: PriorityWeights = {
			contentAge: 100,
			missingDuration: 100,
			userPriority: 100,
			failurePenalty: 50,
			gapBonus: 100
		};

		const input: PriorityInput = {
			searchType: 'gap',
			contentDate: new Date('2024-01-01'),
			discoveredAt: new Date('2020-01-01'),
			userPriorityOverride: 100,
			attemptCount: 10
		};

		const result = calculatePriority(input, extremeWeights, new Date('2024-07-01'));

		expect(Number.isFinite(result.score)).toBe(true);
		expect(Number.isInteger(result.score)).toBe(true);
	});
});
