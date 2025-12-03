/**
 * Queue management page server load and actions.
 *
 * Requirements: 18.1, 18.2, 18.3
 * - Display items in priority order
 * - Show estimated dispatch time
 * - Show current processing indicator
 * - Manual priority adjustment and removal from queue
 * - Pause, resume, and clear queue actions
 */

import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	getQueueList,
	getConnectorsForQueueFilter,
	getQueueStatusCounts,
	getAllThrottleInfo,
	getQueuePauseStatus,
	parseQueueFilters,
	updateQueueItemPriority,
	removeFromQueueByIds,
	pauseQueueForConnectors,
	resumeQueueForConnectors,
	clearQueueForConnectors
} from '$lib/server/db/queries/queue';

export const load: PageServerLoad = async ({ url }) => {
	// Parse filters from URL params
	const filters = parseQueueFilters(url.searchParams);

	// Load data in parallel for efficiency
	const [queueResult, connectors, statusCounts, throttleInfoMap, pauseStatus] = await Promise.all([
		getQueueList(filters),
		getConnectorsForQueueFilter(),
		getQueueStatusCounts(filters.connectorId),
		getAllThrottleInfo(),
		getQueuePauseStatus()
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
		pauseStatus,
		filters
	};
};

/**
 * Parse registry IDs from form data.
 */
function parseRegistryIds(formData: FormData): number[] {
	const idsJson = formData.get('registryIds');
	if (!idsJson || typeof idsJson !== 'string') return [];

	try {
		const parsed = JSON.parse(idsJson) as unknown;
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((id): id is number => typeof id === 'number');
	} catch {
		return [];
	}
}

/**
 * Parse connector IDs from form data.
 */
function parseConnectorIds(formData: FormData): number[] | undefined {
	const idsJson = formData.get('connectorIds');
	if (!idsJson || typeof idsJson !== 'string') return undefined;

	// Empty string means "all connectors"
	if (idsJson === '' || idsJson === '[]') return undefined;

	try {
		const parsed = JSON.parse(idsJson) as unknown;
		if (!Array.isArray(parsed)) return undefined;
		const ids = parsed.filter((id): id is number => typeof id === 'number');
		return ids.length > 0 ? ids : undefined;
	} catch {
		return undefined;
	}
}

export const actions: Actions = {
	/**
	 * Pause queue processing for connector(s).
	 * Requirements: 18.3
	 */
	pauseQueue: async ({ request }) => {
		const formData = await request.formData();
		const connectorIds = parseConnectorIds(formData);

		const affected = await pauseQueueForConnectors(connectorIds);

		return {
			success: true,
			action: 'pauseQueue',
			message: connectorIds
				? `Paused ${affected} connector${affected !== 1 ? 's' : ''}`
				: 'Paused all connectors'
		};
	},

	/**
	 * Resume queue processing for connector(s).
	 * Requirements: 18.3
	 */
	resumeQueue: async ({ request }) => {
		const formData = await request.formData();
		const connectorIds = parseConnectorIds(formData);

		const affected = await resumeQueueForConnectors(connectorIds);

		return {
			success: true,
			action: 'resumeQueue',
			message: connectorIds
				? `Resumed ${affected} connector${affected !== 1 ? 's' : ''}`
				: 'Resumed all connectors'
		};
	},

	/**
	 * Clear queue items for connector(s).
	 * Requirements: 18.3
	 */
	clearQueue: async ({ request }) => {
		const formData = await request.formData();
		const connectorIds = parseConnectorIds(formData);

		const affected = await clearQueueForConnectors(connectorIds);

		return {
			success: true,
			action: 'clearQueue',
			message: `Cleared ${affected} item${affected !== 1 ? 's' : ''} from queue`
		};
	},

	/**
	 * Adjust priority for selected queue items.
	 * Requirements: 18.2
	 */
	adjustPriority: async ({ request }) => {
		const formData = await request.formData();
		const registryIds = parseRegistryIds(formData);

		if (registryIds.length === 0) {
			return fail(400, { error: 'No items selected' });
		}

		const priorityStr = formData.get('priority');
		if (!priorityStr || typeof priorityStr !== 'string') {
			return fail(400, { error: 'Priority value required' });
		}

		const priority = Number(priorityStr);
		if (Number.isNaN(priority) || priority < 0 || priority > 100) {
			return fail(400, { error: 'Priority must be between 0 and 100' });
		}

		const affected = await updateQueueItemPriority(registryIds, priority);

		return {
			success: true,
			action: 'adjustPriority',
			message: `Updated priority for ${affected} item${affected !== 1 ? 's' : ''}`
		};
	},

	/**
	 * Remove selected items from queue.
	 * Requirements: 18.2
	 */
	removeFromQueue: async ({ request }) => {
		const formData = await request.formData();
		const registryIds = parseRegistryIds(formData);

		if (registryIds.length === 0) {
			return fail(400, { error: 'No items selected' });
		}

		const affected = await removeFromQueueByIds(registryIds);

		return {
			success: true,
			action: 'removeFromQueue',
			message: `Removed ${affected} item${affected !== 1 ? 's' : ''} from queue`
		};
	}
};
