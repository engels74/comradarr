import { getAllConnectors, getAllConnectorStats } from '$lib/server/db/queries/connectors';
import type { ConnectorStats } from '$lib/server/db/queries/connectors';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const parentData = await parent();

	// Fetch connectors and statistics in parallel
	const [connectors, statsMap] = await Promise.all([
		getAllConnectors(),
		getAllConnectorStats()
	]);

	// Convert Map to plain object for serialization
	const stats: Record<number, ConnectorStats> = {};
	for (const [id, stat] of statsMap) {
		stats[id] = stat;
	}

	return {
		...parentData,
		connectors,
		stats
	};
};
