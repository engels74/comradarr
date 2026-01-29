/**
 * Queue management page server load and actions.
 *
 * - Display items in priority order
 * - Show estimated dispatch time
 * - Show current processing indicator
 * - Manual priority adjustment and removal from queue
 * - Pause, resume, and clear queue actions
 * - Display recent completions with outcome indicators
 * - Real-time updates without page refresh
 */

import { fail } from '@sveltejs/kit';
import { getHealthyConnectors } from '$lib/server/db/queries/connectors';
import {
	clearQueueForConnectors,
	getAllThrottleInfo,
	getConnectorsForQueueFilter,
	getPerConnectorQueueCounts,
	getQueueList,
	getQueuePauseStatus,
	getQueueStatusCounts,
	getRecentCompletions,
	parseQueueFilters,
	pauseQueueForConnectors,
	removeFromQueueByIds,
	resumeQueueForConnectors,
	updateQueueItemPriority
} from '$lib/server/db/queries/queue';
import { getSchedulerStatus } from '$lib/server/scheduler';
import { enqueuePendingItems } from '$lib/server/services/queue';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, depends }) => {
	depends('app:queue');
	const filters = parseQueueFilters(url.searchParams);

	const [
		queueResult,
		connectors,
		statusCounts,
		throttleInfoMap,
		pauseStatus,
		recentCompletions,
		perConnectorCounts
	] = await Promise.all([
		getQueueList(filters),
		getConnectorsForQueueFilter(),
		getQueueStatusCounts(filters.connectorId),
		getAllThrottleInfo(),
		getQueuePauseStatus(),
		getRecentCompletions(25),
		getPerConnectorQueueCounts()
	]);

	const schedulerStatus = getSchedulerStatus();
	const sweepJob = schedulerStatus.jobs.find((j) => j.name === 'incremental-sync-sweep');
	const processorJob = schedulerStatus.jobs.find((j) => j.name === 'queue-processor');

	const throttleInfo: Record<
		number,
		{
			connectorId: number;
			isPaused: boolean;
			pausedUntil: string | null;
			pauseReason: string | null;
			requestsPerMinute: number;
			requestsThisMinute: number;
			dailyBudget: number | null;
			requestsToday: number;
			name: string;
			type: string;
			queuedCount: number;
			searchingCount: number;
			minuteWindowStart: string | null;
			minuteWindowExpiry: string | null;
		}
	> = {};

	for (const [connectorId, info] of throttleInfoMap) {
		const connector = connectors.find((c) => c.id === connectorId);
		const counts = perConnectorCounts.get(connectorId);
		throttleInfo[connectorId] = {
			...info,
			pausedUntil: info.pausedUntil?.toISOString() ?? null,
			name: connector?.name ?? 'Unknown',
			type: connector?.type ?? 'unknown',
			queuedCount: counts?.queuedCount ?? 0,
			searchingCount: counts?.searchingCount ?? 0,
			minuteWindowStart: info.minuteWindowStart?.toISOString() ?? null,
			minuteWindowExpiry: info.minuteWindowExpiry?.toISOString() ?? null
		};
	}

	return {
		queue: queueResult.items.map((item) => ({
			...item,
			scheduledAt: item.scheduledAt?.toISOString() ?? null,
			nextEligible: item.nextEligible?.toISOString() ?? null,
			createdAt: item.createdAt.toISOString()
		})),
		total: queueResult.total,
		connectors,
		statusCounts,
		throttleInfo,
		pauseStatus,
		filters,
		recentCompletions: recentCompletions.map((completion) => ({
			...completion,
			createdAt: completion.createdAt.toISOString()
		})),
		schedulerStatus: {
			sweep: {
				nextRun: sweepJob?.nextRun?.toISOString() ?? null,
				isRunning: sweepJob?.isRunning ?? false
			},
			processor: {
				nextRun: processorJob?.nextRun?.toISOString() ?? null,
				isRunning: processorJob?.isRunning ?? false
			}
		}
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
	},

	triggerSweep: async () => {
		const connectors = await getHealthyConnectors();

		if (connectors.length === 0) {
			return fail(400, { error: 'No healthy connectors available' });
		}

		let totalEnqueued = 0;

		for (const connector of connectors) {
			const result = await enqueuePendingItems(connector.id);
			if (result.success) {
				totalEnqueued += result.itemsEnqueued;
			}
		}

		return {
			success: true,
			action: 'triggerSweep',
			message:
				totalEnqueued > 0
					? `Enqueued ${totalEnqueued} item${totalEnqueued !== 1 ? 's' : ''}`
					: 'No pending items to enqueue'
		};
	}
};
