/**
 * Property-based tests for pagination utilities.
 *
 * Validates requirements:
 * - 29.1: Paginate requests with pageSize of 1000 items
 * - 29.2: Continue fetching until page * pageSize >= totalRecords
 *
 * Property 16: Pagination Completeness
 * For any paginated API response with totalRecords > pageSize, iterating through
 * all pages should yield exactly totalRecords items with no duplicates and no missing items.
 */

import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
	collectAllPages,
	collectAllPagesWithMetadata,
	DEFAULT_PAGE_SIZE,
	fetchAllPages,
	type PageFetcher
} from '../../src/lib/server/connectors/common/pagination';

/**
 * Simple record type for testing
 */
interface TestRecord {
	id: number;
	value: string;
}

/**
 * Create a mock page fetcher that simulates paginated API responses.
 * Generates deterministic records based on page number and total.
 */
function createMockFetcher(
	totalRecords: number,
	_pageSize: number = DEFAULT_PAGE_SIZE
): { fetcher: PageFetcher<TestRecord>; allRecords: TestRecord[]; callCount: () => number } {
	// Pre-generate all records with unique sequential IDs
	const allRecords: TestRecord[] = [];
	for (let i = 0; i < totalRecords; i++) {
		allRecords.push({ id: i + 1, value: `record-${i + 1}` });
	}

	let calls = 0;

	const fetcher: PageFetcher<TestRecord> = async (page, reqPageSize) => {
		calls++;

		// Calculate slice indices (pages are 1-indexed)
		const startIndex = (page - 1) * reqPageSize;
		const endIndex = Math.min(startIndex + reqPageSize, totalRecords);
		const records = allRecords.slice(startIndex, endIndex);

		return {
			page,
			pageSize: reqPageSize,
			sortKey: 'id',
			sortDirection: 'ascending' as const,
			totalRecords,
			records
		};
	};

	return { fetcher, allRecords, callCount: () => calls };
}

