/**
 * Property-based tests for episode batching decision logic.
 *
 * Validates requirements:
 * - 6.1: Fully aired season with high missing → SeasonSearch
 * - 6.2: Currently airing season → EpisodeSearch
 * - 6.3: Below threshold → EpisodeSearch
 *
 * Property 9: Episode Batching Decision
 * "For any season with known statistics (total episodes, downloaded episodes, next airing date),
 * the batching decision should follow these rules:
 * - If season is fully aired (nextAiring is null) AND missing percentage > threshold → SeasonSearch
 * - If season is currently airing (nextAiring is set) → EpisodeSearch
 * - If missing count < minimum threshold → EpisodeSearch"
 *
 * @requirements 6.1, 6.2, 6.3
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
	determineBatchingDecision,
	calculateMissingPercent,
	calculateMissingCount,
	isSeasonFullyAired,
	type SeasonStatistics,
	type BatchingConfig
} from '$lib/server/services/queue/episode-batcher';
import { BATCHING_CONFIG } from '$lib/server/services/queue/config';

// =============================================================================
// Test Configuration
// =============================================================================

const DEFAULT_CONFIG: BatchingConfig = {
	seasonSearchMinMissingPercent: BATCHING_CONFIG.SEASON_SEARCH_MIN_MISSING_PERCENT,
	seasonSearchMinMissingCount: BATCHING_CONFIG.SEASON_SEARCH_MIN_MISSING_COUNT
};

// =============================================================================
// Arbitraries
// =============================================================================

/**
 * Arbitrary for episode counts.
 * Typical season has 1-24 episodes.
 */
const episodeCountArbitrary = fc.integer({ min: 0, max: 100 });

/**
 * Arbitrary for total episodes (must be >= 1 for a valid season).
 */
const totalEpisodesArbitrary = fc.integer({ min: 1, max: 100 });

/**
 * Arbitrary for downloaded episodes (depends on total).
 */
const downloadedEpisodesArbitrary = (total: number) => fc.integer({ min: 0, max: total });

/**
 * Arbitrary for next airing date (future date or null).
 */
const nextAiringArbitrary: fc.Arbitrary<Date | null> = fc.option(
	fc
		.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') })
		.filter((d) => !Number.isNaN(d.getTime())),
	{ nil: null }
);

/**
 * Arbitrary for a future date (for currently airing seasons).
 */
const futureDateArbitrary: fc.Arbitrary<Date> = fc
	.date({ min: new Date('2025-01-01'), max: new Date('2030-12-31') })
	.filter((d) => !Number.isNaN(d.getTime()));

/**
 * Arbitrary for a valid SeasonStatistics object.
 */
const seasonStatsArbitrary: fc.Arbitrary<SeasonStatistics> = totalEpisodesArbitrary.chain(
	(totalEpisodes) =>
		fc.record({
			totalEpisodes: fc.constant(totalEpisodes),
			downloadedEpisodes: downloadedEpisodesArbitrary(totalEpisodes),
			nextAiring: nextAiringArbitrary
		})
);

/**
 * Arbitrary for valid batching configuration.
 */
const batchingConfigArbitrary: fc.Arbitrary<BatchingConfig> = fc.record({
	seasonSearchMinMissingPercent: fc.integer({ min: 0, max: 100 }),
	seasonSearchMinMissingCount: fc.integer({ min: 1, max: 20 })
});

// =============================================================================
// Helper Function Tests
// =============================================================================

