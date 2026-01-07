import type { SerializedScheduledJob } from '$lib/components/dashboard/types';
import { getRecentActivity } from '$lib/server/db/queries/activity';
import { getAllConnectorCompletionWithTrends } from '$lib/server/db/queries/completion';
import type { ConnectorStats } from '$lib/server/db/queries/connectors';
import { getAllConnectorStats, getAllConnectors } from '$lib/server/db/queries/connectors';
import { getContentStatusCounts } from '$lib/server/db/queries/content';
import { getTodaySearchStats } from '$lib/server/db/queries/queue';
import { getSchedulerStatus } from '$lib/server/scheduler';
import type { PageServerLoad } from './$types';

/** Job metadata for display in the dashboard */
const JOB_METADATA: Record<string, { displayName: string; description: string }> = {
	'incremental-sync-sweep': {
		displayName: 'Incremental Sync',
		description: 'Syncs content, discovers gaps/upgrades'
	},
	'full-reconciliation': {
		displayName: 'Full Reconciliation',
		description: 'Complete library sync (daily)'
	},
	'completion-snapshot': {
		displayName: 'Completion Snapshot',
		description: 'Captures stats for trends'
	},
	'queue-processor': {
		displayName: 'Queue Processor',
		description: 'Dispatches search requests'
	},
	'connector-health-check': {
		displayName: 'Health Check',
		description: 'Verifies connector status'
	},
	'prowlarr-health-check': {
		displayName: 'Prowlarr Health',
		description: 'Checks indexer status'
	},
	'throttle-window-reset': {
		displayName: 'Rate Limit Reset',
		description: 'Resets throttle counters'
	},
	'notification-batch-processor': {
		displayName: 'Notifications',
		description: 'Processes notification batches'
	},
	'queue-depth-sampler': {
		displayName: 'Queue Sampler',
		description: 'Samples queue depth for analytics'
	},
	'analytics-hourly-aggregation': {
		displayName: 'Hourly Stats',
		description: 'Aggregates events to hourly stats'
	},
	'analytics-daily-aggregation': {
		displayName: 'Daily Stats',
		description: 'Aggregates hourly to daily stats'
	},
	'db-maintenance': {
		displayName: 'DB Maintenance',
		description: 'Database optimization (VACUUM)'
	}
};

export const load: PageServerLoad = async ({ parent }) => {
	const parentData = await parent();

	// Get scheduler status (synchronous, no Promise needed)
	const schedulerStatus = getSchedulerStatus();

	// Fetch all dashboard data in parallel
	const [connectors, statsMap, contentStats, todayStats, recentActivity, completionData] =
		await Promise.all([
			getAllConnectors(),
			getAllConnectorStats(),
			getContentStatusCounts(),
			getTodaySearchStats(),
			getRecentActivity(15),
			getAllConnectorCompletionWithTrends(14) // 14 days of trend data
		]);

	const stats: Record<number, ConnectorStats> = {};
	for (const [id, stat] of statsMap) {
		stats[id] = stat;
	}

	const activities = recentActivity.map((activity) => ({
		...activity,
		timestamp: activity.timestamp.toISOString()
	}));

	const completionWithSerializedTrends = completionData.map((data) => ({
		...data,
		trend: data.trend.map((point) => ({
			...point,
			capturedAt: point.capturedAt.toISOString()
		}))
	}));

	const scheduledJobs: SerializedScheduledJob[] = schedulerStatus.jobs.map((job) => {
		const metadata = JOB_METADATA[job.name] ?? {
			displayName: job.name,
			description: 'Scheduled task'
		};
		return {
			name: job.name,
			displayName: metadata.displayName,
			description: metadata.description,
			isRunning: job.isRunning,
			nextRun: job.nextRun?.toISOString() ?? null
		};
	});

	return {
		...parentData,
		connectors,
		stats,
		contentStats,
		todayStats,
		activities,
		completionData: completionWithSerializedTrends,
		scheduledJobs
	};
};
