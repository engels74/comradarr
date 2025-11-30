/**
 * Connector list page server load and actions.
 *
 * Requirements: 16.1
 */

import type { PageServerLoad, Actions } from './$types';
import {
	getAllConnectors,
	getAllConnectorStats,
	updateConnector,
	type ConnectorStats
} from '$lib/server/db/queries/connectors';

export const load: PageServerLoad = async () => {
	const [connectors, statsMap] = await Promise.all([getAllConnectors(), getAllConnectorStats()]);

	// Convert Map to plain object for serialization
	const stats: Record<number, ConnectorStats> = {};
	for (const [id, stat] of statsMap) {
		stats[id] = stat;
	}

	return {
		connectors,
		stats
	};
};

export const actions: Actions = {
	/**
	 * Toggle connector enabled status.
	 */
	toggle: async ({ request }) => {
		const data = await request.formData();
		const id = Number(data.get('id'));
		const enabled = data.get('enabled') === 'true';

		if (isNaN(id)) {
			return { success: false, error: 'Invalid connector ID' };
		}

		await updateConnector(id, { enabled });

		return { success: true };
	}
};
