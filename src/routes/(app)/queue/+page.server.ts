/**
 * Queue management page server load.
 *
 * Requirements: 18.1
 * - Display items in priority order
 * - Show estimated dispatch time
 * - Show current processing indicator
 */

import type { PageServerLoad } from './$types';
import {
	getQueueList,
	getConnectorsForQueueFilter,
	getQueueStatusCounts,
	getAllThrottleInfo,
	parseQueueFilters
} from '$lib/server/db/queries/queue';

export const load: PageServerLoad = async ({ url }) => {
	// Parse filters from URL params
	const filters = parseQueueFilters(url.searchParams);

	// Load data in parallel for efficiency
	const [queueResult, connectors, statusCounts, throttleInfoMap] = await Promise.all([
		getQueueList(filters),
		getConnectorsForQueueFilter(),
		getQueueStatusCounts(filters.connectorId),
		getAllThrottleInfo()
	]);

	// Convert Map to serializable object
	const throttleInfo: Record<number, {
		connectorId: number;
		isPaused: boolean;
		pausedUntil: string | null;
		pauseReason: string | null;
		requestsPerMinute: number;
		requestsThisMinute: number;
		dailyBudget: number | null;
		requestsToday: number;
	}> = {};

	for (const [connectorId, info] of throttleInfoMap) {
		throttleInfo[connectorId] = {
			...info,
			pausedUntil: info.pausedUntil?.toISOString() ?? null
		};
	}

	return {
		queue: queueResult.items.map((item) => ({
			...item,
			scheduledAt: item.scheduledAt?.toISOString() ?? null,
			createdAt: item.createdAt.toISOString()
		})),
		total: queueResult.total,
		connectors,
		statusCounts,
		throttleInfo,
		filters
	};
};
