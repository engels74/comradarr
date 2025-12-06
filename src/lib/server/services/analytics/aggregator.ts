/**
 * Analytics Aggregator for hourly/daily statistics rollup.
 *
 * Aggregates raw events from analytics_events into pre-computed
 * statistics in analytics_hourly_stats and analytics_daily_stats.
 *
 * @module services/analytics/aggregator

 */

import { db } from '$lib/server/db';
import {
	analyticsEvents,
	analyticsHourlyStats,
	analyticsDailyStats,
	connectors
} from '$lib/server/db/schema';
import { sql, and, gte, lt, eq } from 'drizzle-orm';
import type { AggregationResult } from './types';

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Truncates a date to the start of the hour (UTC).
 *
 * @param date - Date to truncate
 * @returns New Date object truncated to hour
 */
function truncateToHour(date: Date): Date {
	const result = new Date(date);
	result.setUTCMinutes(0, 0, 0);
	return result;
}

/**
 * Truncates a date to the start of the day (midnight UTC).
 *
 * @param date - Date to truncate
 * @returns New Date object truncated to day
 */
function truncateToDay(date: Date): Date {
	const result = new Date(date);
	result.setUTCHours(0, 0, 0, 0);
	return result;
}

// =============================================================================
// Aggregation Functions
// =============================================================================

/**
 * Aggregates raw events for a specific hour into analytics_hourly_stats.
 *
 * Queries analytics_events for the specified hour window and computes
 * aggregate statistics for each connector. Uses UPSERT to handle
 * idempotent re-aggregation.
 *
 * @param hourBucket - The hour to aggregate (will be truncated to hour)
 * @returns Aggregation result with statistics
 */
