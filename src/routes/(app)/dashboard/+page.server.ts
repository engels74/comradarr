import type { SerializedScheduledJob } from '$lib/components/dashboard/types';
import type { ActivityItem } from '$lib/server/db/queries/activity';
import { getRecentActivity } from '$lib/server/db/queries/activity';
import type { ConnectorCompletionWithTrend } from '$lib/server/db/queries/completion';
import { getAllConnectorCompletionWithTrends } from '$lib/server/db/queries/completion';
import type { ConnectorStats } from '$lib/server/db/queries/connectors';
import { getAllConnectorStats, getAllConnectors } from '$lib/server/db/queries/connectors';
import type { ContentStatusCounts } from '$lib/server/db/queries/content';
import { getContentStatusCounts } from '$lib/server/db/queries/content';
import type { TodaySearchStats } from '$lib/server/db/queries/queue';
import { getTodaySearchStats } from '$lib/server/db/queries/queue';
import type { Connector } from '$lib/server/db/schema';
import { createLogger } from '$lib/server/logger';
import { getSchedulerStatus } from '$lib/server/scheduler';
import type { PageServerLoad } from './$types';

const logger = createLogger('dashboard');

export interface DashboardQueryError {
	query: string;
	message: string;
}

const USER_FRIENDLY_ERRORS: Record<string, string> = {
	connectors: 'Unable to load connectors',
	connectorStats: 'Unable to load connector statistics',
	contentStats: 'Unable to load content statistics',
	todayStats: "Unable to load today's search statistics",
	recentActivity: 'Unable to load recent activity',
	completionTrends: 'Unable to load completion trends'
};

async function safeQuery<T>(
	queryName: string,
	queryFn: () => Promise<T>,
	fallback: T
): Promise<{ data: T; error: DashboardQueryError | null }> {
	try {
		const data = await queryFn();
		return { data, error: null };
	} catch (err) {
		const detailedMessage = err instanceof Error ? err.message : String(err);
		logger.error(`Query failed: ${queryName}`, {
			query: queryName,
			error: detailedMessage,
			stack: err instanceof Error ? err.stack : undefined
		});
		const userMessage = USER_FRIENDLY_ERRORS[queryName] ?? 'An error occurred loading data';
		return { data: fallback, error: { query: queryName, message: userMessage } };
	}
}

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
	'connector-reconnect': {
		displayName: 'Auto Reconnect',
		description: 'Reconnects offline connectors'
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
	const schedulerStatus = getSchedulerStatus();
	const queryErrors: DashboardQueryError[] = [];

	// Define fallback values for graceful degradation
	const fallbacks = {
		connectors: [] as Connector[],
		statsMap: new Map<number, ConnectorStats>(),
		contentStats: {
			all: 0,
			missing: 0,
			upgrade: 0,
			queued: 0,
			searching: 0,
			exhausted: 0
		} satisfies ContentStatusCounts,
		todayStats: {
			completedToday: 0,
			successfulToday: 0,
			successRate: 0
		} satisfies TodaySearchStats,
		recentActivity: [] as ActivityItem[],
		completionData: [] as ConnectorCompletionWithTrend[]
	};

	// Execute all queries with error handling - failures return fallback values
	const [
		connectorsResult,
		statsMapResult,
		contentStatsResult,
		todayStatsResult,
		recentActivityResult,
		completionDataResult
	] = await Promise.all([
		safeQuery('connectors', getAllConnectors, fallbacks.connectors),
		safeQuery('connectorStats', getAllConnectorStats, fallbacks.statsMap),
		safeQuery('contentStats', getContentStatusCounts, fallbacks.contentStats),
		safeQuery('todayStats', getTodaySearchStats, fallbacks.todayStats),
		safeQuery('recentActivity', () => getRecentActivity(15), fallbacks.recentActivity),
		safeQuery(
			'completionTrends',
			() => getAllConnectorCompletionWithTrends(14),
			fallbacks.completionData
		)
	]);

	// Collect any errors for potential UI display
	for (const result of [
		connectorsResult,
		statsMapResult,
		contentStatsResult,
		todayStatsResult,
		recentActivityResult,
		completionDataResult
	]) {
		if (result.error) queryErrors.push(result.error);
	}

	// Extract data (fallbacks already applied by safeQuery)
	const connectors = connectorsResult.data;
	const statsMap = statsMapResult.data;
	const contentStats = contentStatsResult.data;
	const todayStats = todayStatsResult.data;
	const recentActivity = recentActivityResult.data;
	const completionData = completionDataResult.data;

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

	// Calculate queue context for queue-processor job
	const totalQueueDepth = Array.from(statsMap.values()).reduce(
		(sum, stat) => sum + stat.queueDepth,
		0
	);
	const healthyConnectorCount = connectors.filter(
		(c) => c.enabled && (c.healthStatus === 'healthy' || c.healthStatus === 'degraded')
	).length;

	const scheduledJobs: SerializedScheduledJob[] = schedulerStatus.jobs.map((job) => {
		const metadata = JOB_METADATA[job.name] ?? {
			displayName: job.name,
			description: 'Scheduled task'
		};

		const baseJob = {
			name: job.name,
			displayName: metadata.displayName,
			description: metadata.description,
			isRunning: job.isRunning,
			nextRun: job.nextRun?.toISOString() ?? null
		};

		// Add context for queue-processor
		if (job.name === 'queue-processor') {
			return { ...baseJob, context: { totalQueueDepth, healthyConnectorCount } };
		}

		return baseJob;
	});

	return {
		...parentData,
		connectors,
		stats,
		contentStats,
		todayStats,
		activities,
		completionData: completionWithSerializedTrends,
		scheduledJobs,
		queryErrors: queryErrors.length > 0 ? queryErrors : null
	};
};
