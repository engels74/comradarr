/**
 * Database queries for library completion tracking.
 *
 *
 * Provides:
 * - Current completion stats per connector
 * - Historical snapshots for trend visualization (sparklines)
 * - Snapshot capture for scheduler
 * - Cleanup of old snapshots
 */

import { db } from '$lib/server/db';
import {
	completionSnapshots,
	connectors,
	episodes,
	movies,
	type CompletionSnapshot
} from '$lib/server/db/schema';
import { and, count, desc, eq, lt, sql } from 'drizzle-orm';

// =============================================================================
// Types
// =============================================================================

/**
 * Current completion stats for a single connector.
 */
export interface ConnectorCompletionStats {
	connectorId: number;
	connectorName: string;
	connectorType: string;
	episodesMonitored: number;
	episodesDownloaded: number;
	moviesMonitored: number;
	moviesDownloaded: number;
	totalMonitored: number;
	totalDownloaded: number;
	completionPercentage: number; // 0-100 with 2 decimal precision
}

/**
 * Historical snapshot point for sparkline.
 */
export interface CompletionDataPoint {
	capturedAt: Date;
	completionPercentage: number; // 0-100
}

/**
 * Completion stats with historical trend data.
 */
export interface ConnectorCompletionWithTrend extends ConnectorCompletionStats {
	trend: CompletionDataPoint[];
	trendDelta: number; // Change from oldest to newest point
}

// =============================================================================
// Current Completion Queries
// =============================================================================

/**
 * Gets current completion stats for all connectors.
 * Runs parallel queries for efficiency.
 *
 * @returns Array of completion stats per connector
 */
export async function getAllConnectorCompletionStats(): Promise<ConnectorCompletionStats[]> {
	// Get all connectors
	const allConnectors = await db
		.select({
			id: connectors.id,
			name: connectors.name,
			type: connectors.type
		})
		.from(connectors)
		.orderBy(connectors.name);

	if (allConnectors.length === 0) {
		return [];
	}

	// Count episodes per connector (monitored and downloaded)
	const episodeStats = await db
		.select({
			connectorId: episodes.connectorId,
			monitored: sql<number>`COUNT(*) FILTER (WHERE ${episodes.monitored} = true)::int`.as(
				'monitored'
			),
			downloaded:
				sql<number>`COUNT(*) FILTER (WHERE ${episodes.monitored} = true AND ${episodes.hasFile} = true)::int`.as(
					'downloaded'
				)
		})
		.from(episodes)
		.groupBy(episodes.connectorId);

	// Count movies per connector (monitored and downloaded)
	const movieStats = await db
		.select({
			connectorId: movies.connectorId,
			monitored: sql<number>`COUNT(*) FILTER (WHERE ${movies.monitored} = true)::int`.as(
				'monitored'
			),
			downloaded:
				sql<number>`COUNT(*) FILTER (WHERE ${movies.monitored} = true AND ${movies.hasFile} = true)::int`.as(
					'downloaded'
				)
		})
		.from(movies)
		.groupBy(movies.connectorId);

	// Build lookup maps
	const episodeMap = new Map(episodeStats.map((e) => [e.connectorId, e]));
	const movieMap = new Map(movieStats.map((m) => [m.connectorId, m]));

	// Combine results
	return allConnectors.map((connector) => {
		const epStats = episodeMap.get(connector.id);
		const mvStats = movieMap.get(connector.id);

		const episodesMonitored = epStats?.monitored ?? 0;
		const episodesDownloaded = epStats?.downloaded ?? 0;
		const moviesMonitored = mvStats?.monitored ?? 0;
		const moviesDownloaded = mvStats?.downloaded ?? 0;

		const totalMonitored = episodesMonitored + moviesMonitored;
		const totalDownloaded = episodesDownloaded + moviesDownloaded;
		const completionPercentage =
			totalMonitored > 0 ? Math.round((totalDownloaded / totalMonitored) * 10000) / 100 : 0;

		return {
			connectorId: connector.id,
			connectorName: connector.name,
			connectorType: connector.type,
			episodesMonitored,
			episodesDownloaded,
			moviesMonitored,
			moviesDownloaded,
			totalMonitored,
			totalDownloaded,
			completionPercentage
		};
	});
}