describe('Pagination Utilities - Property Tests', () => {
	describe('Property 16: Pagination Completeness', () => {
		it('yields exactly totalRecords items for any valid totalRecords and pageSize', async () => {
			await fc.assert(
				fc.asyncProperty(
					fc.integer({ min: 0, max: 5000 }), // totalRecords
					fc.integer({ min: 1, max: 1000 }), // pageSize
					async (totalRecords, pageSize) => {
						const { fetcher } = createMockFetcher(totalRecords, pageSize);

						const collected: TestRecord[] = [];
						for await (const record of fetchAllPages(fetcher, { pageSize })) {
							collected.push(record);
						}

						// Should yield exactly totalRecords items
						expect(collected).toHaveLength(totalRecords);
					}
				),
				{ numRuns: 100 }
			);
		});

		it('yields all records with no duplicates', async () => {
			await fc.assert(
				fc.asyncProperty(
					fc.integer({ min: 1, max: 3000 }), // totalRecords (at least 1 for this test)
					fc.integer({ min: 1, max: 500 }), // pageSize
					async (totalRecords, pageSize) => {
						const { fetcher } = createMockFetcher(totalRecords, pageSize);

						const ids = new Set<number>();
						for await (const record of fetchAllPages(fetcher, { pageSize })) {
							ids.add(record.id);
						}

						// All IDs should be unique (no duplicates)
						expect(ids.size).toBe(totalRecords);

						// All expected IDs should be present
						for (let i = 1; i <= totalRecords; i++) {
							expect(ids.has(i)).toBe(true);
						}
					}
				),
				{ numRuns: 100 }
			);
		});

		it('maintains correct order of records across pages', async () => {
			await fc.assert(
				fc.asyncProperty(
					fc.integer({ min: 1, max: 2000 }),
					fc.integer({ min: 1, max: 500 }),
					async (totalRecords, pageSize) => {
						const { fetcher } = createMockFetcher(totalRecords, pageSize);

						const collected: TestRecord[] = [];
						for await (const record of fetchAllPages(fetcher, { pageSize })) {
							collected.push(record);
						}

						// Records should maintain original order (sequential IDs)
						for (let i = 0; i < collected.length; i++) {
							expect(collected[i]!.id).toBe(i + 1);
						}
					}
				),
				{ numRuns: 100 }
			);
		});
	});

	describe('Correct Termination', () => {
		it('stops fetching when page * pageSize >= totalRecords', async () => {
			await fc.assert(
				fc.asyncProperty(
					fc.integer({ min: 1, max: 5000 }), // totalRecords
					fc.integer({ min: 1, max: 1000 }), // pageSize
					async (totalRecords, pageSize) => {
						const { fetcher, callCount } = createMockFetcher(totalRecords, pageSize);

						// Consume all records
						for await (const _ of fetchAllPages(fetcher, { pageSize })) {
							// Just iterate
						}

						// Calculate expected number of pages
						const expectedPages = Math.ceil(totalRecords / pageSize);

						// Should have made exactly the expected number of API calls
						expect(callCount()).toBe(expectedPages);
					}
				),
				{ numRuns: 100 }
			);
		});

		it('makes exactly one call for single page responses', async () => {
			await fc.assert(
				fc.asyncProperty(
					fc.integer({ min: 1, max: 1000 }), // totalRecords <= pageSize
					async (totalRecords) => {
						const pageSize = 1000; // totalRecords will always fit in one page
						const { fetcher, callCount } = createMockFetcher(totalRecords, pageSize);

						await collectAllPages(fetcher, { pageSize });

						// Should make exactly one API call
						expect(callCount()).toBe(1);
					}
				),
				{ numRuns: 100 }
			);
		});
	});

	describe('Edge Cases', () => {
		it('handles empty response (totalRecords = 0)', async () => {
			const { fetcher, callCount } = createMockFetcher(0);

			const results = await collectAllPages(fetcher);

			expect(results).toHaveLength(0);
			expect(callCount()).toBe(1); // Should still make one call to discover empty set
		});

		it('handles exact page boundary (totalRecords = pageSize * N)', async () => {
			await fc.assert(
				fc.asyncProperty(
					fc.integer({ min: 1, max: 5 }), // number of full pages
					fc.integer({ min: 10, max: 100 }), // pageSize
					async (numPages, pageSize) => {
						const totalRecords = numPages * pageSize; // Exact multiple
						const { fetcher, callCount } = createMockFetcher(totalRecords, pageSize);

						const results = await collectAllPages(fetcher, { pageSize });

						expect(results).toHaveLength(totalRecords);
						expect(callCount()).toBe(numPages);
					}
				),
				{ numRuns: 100 }
			);
		});

		it('handles off-by-one scenarios correctly', async () => {
			await fc.assert(
				fc.asyncProperty(
					fc.integer({ min: 1, max: 5 }), // number of full pages
					fc.integer({ min: 10, max: 100 }), // pageSize
					fc.integer({ min: -1, max: 1 }), // offset from exact boundary
					async (numPages, pageSize, offset) => {
						const totalRecords = Math.max(0, numPages * pageSize + offset);
						const { fetcher } = createMockFetcher(totalRecords, pageSize);

						const results = await collectAllPages(fetcher, { pageSize });

						expect(results).toHaveLength(totalRecords);
					}
				),
				{ numRuns: 100 }
			);
		});
	});

	describe('Default Page Size', () => {
		it('uses default pageSize of 1000 when not specified', async () => {
			let capturedPageSize: number | undefined;

			const mockFetcher: PageFetcher<TestRecord> = async (page, pageSize) => {
				capturedPageSize = pageSize;
				return {
					page,
					pageSize,
					sortKey: 'id',
					sortDirection: 'ascending',
					totalRecords: 0,
					records: []
				};
			};

			await collectAllPages(mockFetcher);

			expect(capturedPageSize).toBe(DEFAULT_PAGE_SIZE);
			expect(capturedPageSize).toBe(1000); // Default page size
		});

		it('allows custom pageSize override', async () => {
			await fc.assert(
				fc.asyncProperty(fc.integer({ min: 1, max: 500 }), async (customPageSize) => {
					let capturedPageSize: number | undefined;

					const mockFetcher: PageFetcher<TestRecord> = async (page, pageSize) => {
						capturedPageSize = pageSize;
						return {
							page,
							pageSize,
							sortKey: 'id',
							sortDirection: 'ascending',
							totalRecords: 0,
							records: []
						};
					};

					await collectAllPages(mockFetcher, { pageSize: customPageSize });

					expect(capturedPageSize).toBe(customPageSize);
				}),
				{ numRuns: 100 }
			);
		});
	});

	describe('collectAllPages Helper', () => {
		it('returns same results as manual iteration', async () => {
			await fc.assert(
				fc.asyncProperty(
					fc.integer({ min: 0, max: 2000 }),
					fc.integer({ min: 1, max: 500 }),
					async (totalRecords, pageSize) => {
						const { fetcher: fetcher1 } = createMockFetcher(totalRecords, pageSize);
						const { fetcher: fetcher2 } = createMockFetcher(totalRecords, pageSize);

						// Collect via helper
						const helperResults = await collectAllPages(fetcher1, { pageSize });

						// Collect manually
						const manualResults: TestRecord[] = [];
						for await (const record of fetchAllPages(fetcher2, { pageSize })) {
							manualResults.push(record);
						}

						expect(helperResults).toEqual(manualResults);
					}
				),
				{ numRuns: 100 }
			);
		});
	});

	describe('collectAllPagesWithMetadata Helper', () => {
		it('returns correct metadata', async () => {
			await fc.assert(
				fc.asyncProperty(
					fc.integer({ min: 0, max: 3000 }),
					fc.integer({ min: 1, max: 500 }),
					async (totalRecords, pageSize) => {
						const { fetcher } = createMockFetcher(totalRecords, pageSize);

						const { records, metadata } = await collectAllPagesWithMetadata(fetcher, {
							pageSize
						});

						expect(records).toHaveLength(totalRecords);
						expect(metadata.totalRecords).toBe(totalRecords);
						expect(metadata.pageSize).toBe(pageSize);
						expect(metadata.pagesFetched).toBe(Math.max(1, Math.ceil(totalRecords / pageSize)));
					}
				),
				{ numRuns: 100 }
			);
		});
	});

	describe('Custom Start Page', () => {
		it('respects startPage option', async () => {
			await fc.assert(
				fc.asyncProperty(
					fc.integer({ min: 100, max: 500 }), // totalRecords
					fc.integer({ min: 10, max: 50 }), // pageSize
					fc.integer({ min: 2, max: 5 }), // startPage (skip first pages)
					async (totalRecords, pageSize, startPage) => {
						let firstPageRequested: number | undefined;

						const mockFetcher: PageFetcher<TestRecord> = async (page, reqPageSize) => {
							if (firstPageRequested === undefined) {
								firstPageRequested = page;
							}

							// Calculate slice for this page
							const startIndex = (page - 1) * reqPageSize;
							const endIndex = Math.min(startIndex + reqPageSize, totalRecords);
							const records: TestRecord[] = [];
							for (let i = startIndex; i < endIndex; i++) {
								records.push({ id: i + 1, value: `record-${i + 1}` });
							}

							return {
								page,
								pageSize: reqPageSize,
								sortKey: 'id',
								sortDirection: 'ascending',
								totalRecords,
								records
							};
						};

						await collectAllPages(mockFetcher, { pageSize, startPage });

						// First page requested should be the startPage
						expect(firstPageRequested).toBe(startPage);
					}
				),
				{ numRuns: 100 }
			);
		});
	});
});
