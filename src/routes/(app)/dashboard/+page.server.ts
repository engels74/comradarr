import { getAllConnectors, getAllConnectorStats } from '$lib/server/db/queries/connectors';
import type { ConnectorStats } from '$lib/server/db/queries/connectors';
import { getContentStatusCounts } from '$lib/server/db/queries/content';
import { getTodaySearchStats } from '$lib/server/db/queries/queue';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const parentData = await parent();

	// Fetch all dashboard data in parallel
	const [connectors, statsMap, contentStats, todayStats] = await Promise.all([
		getAllConnectors(),
		getAllConnectorStats(),
		getContentStatusCounts(),
		getTodaySearchStats()
	]);

	// Convert Map to plain object for serialization
	const stats: Record<number, ConnectorStats> = {};
	for (const [id, stat] of statsMap) {
		stats[id] = stat;
	}

	return {
		...parentData,
		connectors,
		stats,
		contentStats,
		todayStats
	};
};
