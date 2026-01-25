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
import { triggerManualReconnect } from '$lib/server/services/reconnect';
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

	const stats: Record<number, ConnectorStats> = {};
	for (const [id, stat] of statsMap) {
		stats[id] = stat;
	}

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
	},

	reconnect: async ({ request }) => {
		const data = await request.formData();
		const rawId = data.get('id');

		if (!rawId || typeof rawId !== 'string' || rawId.trim() === '') {
			logger.warn('Reconnect failed - missing ID');
			return { success: false, error: 'Invalid connector ID' };
		}

		const id = Number(rawId);

		if (Number.isNaN(id) || id <= 0) {
			logger.warn('Reconnect failed - invalid ID', { rawId });
			return { success: false, error: 'Invalid connector ID' };
		}

		try {
			const result = await triggerManualReconnect(id);

			if (result.success) {
				logger.info('Manual reconnection successful', {
					connectorId: id,
					connectorName: result.connectorName,
					newStatus: result.newStatus
				});

				return {
					success: true,
					message: `Reconnection successful! Status: ${result.newStatus}`
				};
			} else {
				logger.warn('Manual reconnection failed', {
					connectorId: id,
					connectorName: result.connectorName,
					error: result.error
				});

				return {
					success: false,
					error: result.error ?? 'Reconnection failed'
				};
			}
		} catch (err) {
			logger.error('Reconnect error', {
				connectorId: id,
				error: err instanceof Error ? err.message : String(err)
			});
			return { success: false, error: 'Reconnection failed unexpectedly' };
		}
	}
};