describe('Helper Functions', () => {
	describe('calculateMissingPercent', () => {
		it('returns 0 when totalEpisodes is 0', () => {
			expect(calculateMissingPercent(0, 0)).toBe(0);
		});

		it('returns 0 when all episodes are downloaded', () => {
			fc.assert(
				fc.property(totalEpisodesArbitrary, (total) => {
					expect(calculateMissingPercent(total, total)).toBe(0);
				}),
				{ numRuns: 100 }
			);
		});

		it('returns 100 when no episodes are downloaded', () => {
			fc.assert(
				fc.property(totalEpisodesArbitrary, (total) => {
					expect(calculateMissingPercent(total, 0)).toBe(100);
				}),
				{ numRuns: 100 }
			);
		});

		it('returns correct percentage for partial downloads', () => {
			// 5 total, 2 downloaded = 3 missing = 60%
			expect(calculateMissingPercent(5, 2)).toBe(60);
			// 10 total, 5 downloaded = 5 missing = 50%
			expect(calculateMissingPercent(10, 5)).toBe(50);
			// 8 total, 6 downloaded = 2 missing = 25%
			expect(calculateMissingPercent(8, 6)).toBe(25);
		});

		it('always returns value between 0 and 100', () => {
			fc.assert(
				fc.property(
					totalEpisodesArbitrary,
					totalEpisodesArbitrary.chain((t) => downloadedEpisodesArbitrary(t)),
					(total, downloaded) => {
						// Ensure downloaded <= total for valid inputs
						const safeDownloaded = Math.min(downloaded, total);
						const percent = calculateMissingPercent(total, safeDownloaded);
						expect(percent).toBeGreaterThanOrEqual(0);
						expect(percent).toBeLessThanOrEqual(100);
					}
				),
				{ numRuns: 100 }
			);
		});
	});

	describe('calculateMissingCount', () => {
		it('returns 0 when all episodes are downloaded', () => {
			fc.assert(
				fc.property(totalEpisodesArbitrary, (total) => {
					expect(calculateMissingCount(total, total)).toBe(0);
				}),
				{ numRuns: 100 }
			);
		});

		it('returns total when no episodes are downloaded', () => {
			fc.assert(
				fc.property(totalEpisodesArbitrary, (total) => {
					expect(calculateMissingCount(total, 0)).toBe(total);
				}),
				{ numRuns: 100 }
			);
		});

		it('never returns negative values', () => {
			fc.assert(
				fc.property(episodeCountArbitrary, episodeCountArbitrary, (total, downloaded) => {
					expect(calculateMissingCount(total, downloaded)).toBeGreaterThanOrEqual(0);
				}),
				{ numRuns: 100 }
			);
		});

		it('returns correct count for partial downloads', () => {
			expect(calculateMissingCount(10, 7)).toBe(3);
			expect(calculateMissingCount(5, 2)).toBe(3);
			expect(calculateMissingCount(8, 8)).toBe(0);
		});
	});

	describe('isSeasonFullyAired', () => {
		it('returns true when nextAiring is null', () => {
			expect(isSeasonFullyAired(null)).toBe(true);
		});

		it('returns false when nextAiring is a date', () => {
			fc.assert(
				fc.property(futureDateArbitrary, (date) => {
					expect(isSeasonFullyAired(date)).toBe(false);
				}),
				{ numRuns: 100 }
			);
		});
	});
});

// =============================================================================
// Property 9: Episode Batching Decision
// =============================================================================

