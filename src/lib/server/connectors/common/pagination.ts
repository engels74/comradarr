import type { PaginatedResponse } from './types.js';

export const DEFAULT_PAGE_SIZE = 1000;

export interface FetchAllPagesOptions {
	/** Page size for requests (default: 1000) */
	pageSize?: number;
	/** Starting page number (default: 1) */
	startPage?: number;
}

export type PageFetcher<T> = (page: number, pageSize: number) => Promise<PaginatedResponse<T>>;

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

		// Continue until all records fetched
		if (page * pageSize >= response.totalRecords) {
			break;
		}

		page++;
	}
}

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

export interface PaginationMetadata {
	totalRecords: number;
	pagesFetched: number;
	pageSize: number;
}

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
