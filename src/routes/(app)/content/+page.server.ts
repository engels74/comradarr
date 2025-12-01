/**
 * Content browser page server load.
 *
 * Requirements: 17.1, 17.2
 * - Filters for connector, content type, and status
 * - Title search with URL-based state
 * - Sortable columns
 */

import type { PageServerLoad } from './$types';
import {
	getContentList,
	getConnectorsForFilter,
	getContentStatusCounts,
	parseContentFilters,
	type ContentFilters
} from '$lib/server/db/queries/content';

export const load: PageServerLoad = async ({ url }) => {
	// Parse filters from URL params
	const filters = parseContentFilters(url.searchParams);

	// Load data in parallel for efficiency
	const [contentResult, connectors, statusCounts] = await Promise.all([
		getContentList(filters),
		getConnectorsForFilter(),
		getContentStatusCounts(filters.connectorId)
	]);

	return {
		content: contentResult.items,
		total: contentResult.total,
		connectors,
		statusCounts,
		filters
	};
};