/**
 * Gets current completion stats for a single connector.
 *
 * @param connectorId - Connector ID
 * @returns Completion stats or null if connector not found
 */
export async function getConnectorCompletionStats(
	connectorId: number
): Promise<ConnectorCompletionStats | null> {
	const all = await getAllConnectorCompletionStats();
	return all.find((s) => s.connectorId === connectorId) ?? null;
}

// =============================================================================
// Historical Trend Queries
// =============================================================================

/**
 * Gets historical completion snapshots for a connector.
 * Returns up to `limit` most recent snapshots in chronological order.
 *
 * @param connectorId - Connector ID
 * @param limit - Maximum snapshots to return (default 14 for 2 weeks)
 * @returns Array of data points in chronological order (oldest first)
 */
export async function getCompletionTrend(
	connectorId: number,
	limit: number = 14
): Promise<CompletionDataPoint[]> {
	const snapshots = await db
		.select({
			capturedAt: completionSnapshots.capturedAt,
			completionPercentage: completionSnapshots.completionPercentage
		})
		.from(completionSnapshots)
		.where(eq(completionSnapshots.connectorId, connectorId))
		.orderBy(desc(completionSnapshots.capturedAt))
		.limit(limit);

	// Return in chronological order (oldest first) for sparkline
	return snapshots
		.map((s) => ({
			capturedAt: s.capturedAt,
			completionPercentage: s.completionPercentage / 100 // Convert from basis points
		}))
		.reverse();
}

/**
 * Gets completion stats with trend data for all connectors.
 * Optimized for dashboard display.
 *
 * @param trendDays - Number of days of trend data to include (default 14)
 * @returns Array of completion stats with trend data
 */
export async function getAllConnectorCompletionWithTrends(
	trendDays: number = 14
): Promise<ConnectorCompletionWithTrend[]> {
	// Get current stats
	const currentStats = await getAllConnectorCompletionStats();

	if (currentStats.length === 0) {
		return [];
	}

	// Get trends for all connectors in parallel
	const trendsPromises = currentStats.map((stats) =>
		getCompletionTrend(stats.connectorId, trendDays)
	);
	const trends = await Promise.all(trendsPromises);

	// Combine stats with trends
	return currentStats.map((stats, index) => {
		const trend = trends[index] ?? [];
		const trendDelta =
			trend.length >= 2
				? trend[trend.length - 1]!.completionPercentage - trend[0]!.completionPercentage
				: 0;

		return {
			...stats,
			trend,
			trendDelta
		};
	});
}

// =============================================================================
// Snapshot Capture (for Scheduler)
// =============================================================================

/**
 * Captures a completion snapshot for all connectors.
 * Called by the scheduler job to record current completion state.
 *
 * @returns Number of snapshots captured
 */
export async function captureCompletionSnapshots(): Promise<number> {
	const stats = await getAllConnectorCompletionStats();

	if (stats.length === 0) {
		return 0;
	}

	const now = new Date();
	const snapshotValues = stats.map((s) => ({
		connectorId: s.connectorId,
		capturedAt: now,
		episodesMonitored: s.episodesMonitored,
		episodesDownloaded: s.episodesDownloaded,
		moviesMonitored: s.moviesMonitored,
		moviesDownloaded: s.moviesDownloaded,
		// Store as basis points (percentage * 100) for integer storage with precision
		completionPercentage: Math.round(s.completionPercentage * 100)
	}));

	await db.insert(completionSnapshots).values(snapshotValues);

	return snapshotValues.length;
}

// =============================================================================
// Cleanup
// =============================================================================

/**
 * Cleans up old completion snapshots beyond retention period.
 *
 * @param retentionDays - Days to keep (default 30)
 * @returns Number of snapshots deleted
 */
export async function cleanupOldSnapshots(retentionDays: number = 30): Promise<number> {
	const cutoffDate = new Date();
	cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

	const result = await db
		.delete(completionSnapshots)
		.where(lt(completionSnapshots.capturedAt, cutoffDate))
		.returning({ id: completionSnapshots.id });

	return result.length;
}
