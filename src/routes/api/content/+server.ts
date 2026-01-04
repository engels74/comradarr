/**
 * API endpoint for paginated content list.
 * Used for "Load More" functionality with cursor-based pagination.
 *
 * Query Parameters:
 * - cursor: Base64-encoded cursor from previous response
 * - limit: Number of items to fetch (default 50, max 100)
 * - connectorId: Filter by connector ID
 * - contentType: Filter by 'series', 'movie', or 'all'
 * - status: Filter by status ('all', 'missing', 'upgrade', 'queued', 'searching', 'exhausted')
 * - search: Search by title
 * - sort: Sort column ('title', 'connector', 'year')
 * - order: Sort direction ('asc', 'desc')
 *

 */

import { error, json } from '@sveltejs/kit';
import { requireScope } from '$lib/server/auth';
import {
	type ContentFilters,
	type ContentStatus,
	type ContentType,
	decodeCursor,
	getContentList,
	type SortColumn,
	type SortDirection
} from '$lib/server/db/queries/content';
import type { RequestHandler } from './$types';

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

export const GET: RequestHandler = async ({ url, locals }) => {
	// Require read scope for read operations (Requirement 34.2)
	requireScope(locals, 'read');

	// Parse query parameters
	const cursor = url.searchParams.get('cursor') ?? undefined;
	const limitParam = url.searchParams.get('limit');
	const connectorIdParam = url.searchParams.get('connectorId');
	const contentType = url.searchParams.get('contentType') as ContentType | 'all' | null;
	const status = url.searchParams.get('status') as ContentStatus | null;
	const search = url.searchParams.get('search') ?? undefined;
	const sort = url.searchParams.get('sort') as SortColumn | null;
	const order = url.searchParams.get('order') as SortDirection | null;

	// Validate and parse limit
	let limit = DEFAULT_LIMIT;
	if (limitParam) {
		const parsed = parseInt(limitParam, 10);
		if (Number.isNaN(parsed) || parsed < 1) {
			error(400, 'Invalid limit parameter');
		}
		limit = Math.min(parsed, MAX_LIMIT);
	}

	// Parse connector ID
	let connectorId: number | undefined;
	if (connectorIdParam) {
		const parsed = parseInt(connectorIdParam, 10);
		if (Number.isNaN(parsed) || parsed < 1) {
			error(400, 'Invalid connectorId parameter');
		}
		connectorId = parsed;
	}

	// Decode cursor if provided
	let offset = 0;
	if (cursor) {
		const decoded = decodeCursor(cursor);
		if (!decoded) {
			error(400, 'Invalid cursor parameter');
		}
		// For simplicity, we continue using offset-based pagination internally
		// but expose cursor-based interface to the client
		// The cursor is used to track position for the next page
		// We use the offset parameter from URL if available, otherwise start fresh
		const offsetParam = url.searchParams.get('offset');
		if (offsetParam) {
			const parsedOffset = parseInt(offsetParam, 10);
			if (!Number.isNaN(parsedOffset) && parsedOffset >= 0) {
				offset = parsedOffset;
			}
		}
	}

	// Build filters
	const filters: ContentFilters = {
		limit,
		offset,
		cursor,
		connectorId,
		contentType: contentType ?? undefined,
		status: status ?? undefined,
		search,
		sortColumn: sort ?? undefined,
		sortDirection: order ?? undefined
	};

	const result = await getContentList(filters);

	return json({
		items: result.items,
		total: result.total,
		nextCursor: result.nextCursor
	});
};
