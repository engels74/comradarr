import { getAllConnectors, getAllConnectorStats } from '$lib/server/db/queries/connectors';
import type { ConnectorStats } from '$lib/server/db/queries/connectors';
import { getContentStatusCounts } from '$lib/server/db/queries/content';
import { getTodaySearchStats } from '$lib/server/db/queries/queue';
import { getRecentActivity } from '$lib/server/db/queries/activity';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const parentData = await parent();

	// Fetch all dashboard data in parallel
	const [connectors, statsMap, contentStats, todayStats, recentActivity] = await Promise.all([
		getAllConnectors(),
		getAllConnectorStats(),
		getContentStatusCounts(),
		getTodaySearchStats(),
		getRecentActivity(15)
	]);

	// Convert Map to plain object for serialization
	const stats: Record<number, ConnectorStats> = {};
	for (const [id, stat] of statsMap) {
		stats[id] = stat;
	}

	// Serialize activity timestamps to ISO strings
	const activities = recentActivity.map((activity) => ({
		...activity,
		timestamp: activity.timestamp.toISOString()
	}));

	return {
		...parentData,
		connectors,
		stats,
		contentStats,
		todayStats,
		activities
	};
};
