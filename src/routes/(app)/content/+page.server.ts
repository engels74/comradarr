/**
 * Content browser page server load and actions.
 *
 * - Filters for connector, content type, and status
 * - Title search with URL-based state
 * - Sortable columns
 * - Bulk actions for selected content
 */

import { fail } from '@sveltejs/kit';
import {
	type BulkActionTarget,
	bulkClearSearchState,
	bulkMarkExhausted,
	bulkQueueForSearch,
	bulkSetPriority,
	getConnectorsForFilter,
	getContentList,
	getContentStatusCounts,
	parseContentFilters
} from '$lib/server/db/queries/content';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const filters = parseContentFilters(url.searchParams);

	const [contentResult, connectors, statusCounts] = await Promise.all([
		getContentList(filters),
		getConnectorsForFilter(),
		getContentStatusCounts(filters.connectorId)
	]);

	return {
		content: contentResult.items,
		total: contentResult.total,
		nextCursor: contentResult.nextCursor,
		connectors,
		statusCounts,
		filters
	};
};

/**
 * Parses targets from form data.
 */
function parseTargets(formData: FormData): BulkActionTarget[] {
	const targetsJson = formData.get('targets');
	if (!targetsJson || typeof targetsJson !== 'string') {
		return [];
	}

	try {
		const parsed = JSON.parse(targetsJson) as unknown;
		if (!Array.isArray(parsed)) return [];

		return parsed.filter(
			(t): t is BulkActionTarget =>
				typeof t === 'object' &&
				t !== null &&
				'type' in t &&
				'id' in t &&
				(t.type === 'series' || t.type === 'movie') &&
				typeof t.id === 'number'
		);
	} catch {
		return [];
	}
}

export const actions: Actions = {
	/**
	 * Queue selected items for search.
	 * Creates/updates search registry entries with state='pending'.
	 */
	bulkQueue: async ({ request }) => {
		const formData = await request.formData();
		const targets = parseTargets(formData);

		if (targets.length === 0) {
			return fail(400, { error: 'No items selected' });
		}

		const searchType = (formData.get('searchType') as string) || 'gap';
		if (searchType !== 'gap' && searchType !== 'upgrade') {
			return fail(400, { error: 'Invalid search type' });
		}

		const result = await bulkQueueForSearch(targets, searchType);

		return {
			success: true,
			action: 'bulkQueue',
			message: `Queued ${result.affected} item${result.affected === 1 ? '' : 's'} for search`
		};
	},

	/**
	 * Set priority for selected items.
	 * Updates search_registry.priority for matching entries.
	 */
	bulkSetPriority: async ({ request }) => {
		const formData = await request.formData();
		const targets = parseTargets(formData);

		if (targets.length === 0) {
			return fail(400, { error: 'No items selected' });
		}

		const priorityStr = formData.get('priority');
		const priority = Number(priorityStr);

		if (Number.isNaN(priority) || priority < 0 || priority > 100) {
			return fail(400, { error: 'Invalid priority value (must be 0-100)' });
		}

		const result = await bulkSetPriority(targets, priority);

		return {
			success: true,
			action: 'bulkSetPriority',
			message: `Updated priority for ${result.affected} item${result.affected === 1 ? '' : 's'}`
		};
	},

	/**
	 * Mark selected items as exhausted.
	 * Updates search_registry.state to 'exhausted' for matching entries.
	 */
	bulkMarkExhausted: async ({ request }) => {
		const formData = await request.formData();
		const targets = parseTargets(formData);

		if (targets.length === 0) {
			return fail(400, { error: 'No items selected' });
		}

		const result = await bulkMarkExhausted(targets);

		let message = `Marked ${result.affected} item${result.affected === 1 ? '' : 's'} as exhausted`;
		if (result.skipped > 0) {
			message += ` (${result.skipped} skipped - currently searching)`;
		}

		return {
			success: true,
			action: 'bulkMarkExhausted',
			message
		};
	},

	/**
	 * Clear search state for selected items.
	 * Resets search_registry to pending with attempt count reset.
	 */
	bulkClearState: async ({ request }) => {
		const formData = await request.formData();
		const targets = parseTargets(formData);

		if (targets.length === 0) {
			return fail(400, { error: 'No items selected' });
		}

		const result = await bulkClearSearchState(targets);

		let message = `Reset search state for ${result.affected} item${result.affected === 1 ? '' : 's'}`;
		if (result.skipped > 0) {
			message += ` (${result.skipped} skipped - currently searching)`;
		}

		return {
			success: true,
			action: 'bulkClearState',
			message
		};
	}
};
