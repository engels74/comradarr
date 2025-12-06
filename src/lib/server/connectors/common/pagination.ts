/**
 * Pagination utilities for *arr API clients
 *
 * Provides async iteration over paginated API responses.
 *
 * @module connectors/common/pagination

 */

import type { PaginatedResponse } from './types.js';

/**
 * Default page size for API requests (per Requirement 29.1)
 */
export const DEFAULT_PAGE_SIZE = 1000;

/**
 * Options for pagination iteration
 */
export interface FetchAllPagesOptions {
	/** Page size for requests (default: 1000 per Requirement 29.1) */
	pageSize?: number;
	/** Starting page number (default: 1) */
	startPage?: number;
}

/**
 * Page fetcher function signature
 *
 * @template T - The type of records in the paginated response
 * @param page - The page number to fetch (1-indexed)
 * @param pageSize - The number of records per page
 * @returns Promise resolving to a paginated response
 */
export type PageFetcher<T> = (page: number, pageSize: number) => Promise<PaginatedResponse<T>>;

/**
 * Async generator that yields records from all pages of a paginated API response.
 *
 * Continues fetching pages until `page * pageSize >= totalRecords` (Requirement 29.2).
 * Uses default pageSize of 1000 per Requirement 29.1.
 *
 * @template T - The type of records being fetched
 * @param fetcher - Async function that fetches a single page of results
 * @param options - Pagination options (pageSize, startPage)
 * @yields Individual records from each page
 *
 * @example
 * ```typescript
 * // Fetch all missing movies from Radarr
 * const fetcher: PageFetcher<Movie> = async (page, pageSize) => {
 *   const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
 *   return await client.request<PaginatedResponse<Movie>>(`wanted/missing?${params}`);
 * };
 *
 * for await (const movie of fetchAllPages(fetcher)) {
 *   console.log(movie.title);
 * }
 * ```
 *

 */
export async function* fetchAllPages<T>(
	fetcher: PageFetcher<T>,
	options?: FetchAllPagesOptions
): AsyncGenerator<T, void, unknown> {
	const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE;
	let page = options?.startPage ?? 1;

	while (true) {
		const response = await fetcher(page, pageSize);

		// Yield each record from the current page
		for (const record of response.records) {
			yield record;
		}

		// Check termination condition (Requirement 29.2)
		// Continue until page * pageSize >= totalRecords
		if (page * pageSize >= response.totalRecords) {
			break;
		}

		page++;
	}
}

/**
 * Collect all records from a paginated API response into a single array.
 *
 * This is a convenience wrapper around `fetchAllPages` that collects all
 * yielded records into an array. Useful for cases where all records need
 * to be processed together rather than streamed.
 *
 * @template T - The type of records being fetched
 * @param fetcher - Async function that fetches a single page of results
 * @param options - Pagination options (pageSize, startPage)
 * @returns Promise resolving to array of all records across all pages
 *
 * @example
 * ```typescript
 * const allMovies = await collectAllPages<Movie>(async (page, pageSize) => {
 *   const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
 *   return await client.request<PaginatedResponse<Movie>>(`wanted/missing?${params}`);
 * });
 *
 * console.log(`Total movies: ${allMovies.length}`);
 * ```
 *

 */
export async function collectAllPages<T>(
	fetcher: PageFetcher<T>,
	options?: FetchAllPagesOptions
): Promise<T[]> {
	const results: T[] = [];

	for await (const record of fetchAllPages(fetcher, options)) {
		results.push(record);
	}

	return results;
}

/**
 * Metadata about a completed pagination operation
 */
export interface PaginationMetadata {
	/** Total number of records fetched */
	totalRecords: number;
	/** Number of pages fetched */
	pagesFetched: number;
	/** Page size used */
	pageSize: number;
}

/**
 * Collect all records with metadata about the pagination operation.
 *
 * Similar to `collectAllPages` but also returns metadata about how many
 * pages were fetched and the total record count.
 *
 * @template T - The type of records being fetched
 * @param fetcher - Async function that fetches a single page of results
 * @param options - Pagination options (pageSize, startPage)
 * @returns Promise resolving to records and pagination metadata
 *
 * @example
 * ```typescript
 * const { records, metadata } = await collectAllPagesWithMetadata<Movie>(fetcher);
 * console.log(`Fetched ${records.length} records in ${metadata.pagesFetched} pages`);
 * ```
 */
export async function collectAllPagesWithMetadata<T>(
	fetcher: PageFetcher<T>,
	options?: FetchAllPagesOptions
): Promise<{ records: T[]; metadata: PaginationMetadata }> {
	const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE;
	let page = options?.startPage ?? 1;
	let totalRecords = 0;
	const records: T[] = [];

	while (true) {
		const response = await fetcher(page, pageSize);

		// Update metadata from first page (totalRecords is consistent across pages)
		if (page === (options?.startPage ?? 1)) {
			totalRecords = response.totalRecords;
		}

		// Collect records from current page
		records.push(...response.records);

		// Check termination condition (Requirement 29.2)
		if (page * pageSize >= response.totalRecords) {
			break;
		}

		page++;
	}

	return {
		records,
		metadata: {
			totalRecords,
			pagesFetched: page - (options?.startPage ?? 1) + 1,
			pageSize
		}
	};
}