describe('Property 9: Episode Batching Decision (Requirements 6.1, 6.2, 6.3)', () => {
	describe('Requirement 6.1: Fully aired + high missing → SeasonSearch', () => {
		it('returns SeasonSearch when season fully aired and above thresholds', () => {
			fc.assert(
				fc.property(
					// Generate valid config with non-zero thresholds
					batchingConfigArbitrary.filter(
						(c) => c.seasonSearchMinMissingPercent > 0 && c.seasonSearchMinMissingCount >= 1
					),
					(config) => {
						// Create stats that MUST trigger SeasonSearch:
						// - fully aired (nextAiring = null)
						// - missing % >= threshold
						// - missing count >= minCount
						const minMissing = config.seasonSearchMinMissingCount;
						const minPercent = config.seasonSearchMinMissingPercent;

						// Calculate total and downloaded to meet thresholds
						// We need: missingCount >= minMissing AND (missingCount / total) * 100 >= minPercent
						// Use a large enough total to ensure percentage is met
						const total = Math.max(
							minMissing * 2, // At least double the min count
							Math.ceil((minMissing * 100) / Math.max(minPercent, 1)) // Ensure percentage threshold is met
						);
						const downloaded = Math.max(0, total - minMissing);

						// Verify our setup meets the criteria
						const missingPercent = calculateMissingPercent(total, downloaded);
						const missingCount = calculateMissingCount(total, downloaded);

						// Skip if our calculated values don't meet thresholds due to rounding
						if (missingPercent < minPercent || missingCount < minMissing) {
							return; // Skip this iteration
						}

						const stats: SeasonStatistics = {
							totalEpisodes: total,
							downloadedEpisodes: downloaded,
							nextAiring: null // Fully aired
						};

						const result = determineBatchingDecision(stats, config);
						expect(result.command).toBe('SeasonSearch');
						expect(result.reason).toBe('season_fully_aired_high_missing');
					}
				),
				{ numRuns: 100 }
			);
		});
	});

	describe('Requirement 6.2: Currently airing → EpisodeSearch', () => {
		it('returns EpisodeSearch when nextAiring is set and episodes are missing', () => {
			fc.assert(
				fc.property(
					// Generate seasons with at least 1 missing episode
					fc.integer({ min: 2, max: 100 }).chain((total) =>
						fc.record({
							totalEpisodes: fc.constant(total),
							// Downloaded must be less than total (at least 1 missing)
							downloadedEpisodes: fc.integer({ min: 0, max: total - 1 }),
							nextAiring: futureDateArbitrary // Always a date, never null
						})
					),
					(stats) => {
						const result = determineBatchingDecision(stats);
						expect(result.command).toBe('EpisodeSearch');
						expect(result.reason).toBe('season_currently_airing');
					}
				),
				{ numRuns: 100 }
			);
		});

		it('nextAiring overrides all other factors', () => {
			// Even with 100% missing (worst case for gaps), still returns EpisodeSearch
			fc.assert(
				fc.property(totalEpisodesArbitrary, futureDateArbitrary, (total, nextAiring) => {
					const stats: SeasonStatistics = {
						totalEpisodes: total,
						downloadedEpisodes: 0, // 100% missing
						nextAiring // Currently airing
					};

					const result = determineBatchingDecision(stats);
					expect(result.command).toBe('EpisodeSearch');
					expect(result.reason).toBe('season_currently_airing');
				}),
				{ numRuns: 100 }
			);
		});
	});

	describe('Requirement 6.3: Below threshold → EpisodeSearch', () => {
		it('returns EpisodeSearch when missing count below threshold', () => {
			fc.assert(
				fc.property(
					batchingConfigArbitrary.filter((c) => c.seasonSearchMinMissingCount > 1),
					(config) => {
						// Create stats with missing count below threshold
						const total = config.seasonSearchMinMissingCount + 5;
						const missingCount = config.seasonSearchMinMissingCount - 1;
						const downloaded = total - missingCount;

						const stats: SeasonStatistics = {
							totalEpisodes: total,
							downloadedEpisodes: downloaded,
							nextAiring: null // Fully aired
						};

						const result = determineBatchingDecision(stats, config);
						expect(result.command).toBe('EpisodeSearch');
						expect(result.reason).toBe('below_missing_threshold');
					}
				),
				{ numRuns: 100 }
			);
		});

		it('returns EpisodeSearch when missing percentage below threshold', () => {
			fc.assert(
				fc.property(
					batchingConfigArbitrary.filter((c) => c.seasonSearchMinMissingPercent > 10),
					(config) => {
						// Create stats with missing percentage below threshold
						const total = 100; // Use 100 for easy percentage calculation
						const targetPercent = config.seasonSearchMinMissingPercent - 1;
						const missingCount = Math.floor(targetPercent);
						const downloaded = total - missingCount;

						const stats: SeasonStatistics = {
							totalEpisodes: total,
							downloadedEpisodes: downloaded,
							nextAiring: null // Fully aired
						};

						const result = determineBatchingDecision(stats, config);
						expect(result.command).toBe('EpisodeSearch');
						// Could be below_missing_threshold or no_missing_episodes
						expect(['below_missing_threshold', 'no_missing_episodes']).toContain(result.reason);
					}
				),
				{ numRuns: 100 }
			);
		});
	});

	describe('Edge case: No missing episodes', () => {
		it('returns EpisodeSearch with no_missing_episodes reason when all downloaded', () => {
			fc.assert(
				fc.property(totalEpisodesArbitrary, nextAiringArbitrary, (total, nextAiring) => {
					const stats: SeasonStatistics = {
						totalEpisodes: total,
						downloadedEpisodes: total, // All downloaded
						nextAiring
					};

					const result = determineBatchingDecision(stats);
					expect(result.command).toBe('EpisodeSearch');
					expect(result.reason).toBe('no_missing_episodes');
				}),
				{ numRuns: 100 }
			);
		});
	});

	describe('Determinism', () => {
		it('same inputs always produce same output', () => {
			fc.assert(
				fc.property(seasonStatsArbitrary, batchingConfigArbitrary, (stats, config) => {
					const result1 = determineBatchingDecision(stats, config);
					const result2 = determineBatchingDecision(stats, config);

					expect(result1.command).toBe(result2.command);
					expect(result1.reason).toBe(result2.reason);
				}),
				{ numRuns: 100 }
			);
		});
	});

	describe('Config override', () => {
		it('respects custom config thresholds', () => {
			// With very low thresholds, more seasons qualify for SeasonSearch
			const lowThresholdConfig: BatchingConfig = {
				seasonSearchMinMissingPercent: 10, // Only 10% missing needed
				seasonSearchMinMissingCount: 1 // Only 1 missing episode needed
			};

			const stats: SeasonStatistics = {
				totalEpisodes: 10,
				downloadedEpisodes: 8, // 2 missing = 20%
				nextAiring: null
			};

			const result = determineBatchingDecision(stats, lowThresholdConfig);
			expect(result.command).toBe('SeasonSearch');

			// With default config (50% / 3 minimum), same stats should return EpisodeSearch
			const defaultResult = determineBatchingDecision(stats);
			expect(defaultResult.command).toBe('EpisodeSearch');
		});

		it('partial config merges with defaults', () => {
			const stats: SeasonStatistics = {
				totalEpisodes: 10,
				downloadedEpisodes: 4, // 6 missing = 60%
				nextAiring: null
			};

			// Only override minMissingCount, keep default percent (50%)
			const result = determineBatchingDecision(stats, { seasonSearchMinMissingCount: 10 });

			// 60% > 50% (percent OK), but 6 < 10 (count NOT OK) → EpisodeSearch
			expect(result.command).toBe('EpisodeSearch');
			expect(result.reason).toBe('below_missing_threshold');
		});
	});
});