export async function aggregateHourlyStats(hourBucket: Date): Promise<AggregationResult> {
	const startTime = Date.now();
	const hourStart = truncateToHour(hourBucket);
	const hourEnd = new Date(hourStart.getTime() + 60 * 60 * 1000);

	try {
		// Get all enabled connectors
		const enabledConnectors = await db
			.select({ id: connectors.id })
			.from(connectors)
			.where(eq(connectors.enabled, true));

		let statsUpdated = 0;
		let eventsProcessed = 0;

		for (const connector of enabledConnectors) {
			// Aggregate events for this connector in this hour
			const aggregation = await db
				.select({
					gapsDiscovered: sql<number>`
						COALESCE(SUM(CASE WHEN event_type = 'gap_discovered'
							THEN (event_data->>'registriesCreated')::int ELSE 0 END), 0)::int`,
					upgradesDiscovered: sql<number>`
						COALESCE(SUM(CASE WHEN event_type = 'upgrade_discovered'
							THEN (event_data->>'registriesCreated')::int ELSE 0 END), 0)::int`,
					searchesDispatched: sql<number>`
						COALESCE(COUNT(*) FILTER (WHERE event_type = 'search_dispatched'), 0)::int`,
					searchesSuccessful: sql<number>`
						COALESCE(COUNT(*) FILTER (WHERE event_type = 'search_completed'), 0)::int`,
					searchesFailed: sql<number>`
						COALESCE(COUNT(*) FILTER (WHERE event_type = 'search_failed'), 0)::int`,
					searchesNoResults: sql<number>`
						COALESCE(COUNT(*) FILTER (WHERE event_type = 'search_no_results'), 0)::int`,
					avgQueueDepth: sql<number>`
						COALESCE(AVG(CASE WHEN event_type = 'queue_depth_sampled'
							THEN (event_data->>'queueDepth')::int END), 0)::int`,
					peakQueueDepth: sql<number>`
						COALESCE(MAX(CASE WHEN event_type = 'queue_depth_sampled'
							THEN (event_data->>'queueDepth')::int END), 0)::int`,
					avgResponseTimeMs: sql<number | null>`
						AVG((event_data->>'responseTimeMs')::int)
						FILTER (WHERE event_data->>'responseTimeMs' IS NOT NULL)`,
					maxResponseTimeMs: sql<number | null>`
						MAX((event_data->>'responseTimeMs')::int)
						FILTER (WHERE event_data->>'responseTimeMs' IS NOT NULL)`,
					errorCount: sql<number>`
						COALESCE(COUNT(*) FILTER (WHERE event_type IN ('search_failed', 'sync_failed')), 0)::int`,
					eventCount: sql<number>`COUNT(*)::int`
				})
				.from(analyticsEvents)
				.where(
					and(
						eq(analyticsEvents.connectorId, connector.id),
						gte(analyticsEvents.createdAt, hourStart),
						lt(analyticsEvents.createdAt, hourEnd)
					)
				);

			const stats = aggregation[0];
			if (!stats || stats.eventCount === 0) {
				continue; // No events for this connector in this hour
			}

			eventsProcessed += stats.eventCount;

			// Upsert hourly stats
			await db
				.insert(analyticsHourlyStats)
				.values({
					connectorId: connector.id,
					hourBucket: hourStart,
					gapsDiscovered: stats.gapsDiscovered,
					upgradesDiscovered: stats.upgradesDiscovered,
					searchesDispatched: stats.searchesDispatched,
					searchesSuccessful: stats.searchesSuccessful,
					searchesFailed: stats.searchesFailed,
					searchesNoResults: stats.searchesNoResults,
					avgQueueDepth: stats.avgQueueDepth,
					peakQueueDepth: stats.peakQueueDepth,
					avgResponseTimeMs: stats.avgResponseTimeMs ? Math.round(stats.avgResponseTimeMs) : null,
					maxResponseTimeMs: stats.maxResponseTimeMs ? Math.round(stats.maxResponseTimeMs) : null,
					errorCount: stats.errorCount
				})
				.onConflictDoUpdate({
					target: [analyticsHourlyStats.connectorId, analyticsHourlyStats.hourBucket],
					set: {
						gapsDiscovered: stats.gapsDiscovered,
						upgradesDiscovered: stats.upgradesDiscovered,
						searchesDispatched: stats.searchesDispatched,
						searchesSuccessful: stats.searchesSuccessful,
						searchesFailed: stats.searchesFailed,
						searchesNoResults: stats.searchesNoResults,
						avgQueueDepth: stats.avgQueueDepth,
						peakQueueDepth: stats.peakQueueDepth,
						avgResponseTimeMs: stats.avgResponseTimeMs
							? Math.round(stats.avgResponseTimeMs)
							: null,
						maxResponseTimeMs: stats.maxResponseTimeMs
							? Math.round(stats.maxResponseTimeMs)
							: null,
						errorCount: stats.errorCount,
						updatedAt: new Date()
					}
				});

			statsUpdated++;
		}

		return {
			success: true,
			hourlyStatsUpdated: statsUpdated,
			dailyStatsUpdated: 0,
			eventsProcessed,
			durationMs: Date.now() - startTime
		};
	} catch (error) {
		console.error('[analytics] Hourly aggregation failed:', error);
		return {
			success: false,
			hourlyStatsUpdated: 0,
			dailyStatsUpdated: 0,
			eventsProcessed: 0,
			durationMs: Date.now() - startTime,
			error: error instanceof Error ? error.message : String(error)
		};
	}
}

/**
 * Aggregates hourly stats for a specific day into analytics_daily_stats.
 *
 * Queries analytics_hourly_stats for the specified day and computes
 * rolled-up daily statistics for each connector. Uses UPSERT to handle
 * idempotent re-aggregation.
 *
 * @param dateBucket - The day to aggregate (will be truncated to midnight UTC)
 * @returns Aggregation result with statistics
 */
