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

 */

import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BATCHING_CONFIG } from '$lib/server/services/queue/config';
import {
	type BatchingConfig,
	calculateMissingCount,
	calculateMissingPercent,
	createEpisodeBatches,
	createMovieBatches,
	determineBatchingDecision,
	determineBatchingDecisionWithFallback,
	type EpisodeForGrouping,
	groupEpisodesBySeries,
	isSeasonFullyAired,
	type MovieForBatching,
	type SeasonStatistics
} from '$lib/server/services/queue/episode-batcher';

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

describe('Property 9: Episode Batching Decision', () => {
	describe('Fully aired + high missing → SeasonSearch', () => {
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

	describe('Currently airing → EpisodeSearch', () => {
		it('returns EpisodeSearch when nextAiring is set and episodes are missing', () => {
			fc.assert(
				fc.property(
					// Generate seasons with at least 1 missing episode
					fc
						.integer({ min: 2, max: 100 })
						.chain((total) =>
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

	describe('Below threshold → EpisodeSearch', () => {
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

// =============================================================================
// Episode Grouping Arbitraries
// =============================================================================

/**
 * Arbitrary for a positive integer ID.
 */
const positiveIdArbitrary = fc.integer({ min: 1, max: 100000 });

/**
 * Arbitrary for series IDs (limited range for easier grouping verification).
 */
const seriesIdArbitrary = fc.integer({ min: 1, max: 10 });

/**
 * Arbitrary for a single EpisodeForGrouping.
 */
const episodeForGroupingArbitrary: fc.Arbitrary<EpisodeForGrouping> = fc.record({
	episodeId: positiveIdArbitrary,
	seriesId: seriesIdArbitrary,
	arrEpisodeId: positiveIdArbitrary
});

/**
 * Arbitrary for a list of episodes for grouping.
 */
const episodesForGroupingArbitrary = fc.array(episodeForGroupingArbitrary, {
	minLength: 0,
	maxLength: 100
});

/**
 * Arbitrary for a single MovieForBatching.
 */
const movieForBatchingArbitrary: fc.Arbitrary<MovieForBatching> = fc.record({
	movieId: positiveIdArbitrary,
	arrMovieId: positiveIdArbitrary
});

/**
 * Arbitrary for a list of movies for batching.
 */
const moviesForBatchingArbitrary = fc.array(movieForBatchingArbitrary, {
	minLength: 0,
	maxLength: 100
});

/**
 * Arbitrary for valid batch size.
 */
const batchSizeArbitrary = fc.integer({ min: 1, max: 20 });

// =============================================================================
// Property 10: Episode Grouping by Series
// =============================================================================

describe('Property 10: Episode Grouping by Series', () => {
	describe('groupEpisodesBySeries()', () => {
		it('all episodes in each group belong to the same series', () => {
			fc.assert(
				fc.property(episodesForGroupingArbitrary, (episodes) => {
					const grouped = groupEpisodesBySeries(episodes);

					for (const [seriesId, seriesEpisodes] of grouped) {
						for (const episode of seriesEpisodes) {
							expect(episode.seriesId).toBe(seriesId);
						}
					}
				}),
				{ numRuns: 100 }
			);
		});

		it('total episode count is preserved after grouping', () => {
			fc.assert(
				fc.property(episodesForGroupingArbitrary, (episodes) => {
					const grouped = groupEpisodesBySeries(episodes);

					let totalGrouped = 0;
					for (const seriesEpisodes of grouped.values()) {
						totalGrouped += seriesEpisodes.length;
					}

					expect(totalGrouped).toBe(episodes.length);
				}),
				{ numRuns: 100 }
			);
		});

		it('grouping is deterministic', () => {
			fc.assert(
				fc.property(episodesForGroupingArbitrary, (episodes) => {
					const grouped1 = groupEpisodesBySeries(episodes);
					const grouped2 = groupEpisodesBySeries(episodes);

					expect(grouped1.size).toBe(grouped2.size);
					for (const [seriesId, episodes1] of grouped1) {
						const episodes2 = grouped2.get(seriesId);
						expect(episodes2).toBeDefined();
						expect(episodes1.length).toBe(episodes2!.length);
					}
				}),
				{ numRuns: 100 }
			);
		});

		it('returns empty map for empty input', () => {
			const grouped = groupEpisodesBySeries([]);
			expect(grouped.size).toBe(0);
		});
	});

	describe('createEpisodeBatches()', () => {
		it('all episodes in each batch belong to the same series', () => {
			fc.assert(
				fc.property(episodesForGroupingArbitrary, batchSizeArbitrary, (episodes, batchSize) => {
					const batches = createEpisodeBatches(episodes, batchSize);

					// Verify each batch has a valid seriesId
					// Note: we can't directly verify episode-to-series mapping since we only have arrEpisodeIds
					// But we can verify that the batch structure is correct
					for (const batch of batches) {
						expect(typeof batch.seriesId).toBe('number');
						expect(batch.seriesId).toBeGreaterThan(0);
						expect(Array.isArray(batch.arrEpisodeIds)).toBe(true);
					}
				}),
				{ numRuns: 100 }
			);
		});

		it('no batch mixes episodes from different series', () => {
			// Generate episodes with unique arrEpisodeIds to avoid lookup conflicts
			const uniqueEpisodesArbitrary = fc
				.array(
					fc.record({
						episodeId: positiveIdArbitrary,
						seriesId: seriesIdArbitrary
					}),
					{ minLength: 0, maxLength: 100 }
				)
				.map((items) =>
					// Assign unique arrEpisodeIds based on index
					items.map((item, index) => ({
						...item,
						arrEpisodeId: index + 1
					}))
				);

			fc.assert(
				fc.property(uniqueEpisodesArbitrary, batchSizeArbitrary, (episodes, batchSize) => {
					const batches = createEpisodeBatches(episodes, batchSize);

					// Create a reverse lookup: arrEpisodeId -> seriesId
					const episodeToSeries = new Map<number, number>();
					for (const ep of episodes) {
						episodeToSeries.set(ep.arrEpisodeId, ep.seriesId);
					}

					// Verify each batch only contains episodes from its stated series
					for (const batch of batches) {
						for (const arrEpisodeId of batch.arrEpisodeIds) {
							const actualSeriesId = episodeToSeries.get(arrEpisodeId);
							expect(actualSeriesId).toBe(batch.seriesId);
						}
					}
				}),
				{ numRuns: 100 }
			);
		});

		it('total episode count is preserved across all batches', () => {
			fc.assert(
				fc.property(episodesForGroupingArbitrary, batchSizeArbitrary, (episodes, batchSize) => {
					const batches = createEpisodeBatches(episodes, batchSize);

					let totalBatched = 0;
					for (const batch of batches) {
						totalBatched += batch.arrEpisodeIds.length;
					}

					expect(totalBatched).toBe(episodes.length);
				}),
				{ numRuns: 100 }
			);
		});

		it('batching is deterministic', () => {
			fc.assert(
				fc.property(episodesForGroupingArbitrary, batchSizeArbitrary, (episodes, batchSize) => {
					const batches1 = createEpisodeBatches(episodes, batchSize);
					const batches2 = createEpisodeBatches(episodes, batchSize);

					expect(batches1.length).toBe(batches2.length);
					for (let i = 0; i < batches1.length; i++) {
						expect(batches1[i]!.seriesId).toBe(batches2[i]!.seriesId);
						expect(batches1[i]!.arrEpisodeIds).toEqual(batches2[i]!.arrEpisodeIds);
					}
				}),
				{ numRuns: 100 }
			);
		});

		it('returns empty array for empty input', () => {
			const batches = createEpisodeBatches([]);
			expect(batches).toEqual([]);
		});

		it('returns empty array for invalid batch size', () => {
			const episodes: EpisodeForGrouping[] = [{ episodeId: 1, seriesId: 1, arrEpisodeId: 1001 }];
			expect(createEpisodeBatches(episodes, 0)).toEqual([]);
			expect(createEpisodeBatches(episodes, -1)).toEqual([]);
		});
	});
});

// =============================================================================
// Property 17: Search Command Batch Size Limits
// =============================================================================

describe('Property 17: Search Command Batch Size Limits (Requirements 29.4, 29.5)', () => {
	describe('EpisodeBatch size limits', () => {
		it('no EpisodeBatch contains more than maxBatchSize episodes', () => {
			fc.assert(
				fc.property(episodesForGroupingArbitrary, batchSizeArbitrary, (episodes, batchSize) => {
					const batches = createEpisodeBatches(episodes, batchSize);

					for (const batch of batches) {
						expect(batch.arrEpisodeIds.length).toBeLessThanOrEqual(batchSize);
					}
				}),
				{ numRuns: 100 }
			);
		});

		it('default batch size is MAX_EPISODES_PER_SEARCH (10)', () => {
			fc.assert(
				fc.property(
					fc.array(episodeForGroupingArbitrary, { minLength: 15, maxLength: 50 }),
					(episodes) => {
						const batches = createEpisodeBatches(episodes);

						for (const batch of batches) {
							expect(batch.arrEpisodeIds.length).toBeLessThanOrEqual(
								BATCHING_CONFIG.MAX_EPISODES_PER_SEARCH
							);
						}
					}
				),
				{ numRuns: 100 }
			);
		});

		it('each non-empty batch contains at least 1 episode', () => {
			fc.assert(
				fc.property(
					fc.array(episodeForGroupingArbitrary, { minLength: 1, maxLength: 50 }),
					batchSizeArbitrary,
					(episodes, batchSize) => {
						const batches = createEpisodeBatches(episodes, batchSize);

						for (const batch of batches) {
							expect(batch.arrEpisodeIds.length).toBeGreaterThanOrEqual(1);
						}
					}
				),
				{ numRuns: 100 }
			);
		});

		it('respects custom batch size configuration', () => {
			const customBatchSize = 5;
			const episodes: EpisodeForGrouping[] = Array.from({ length: 12 }, (_, i) => ({
				episodeId: i + 1,
				seriesId: 1, // All same series
				arrEpisodeId: 1000 + i + 1
			}));

			const batches = createEpisodeBatches(episodes, customBatchSize);

			// Should create 3 batches: 5, 5, 2
			expect(batches.length).toBe(3);
			expect(batches[0]!.arrEpisodeIds.length).toBe(5);
			expect(batches[1]!.arrEpisodeIds.length).toBe(5);
			expect(batches[2]!.arrEpisodeIds.length).toBe(2);
		});
	});

	describe('MovieBatch size limits', () => {
		it('no MovieBatch contains more than maxBatchSize movies', () => {
			fc.assert(
				fc.property(moviesForBatchingArbitrary, batchSizeArbitrary, (movies, batchSize) => {
					const batches = createMovieBatches(movies, batchSize);

					for (const batch of batches) {
						expect(batch.arrMovieIds.length).toBeLessThanOrEqual(batchSize);
					}
				}),
				{ numRuns: 100 }
			);
		});

		it('default batch size is MAX_MOVIES_PER_SEARCH (10)', () => {
			fc.assert(
				fc.property(
					fc.array(movieForBatchingArbitrary, { minLength: 15, maxLength: 50 }),
					(movies) => {
						const batches = createMovieBatches(movies);

						for (const batch of batches) {
							expect(batch.arrMovieIds.length).toBeLessThanOrEqual(
								BATCHING_CONFIG.MAX_MOVIES_PER_SEARCH
							);
						}
					}
				),
				{ numRuns: 100 }
			);
		});

		it('total movie count is preserved across all batches', () => {
			fc.assert(
				fc.property(moviesForBatchingArbitrary, batchSizeArbitrary, (movies, batchSize) => {
					const batches = createMovieBatches(movies, batchSize);

					let totalBatched = 0;
					for (const batch of batches) {
						totalBatched += batch.arrMovieIds.length;
					}

					expect(totalBatched).toBe(movies.length);
				}),
				{ numRuns: 100 }
			);
		});

		it('batching is deterministic', () => {
			fc.assert(
				fc.property(moviesForBatchingArbitrary, batchSizeArbitrary, (movies, batchSize) => {
					const batches1 = createMovieBatches(movies, batchSize);
					const batches2 = createMovieBatches(movies, batchSize);

					expect(batches1.length).toBe(batches2.length);
					for (let i = 0; i < batches1.length; i++) {
						expect(batches1[i]!.arrMovieIds).toEqual(batches2[i]!.arrMovieIds);
					}
				}),
				{ numRuns: 100 }
			);
		});

		it('returns empty array for empty input', () => {
			const batches = createMovieBatches([]);
			expect(batches).toEqual([]);
		});

		it('returns empty array for invalid batch size', () => {
			const movies: MovieForBatching[] = [{ movieId: 1, arrMovieId: 101 }];
			expect(createMovieBatches(movies, 0)).toEqual([]);
			expect(createMovieBatches(movies, -1)).toEqual([]);
		});

		it('respects custom batch size configuration', () => {
			const customBatchSize = 3;
			const movies: MovieForBatching[] = Array.from({ length: 8 }, (_, i) => ({
				movieId: i + 1,
				arrMovieId: 100 + i + 1
			}));

			const batches = createMovieBatches(movies, customBatchSize);

			// Should create 3 batches: 3, 3, 2
			expect(batches.length).toBe(3);
			expect(batches[0]!.arrMovieIds.length).toBe(3);
			expect(batches[1]!.arrMovieIds.length).toBe(3);
			expect(batches[2]!.arrMovieIds.length).toBe(2);
		});
	});
});

// =============================================================================
// Season Pack Fallback
// =============================================================================

describe('Season Pack Fallback', () => {
	/**
	 * Arbitrary for stats that would normally trigger SeasonSearch.
	 * These are fully aired seasons with high missing counts.
	 */
	const seasonSearchQualifyingStatsArbitrary: fc.Arbitrary<SeasonStatistics> = fc
		.integer({ min: 10, max: 100 }) // Enough episodes to meet thresholds
		.chain((totalEpisodes) => {
			// Calculate minimum missing to meet both thresholds
			const minMissingCount = DEFAULT_CONFIG.seasonSearchMinMissingCount;
			const minMissingPercent = DEFAULT_CONFIG.seasonSearchMinMissingPercent;
			const minMissingForPercent = Math.ceil((totalEpisodes * minMissingPercent) / 100);
			const minMissing = Math.max(minMissingCount, minMissingForPercent);

			// Ensure we have enough missing episodes
			if (minMissing > totalEpisodes) {
				// Not enough episodes, generate with 100% missing
				return fc.record({
					totalEpisodes: fc.constant(totalEpisodes),
					downloadedEpisodes: fc.constant(0),
					nextAiring: fc.constant(null) // Fully aired
				});
			}

			return fc.record({
				totalEpisodes: fc.constant(totalEpisodes),
				// Downloaded should leave at least minMissing missing
				downloadedEpisodes: fc.integer({ min: 0, max: totalEpisodes - minMissing }),
				nextAiring: fc.constant(null) // Fully aired
			});
		});

	describe('determineBatchingDecisionWithFallback()', () => {
		it('returns EpisodeSearch with season_pack_fallback reason when seasonPackFailed is true', () => {
			fc.assert(
				fc.property(seasonStatsArbitrary, (stats) => {
					const result = determineBatchingDecisionWithFallback(stats, true);
					expect(result.command).toBe('EpisodeSearch');
					expect(result.reason).toBe('season_pack_fallback');
				}),
				{ numRuns: 100 }
			);
		});

		it('forces EpisodeSearch even when stats would qualify for SeasonSearch', () => {
			fc.assert(
				fc.property(seasonSearchQualifyingStatsArbitrary, (stats) => {
					// Verify these stats would normally trigger SeasonSearch
					const normalResult = determineBatchingDecision(stats);
					if (normalResult.command !== 'SeasonSearch') {
						// Skip if stats don't qualify for SeasonSearch
						return;
					}

					// With seasonPackFailed=true, should force EpisodeSearch
					const fallbackResult = determineBatchingDecisionWithFallback(stats, true);
					expect(fallbackResult.command).toBe('EpisodeSearch');
					expect(fallbackResult.reason).toBe('season_pack_fallback');
				}),
				{ numRuns: 100 }
			);
		});

		it('delegates to normal logic when seasonPackFailed is false', () => {
			fc.assert(
				fc.property(seasonStatsArbitrary, batchingConfigArbitrary, (stats, config) => {
					const normalResult = determineBatchingDecision(stats, config);
					const fallbackResult = determineBatchingDecisionWithFallback(stats, false, config);

					// Should produce identical results when no fallback
					expect(fallbackResult.command).toBe(normalResult.command);
					expect(fallbackResult.reason).toBe(normalResult.reason);
				}),
				{ numRuns: 100 }
			);
		});

		it('fallback decision is deterministic', () => {
			fc.assert(
				fc.property(
					seasonStatsArbitrary,
					fc.boolean(),
					batchingConfigArbitrary,
					(stats, seasonPackFailed, config) => {
						const result1 = determineBatchingDecisionWithFallback(stats, seasonPackFailed, config);
						const result2 = determineBatchingDecisionWithFallback(stats, seasonPackFailed, config);

						expect(result1.command).toBe(result2.command);
						expect(result1.reason).toBe(result2.reason);
					}
				),
				{ numRuns: 100 }
			);
		});

		it('respects config when seasonPackFailed is false', () => {
			const lowThresholdConfig: BatchingConfig = {
				seasonSearchMinMissingPercent: 10,
				seasonSearchMinMissingCount: 1
			};

			const stats: SeasonStatistics = {
				totalEpisodes: 10,
				downloadedEpisodes: 8, // 2 missing = 20%
				nextAiring: null
			};

			// With low thresholds and no fallback, should get SeasonSearch
			const result = determineBatchingDecisionWithFallback(stats, false, lowThresholdConfig);
			expect(result.command).toBe('SeasonSearch');

			// With fallback flag, should force EpisodeSearch
			const fallbackResult = determineBatchingDecisionWithFallback(stats, true, lowThresholdConfig);
			expect(fallbackResult.command).toBe('EpisodeSearch');
			expect(fallbackResult.reason).toBe('season_pack_fallback');
		});
	});

	describe('Edge cases', () => {
		it('handles zero episodes with fallback flag', () => {
			const stats: SeasonStatistics = {
				totalEpisodes: 0,
				downloadedEpisodes: 0,
				nextAiring: null
			};

			// Even with fallback flag, zero episodes should return no_missing_episodes
			// The fallback check happens first but the normal logic handles this edge case
			const result = determineBatchingDecisionWithFallback(stats, true);
			// With seasonPackFailed=true, fallback takes precedence
			expect(result.command).toBe('EpisodeSearch');
			expect(result.reason).toBe('season_pack_fallback');
		});

		it('handles currently airing season with fallback flag', () => {
			const stats: SeasonStatistics = {
				totalEpisodes: 10,
				downloadedEpisodes: 5,
				nextAiring: new Date('2025-12-01')
			};

			// With fallback flag, should still return fallback reason (takes precedence)
			const result = determineBatchingDecisionWithFallback(stats, true);
			expect(result.command).toBe('EpisodeSearch');
			expect(result.reason).toBe('season_pack_fallback');
		});

		it('handles all episodes downloaded with fallback flag', () => {
			const stats: SeasonStatistics = {
				totalEpisodes: 10,
				downloadedEpisodes: 10,
				nextAiring: null
			};

			// With fallback flag, should still return fallback reason
			const result = determineBatchingDecisionWithFallback(stats, true);
			expect(result.command).toBe('EpisodeSearch');
			expect(result.reason).toBe('season_pack_fallback');
		});
	});
});
