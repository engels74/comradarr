/**
 * Connector list page server load and actions.
 */

import {
	type ConnectorStats,
	getAllConnectorStats,
	getAllConnectors,
	updateConnector
} from '$lib/server/db/queries/connectors';
import {
	getAllProwlarrInstances,
	getIndexerHealthSummary,
	updateProwlarrInstance
} from '$lib/server/db/queries/prowlarr';
import { createLogger } from '$lib/server/logger';
import type { Actions, PageServerLoad } from './$types';

const logger = createLogger('connectors');

/**
 * Stats for a Prowlarr instance.
 */
export interface ProwlarrInstanceStats {
	instanceId: number;
	totalIndexers: number;
	rateLimitedIndexers: number;
}

export const load: PageServerLoad = async () => {
	const [connectors, statsMap, prowlarrInstances] = await Promise.all([
		getAllConnectors(),
		getAllConnectorStats(),
		getAllProwlarrInstances()
	]);

	// Convert Map to plain object for serialization
	const stats: Record<number, ConnectorStats> = {};
	for (const [id, stat] of statsMap) {
		stats[id] = stat;
	}

	// Get Prowlarr instance stats
	const prowlarrStats: Record<number, ProwlarrInstanceStats> = {};
	for (const instance of prowlarrInstances) {
		const summary = await getIndexerHealthSummary(instance.id);
		prowlarrStats[instance.id] = {
			instanceId: instance.id,
			totalIndexers: summary.totalIndexers,
			rateLimitedIndexers: summary.rateLimitedIndexers
		};
	}

	return {
		connectors,
		stats,
		prowlarrInstances,
		prowlarrStats
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

		if (Number.isNaN(id)) {
			logger.warn('Toggle connector failed - invalid ID', { rawId: data.get('id') });
			return { success: false, error: 'Invalid connector ID' };
		}

		await updateConnector(id, { enabled });

		logger.info('Connector toggled', { connectorId: id, enabled });

		return { success: true };
	},

	/**
	 * Toggle Prowlarr instance enabled status.
	 */
	toggleProwlarr: async ({ request }) => {
		const data = await request.formData();
		const id = Number(data.get('id'));
		const enabled = data.get('enabled') === 'true';

		if (Number.isNaN(id)) {
			logger.warn('Toggle Prowlarr instance failed - invalid ID', { rawId: data.get('id') });
			return { success: false, error: 'Invalid Prowlarr instance ID' };
		}

		await updateProwlarrInstance(id, { enabled });

		logger.info('Prowlarr instance toggled', { instanceId: id, enabled });

		return { success: true };
	}
};