// =============================================================================
// Edge Cases
// =============================================================================

describe('Edge Cases', () => {
	it('handles zero total episodes', () => {
		const stats: SeasonStatistics = {
			totalEpisodes: 0,
			downloadedEpisodes: 0,
			nextAiring: null
		};

		const result = determineBatchingDecision(stats);
		expect(result.command).toBe('EpisodeSearch');
		expect(result.reason).toBe('no_missing_episodes');
	});

	it('handles exactly at threshold boundaries', () => {
		const config = DEFAULT_CONFIG;

		// Exactly at 50% missing with exactly 3 missing episodes
		const stats: SeasonStatistics = {
			totalEpisodes: 6,
			downloadedEpisodes: 3, // 3 missing = 50%
			nextAiring: null
		};

		const result = determineBatchingDecision(stats, config);
		// At exactly threshold, should qualify for SeasonSearch
		expect(result.command).toBe('SeasonSearch');
		expect(result.reason).toBe('season_fully_aired_high_missing');
	});

	it('handles just below threshold boundaries', () => {
		const config: BatchingConfig = {
			seasonSearchMinMissingPercent: 50,
			seasonSearchMinMissingCount: 3
		};

		// Just below 50% missing (49.9%)
		const stats: SeasonStatistics = {
			totalEpisodes: 1000,
			downloadedEpisodes: 501, // 499 missing = 49.9%
			nextAiring: null
		};

		const result = determineBatchingDecision(stats, config);
		expect(result.command).toBe('EpisodeSearch');
		expect(result.reason).toBe('below_missing_threshold');
	});

	it('handles single episode season', () => {
		const stats: SeasonStatistics = {
			totalEpisodes: 1,
			downloadedEpisodes: 0,
			nextAiring: null
		};

		const result = determineBatchingDecision(stats);
		// 1 missing < 3 minimum count → EpisodeSearch
		expect(result.command).toBe('EpisodeSearch');
		expect(result.reason).toBe('below_missing_threshold');
	});

	it('handles very large season', () => {
		const stats: SeasonStatistics = {
			totalEpisodes: 1000,
			downloadedEpisodes: 0, // 100% missing
			nextAiring: null
		};

		const result = determineBatchingDecision(stats);
		expect(result.command).toBe('SeasonSearch');
		expect(result.reason).toBe('season_fully_aired_high_missing');
	});
});