export async function aggregateDailyStats(dateBucket: Date): Promise<AggregationResult> {
	const startTime = Date.now();
	const dayStart = truncateToDay(dateBucket);
	const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

	try {
		// Get all enabled connectors
		const enabledConnectors = await db
			.select({ id: connectors.id })
			.from(connectors)
			.where(eq(connectors.enabled, true));

		let statsUpdated = 0;

		for (const connector of enabledConnectors) {
			// Aggregate hourly stats for this connector on this day
			const aggregation = await db
				.select({
					gapsDiscovered: sql<number>`COALESCE(SUM(gaps_discovered), 0)::int`,
					upgradesDiscovered: sql<number>`COALESCE(SUM(upgrades_discovered), 0)::int`,
					searchesDispatched: sql<number>`COALESCE(SUM(searches_dispatched), 0)::int`,
					searchesSuccessful: sql<number>`COALESCE(SUM(searches_successful), 0)::int`,
					searchesFailed: sql<number>`COALESCE(SUM(searches_failed), 0)::int`,
					searchesNoResults: sql<number>`COALESCE(SUM(searches_no_results), 0)::int`,
					avgQueueDepth: sql<number>`COALESCE(AVG(avg_queue_depth), 0)::int`,
					peakQueueDepth: sql<number>`COALESCE(MAX(peak_queue_depth), 0)::int`,
					avgResponseTimeMs: sql<number | null>`AVG(avg_response_time_ms)`,
					maxResponseTimeMs: sql<number | null>`MAX(max_response_time_ms)`,
					errorCount: sql<number>`COALESCE(SUM(error_count), 0)::int`,
					hourCount: sql<number>`COUNT(*)::int`
				})
				.from(analyticsHourlyStats)
				.where(
					and(
						eq(analyticsHourlyStats.connectorId, connector.id),
						gte(analyticsHourlyStats.hourBucket, dayStart),
						lt(analyticsHourlyStats.hourBucket, dayEnd)
					)
				);

			const stats = aggregation[0];
			if (!stats || stats.hourCount === 0) {
				continue; // No hourly stats for this connector on this day
			}

			// Upsert daily stats
			await db
				.insert(analyticsDailyStats)
				.values({
					connectorId: connector.id,
					dateBucket: dayStart,
					gapsDiscovered: stats.gapsDiscovered,
					upgradesDiscovered: stats.upgradesDiscovered,
					searchesDispatched: stats.searchesDispatched,
					searchesSuccessful: stats.searchesSuccessful,
					searchesFailed: stats.searchesFailed,
					searchesNoResults: stats.searchesNoResults,
					avgQueueDepth: stats.avgQueueDepth,
					peakQueueDepth: stats.peakQueueDepth,
					avgResponseTimeMs: stats.avgResponseTimeMs ? Math.round(stats.avgResponseTimeMs) : null,
					maxResponseTimeMs: stats.maxResponseTimeMs ? Math.round(stats.maxResponseTimeMs) : null,
					errorCount: stats.errorCount
				})
				.onConflictDoUpdate({
					target: [analyticsDailyStats.connectorId, analyticsDailyStats.dateBucket],
					set: {
						gapsDiscovered: stats.gapsDiscovered,
						upgradesDiscovered: stats.upgradesDiscovered,
						searchesDispatched: stats.searchesDispatched,
						searchesSuccessful: stats.searchesSuccessful,
						searchesFailed: stats.searchesFailed,
						searchesNoResults: stats.searchesNoResults,
						avgQueueDepth: stats.avgQueueDepth,
						peakQueueDepth: stats.peakQueueDepth,
						avgResponseTimeMs: stats.avgResponseTimeMs
							? Math.round(stats.avgResponseTimeMs)
							: null,
						maxResponseTimeMs: stats.maxResponseTimeMs
							? Math.round(stats.maxResponseTimeMs)
							: null,
						errorCount: stats.errorCount,
						updatedAt: new Date()
					}
				});

			statsUpdated++;
		}

		return {
			success: true,
			hourlyStatsUpdated: 0,
			dailyStatsUpdated: statsUpdated,
			eventsProcessed: 0,
			durationMs: Date.now() - startTime
		};
	} catch (error) {
		console.error('[analytics] Daily aggregation failed:', error);
		return {
			success: false,
			hourlyStatsUpdated: 0,
			dailyStatsUpdated: 0,
			eventsProcessed: 0,
			durationMs: Date.now() - startTime,
			error: error instanceof Error ? error.message : String(error)
		};
	}
}

/**
 * Cleans up old analytics events older than the retention period.
 *
 * Raw events in analytics_events are cleaned up to save space.
 * Aggregated statistics in hourly/daily tables are kept for long-term analysis.
 *
 * @param retentionDays - Number of days to retain raw events (default: 7)
 * @returns Number of events deleted
 */
export async function cleanupOldEvents(retentionDays: number = 7): Promise<number> {
	try {
		const cutoff = new Date();
		cutoff.setDate(cutoff.getDate() - retentionDays);

		const deleted = await db
			.delete(analyticsEvents)
			.where(lt(analyticsEvents.createdAt, cutoff))
			.returning({ id: analyticsEvents.id });

		return deleted.length;
	} catch (error) {
		console.error('[analytics] Failed to cleanup old events:', error);
		return 0;
	}
}
