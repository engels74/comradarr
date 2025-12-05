/**
 * Database queries for analytics dashboard.
 *
 * Requirements: 12.2, 12.3, 20.1, 20.2, 20.3
 *
 * Provides queries for:
 * - Time series metrics (discovery, search volume, queue depth)
 * - Connector comparison (success rate, response time, errors)
 * - Content analysis (most searched, hardest to find, quality distribution)
 */

import { db } from '$lib/server/db';
import {
	analyticsHourlyStats,
	analyticsDailyStats,
	connectors,
	episodes,
	movies,
	searchHistory,
	searchRegistry,
	seasons,
	series
} from '$lib/server/db/schema';
import { and, count, desc, eq, gte, lte, sql, sum } from 'drizzle-orm';

// =============================================================================
// Types
// =============================================================================

export type TimePeriod = '24h' | '7d' | '30d';

export interface TimeSeriesDataPoint {
	timestamp: Date;
	value: number;
}

export interface DiscoveryMetrics {
	connectorId: number;
	connectorName: string;
	connectorType: string;
	gapsDiscovered: TimeSeriesDataPoint[];
	upgradesDiscovered: TimeSeriesDataPoint[];
}

export interface SearchMetrics {
	connectorId: number;
	connectorName: string;
	connectorType: string;
	searchesDispatched: TimeSeriesDataPoint[];
	searchesSuccessful: TimeSeriesDataPoint[];
	searchesFailed: TimeSeriesDataPoint[];
	searchesNoResults: TimeSeriesDataPoint[];
}

export interface QueueMetrics {
	connectorId: number;
	connectorName: string;
	connectorType: string;
	avgQueueDepth: TimeSeriesDataPoint[];
	peakQueueDepth: TimeSeriesDataPoint[];
}

export interface ConnectorStats {
	connectorId: number;
	connectorName: string;
	connectorType: string;
	totalSearches: number;
	successfulSearches: number;
	failedSearches: number;
	successRate: number;
	avgResponseTimeMs: number | null;
	maxResponseTimeMs: number | null;
	errorCount: number;
	errorRate: number;
}

export interface MostSearchedItem {
	contentType: 'episode' | 'movie';
	contentId: number;
	title: string;
	seriesTitle: string | null;
	seasonNumber: number | null;
	episodeNumber: number | null;
	connectorName: string;
	searchCount: number;
	lastSearched: Date;
}

export interface HardestToFindItem {
	contentType: 'episode' | 'movie';
	contentId: number;
	title: string;
	seriesTitle: string | null;
	seasonNumber: number | null;
	episodeNumber: number | null;
	connectorName: string;
	attemptCount: number;
	state: string;
	daysSinceCreated: number;
}

export interface QualityDistribution {
	qualityName: string;
	count: number;
	percentage: number;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Gets the start date for a time period.
 */
function getStartDate(period: TimePeriod): Date {
	const now = new Date();
	switch (period) {
		case '24h':
			return new Date(now.getTime() - 24 * 60 * 60 * 1000);
		case '7d':
			return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
		case '30d':
			return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
	}
}

/**
 * Determines whether to use hourly or daily stats based on period.
 */
function useHourlyStats(period: TimePeriod): boolean {
	return period === '24h' || period === '7d';
}

// =============================================================================
// Discovery Metrics Query
// =============================================================================

/**
 * Gets discovery metrics (gaps and upgrades discovered) over time.
 *
 * Requirements: 20.1
 */
export async function getDiscoveryMetrics(period: TimePeriod): Promise<DiscoveryMetrics[]> {
	const startDate = getStartDate(period);

	if (useHourlyStats(period)) {
		// Query hourly stats
		const results = await db
			.select({
				connectorId: analyticsHourlyStats.connectorId,
				connectorName: connectors.name,
				connectorType: connectors.type,
				timestamp: analyticsHourlyStats.hourBucket,
				gapsDiscovered: analyticsHourlyStats.gapsDiscovered,
				upgradesDiscovered: analyticsHourlyStats.upgradesDiscovered
			})
			.from(analyticsHourlyStats)
			.innerJoin(connectors, eq(analyticsHourlyStats.connectorId, connectors.id))
			.where(gte(analyticsHourlyStats.hourBucket, startDate))
			.orderBy(analyticsHourlyStats.connectorId, analyticsHourlyStats.hourBucket);

		return groupByConnector(results, (row) => ({
			gapsDiscovered: { timestamp: row.timestamp, value: row.gapsDiscovered },
			upgradesDiscovered: { timestamp: row.timestamp, value: row.upgradesDiscovered }
		}));
	} else {
		// Query daily stats for 30d
		const results = await db
			.select({
				connectorId: analyticsDailyStats.connectorId,
				connectorName: connectors.name,
				connectorType: connectors.type,
				timestamp: analyticsDailyStats.dateBucket,
				gapsDiscovered: analyticsDailyStats.gapsDiscovered,
				upgradesDiscovered: analyticsDailyStats.upgradesDiscovered
			})
			.from(analyticsDailyStats)
			.innerJoin(connectors, eq(analyticsDailyStats.connectorId, connectors.id))
			.where(gte(analyticsDailyStats.dateBucket, startDate))
			.orderBy(analyticsDailyStats.connectorId, analyticsDailyStats.dateBucket);

		return groupByConnector(results, (row) => ({
			gapsDiscovered: { timestamp: row.timestamp, value: row.gapsDiscovered },
			upgradesDiscovered: { timestamp: row.timestamp, value: row.upgradesDiscovered }
		}));
	}
}

/**
 * Helper to group time series data by connector.
 */
function groupByConnector<T extends { connectorId: number; connectorName: string; connectorType: string }>(
	rows: T[],
	extractPoints: (row: T) => { gapsDiscovered: TimeSeriesDataPoint; upgradesDiscovered: TimeSeriesDataPoint }
): DiscoveryMetrics[] {
	const map = new Map<number, DiscoveryMetrics>();

	for (const row of rows) {
		let metrics = map.get(row.connectorId);
		if (!metrics) {
			metrics = {
				connectorId: row.connectorId,
				connectorName: row.connectorName,
				connectorType: row.connectorType,
				gapsDiscovered: [],
				upgradesDiscovered: []
			};
			map.set(row.connectorId, metrics);
		}

		const points = extractPoints(row);
		metrics.gapsDiscovered.push(points.gapsDiscovered);
		metrics.upgradesDiscovered.push(points.upgradesDiscovered);
	}

	return Array.from(map.values());
}

// =============================================================================
// Search Metrics Query
// =============================================================================

/**
 * Gets search volume metrics over time.
 *
 * Requirements: 20.1
 */
export async function getSearchMetrics(period: TimePeriod): Promise<SearchMetrics[]> {
	const startDate = getStartDate(period);

	if (useHourlyStats(period)) {
		const results = await db
			.select({
				connectorId: analyticsHourlyStats.connectorId,
				connectorName: connectors.name,
				connectorType: connectors.type,
				timestamp: analyticsHourlyStats.hourBucket,
				searchesDispatched: analyticsHourlyStats.searchesDispatched,
				searchesSuccessful: analyticsHourlyStats.searchesSuccessful,
				searchesFailed: analyticsHourlyStats.searchesFailed,
				searchesNoResults: analyticsHourlyStats.searchesNoResults
			})
			.from(analyticsHourlyStats)
			.innerJoin(connectors, eq(analyticsHourlyStats.connectorId, connectors.id))
			.where(gte(analyticsHourlyStats.hourBucket, startDate))
			.orderBy(analyticsHourlyStats.connectorId, analyticsHourlyStats.hourBucket);

		return groupSearchMetrics(results);
	} else {
		const results = await db
			.select({
				connectorId: analyticsDailyStats.connectorId,
				connectorName: connectors.name,
				connectorType: connectors.type,
				timestamp: analyticsDailyStats.dateBucket,
				searchesDispatched: analyticsDailyStats.searchesDispatched,
				searchesSuccessful: analyticsDailyStats.searchesSuccessful,
				searchesFailed: analyticsDailyStats.searchesFailed,
				searchesNoResults: analyticsDailyStats.searchesNoResults
			})
			.from(analyticsDailyStats)
			.innerJoin(connectors, eq(analyticsDailyStats.connectorId, connectors.id))
			.where(gte(analyticsDailyStats.dateBucket, startDate))
			.orderBy(analyticsDailyStats.connectorId, analyticsDailyStats.dateBucket);

		return groupSearchMetrics(results);
	}
}

function groupSearchMetrics<
	T extends {
		connectorId: number;
		connectorName: string;
		connectorType: string;
		timestamp: Date;
		searchesDispatched: number;
		searchesSuccessful: number;
		searchesFailed: number;
		searchesNoResults: number;
	}
>(rows: T[]): SearchMetrics[] {
	const map = new Map<number, SearchMetrics>();

	for (const row of rows) {
		let metrics = map.get(row.connectorId);
		if (!metrics) {
			metrics = {
				connectorId: row.connectorId,
				connectorName: row.connectorName,
				connectorType: row.connectorType,
				searchesDispatched: [],
				searchesSuccessful: [],
				searchesFailed: [],
				searchesNoResults: []
			};
			map.set(row.connectorId, metrics);
		}

		metrics.searchesDispatched.push({ timestamp: row.timestamp, value: row.searchesDispatched });
		metrics.searchesSuccessful.push({ timestamp: row.timestamp, value: row.searchesSuccessful });
		metrics.searchesFailed.push({ timestamp: row.timestamp, value: row.searchesFailed });
		metrics.searchesNoResults.push({ timestamp: row.timestamp, value: row.searchesNoResults });
	}

	return Array.from(map.values());
}

// =============================================================================
// Queue Metrics Query
// =============================================================================

/**
 * Gets queue depth metrics over time.
 *
 * Requirements: 20.1
 */
export async function getQueueMetrics(period: TimePeriod): Promise<QueueMetrics[]> {
	const startDate = getStartDate(period);

	if (useHourlyStats(period)) {
		const results = await db
			.select({
				connectorId: analyticsHourlyStats.connectorId,
				connectorName: connectors.name,
				connectorType: connectors.type,
				timestamp: analyticsHourlyStats.hourBucket,
				avgQueueDepth: analyticsHourlyStats.avgQueueDepth,
				peakQueueDepth: analyticsHourlyStats.peakQueueDepth
			})
			.from(analyticsHourlyStats)
			.innerJoin(connectors, eq(analyticsHourlyStats.connectorId, connectors.id))
			.where(gte(analyticsHourlyStats.hourBucket, startDate))
			.orderBy(analyticsHourlyStats.connectorId, analyticsHourlyStats.hourBucket);

		return groupQueueMetrics(results);
	} else {
		const results = await db
			.select({
				connectorId: analyticsDailyStats.connectorId,
				connectorName: connectors.name,
				connectorType: connectors.type,
				timestamp: analyticsDailyStats.dateBucket,
				avgQueueDepth: analyticsDailyStats.avgQueueDepth,
				peakQueueDepth: analyticsDailyStats.peakQueueDepth
			})
			.from(analyticsDailyStats)
			.innerJoin(connectors, eq(analyticsDailyStats.connectorId, connectors.id))
			.where(gte(analyticsDailyStats.dateBucket, startDate))
			.orderBy(analyticsDailyStats.connectorId, analyticsDailyStats.dateBucket);

		return groupQueueMetrics(results);
	}
}

function groupQueueMetrics<
	T extends {
		connectorId: number;
		connectorName: string;
		connectorType: string;
		timestamp: Date;
		avgQueueDepth: number;
		peakQueueDepth: number;
	}
>(rows: T[]): QueueMetrics[] {
	const map = new Map<number, QueueMetrics>();

	for (const row of rows) {
		let metrics = map.get(row.connectorId);
		if (!metrics) {
			metrics = {
				connectorId: row.connectorId,
				connectorName: row.connectorName,
				connectorType: row.connectorType,
				avgQueueDepth: [],
				peakQueueDepth: []
			};
			map.set(row.connectorId, metrics);
		}

		metrics.avgQueueDepth.push({ timestamp: row.timestamp, value: row.avgQueueDepth });
		metrics.peakQueueDepth.push({ timestamp: row.timestamp, value: row.peakQueueDepth });
	}

	return Array.from(map.values());
}

// =============================================================================
// Connector Comparison Query
// =============================================================================

/**
 * Gets aggregated statistics per connector for comparison.
 *
 * Requirements: 12.3, 20.2
 */
export async function getConnectorComparison(period: TimePeriod): Promise<ConnectorStats[]> {
	const startDate = getStartDate(period);

	if (useHourlyStats(period)) {
		const results = await db
			.select({
				connectorId: analyticsHourlyStats.connectorId,
				connectorName: connectors.name,
				connectorType: connectors.type,
				totalSearches: sql<number>`COALESCE(SUM(${analyticsHourlyStats.searchesDispatched}), 0)::int`,
				successfulSearches: sql<number>`COALESCE(SUM(${analyticsHourlyStats.searchesSuccessful}), 0)::int`,
				failedSearches: sql<number>`COALESCE(SUM(${analyticsHourlyStats.searchesFailed} + ${analyticsHourlyStats.searchesNoResults}), 0)::int`,
				avgResponseTimeMs: sql<number | null>`AVG(${analyticsHourlyStats.avgResponseTimeMs})`,
				maxResponseTimeMs: sql<number | null>`MAX(${analyticsHourlyStats.maxResponseTimeMs})`,
				errorCount: sql<number>`COALESCE(SUM(${analyticsHourlyStats.errorCount}), 0)::int`
			})
			.from(analyticsHourlyStats)
			.innerJoin(connectors, eq(analyticsHourlyStats.connectorId, connectors.id))
			.where(gte(analyticsHourlyStats.hourBucket, startDate))
			.groupBy(analyticsHourlyStats.connectorId, connectors.name, connectors.type);

		return results.map(calculateRates);
	} else {
		const results = await db
			.select({
				connectorId: analyticsDailyStats.connectorId,
				connectorName: connectors.name,
				connectorType: connectors.type,
				totalSearches: sql<number>`COALESCE(SUM(${analyticsDailyStats.searchesDispatched}), 0)::int`,
				successfulSearches: sql<number>`COALESCE(SUM(${analyticsDailyStats.searchesSuccessful}), 0)::int`,
				failedSearches: sql<number>`COALESCE(SUM(${analyticsDailyStats.searchesFailed} + ${analyticsDailyStats.searchesNoResults}), 0)::int`,
				avgResponseTimeMs: sql<number | null>`AVG(${analyticsDailyStats.avgResponseTimeMs})`,
				maxResponseTimeMs: sql<number | null>`MAX(${analyticsDailyStats.maxResponseTimeMs})`,
				errorCount: sql<number>`COALESCE(SUM(${analyticsDailyStats.errorCount}), 0)::int`
			})
			.from(analyticsDailyStats)
			.innerJoin(connectors, eq(analyticsDailyStats.connectorId, connectors.id))
			.where(gte(analyticsDailyStats.dateBucket, startDate))
			.groupBy(analyticsDailyStats.connectorId, connectors.name, connectors.type);

		return results.map(calculateRates);
	}
}

function calculateRates(row: {
	connectorId: number;
	connectorName: string;
	connectorType: string;
	totalSearches: number;
	successfulSearches: number;
	failedSearches: number;
	avgResponseTimeMs: number | null;
	maxResponseTimeMs: number | null;
	errorCount: number;
}): ConnectorStats {
	const successRate = row.totalSearches > 0 ? Math.round((row.successfulSearches / row.totalSearches) * 100) : 0;
	const errorRate = row.totalSearches > 0 ? Math.round((row.errorCount / row.totalSearches) * 100) : 0;

	return {
		connectorId: row.connectorId,
		connectorName: row.connectorName,
		connectorType: row.connectorType,
		totalSearches: row.totalSearches,
		successfulSearches: row.successfulSearches,
		failedSearches: row.failedSearches,
		successRate,
		avgResponseTimeMs: row.avgResponseTimeMs !== null ? Math.round(row.avgResponseTimeMs) : null,
		maxResponseTimeMs: row.maxResponseTimeMs !== null ? Math.round(row.maxResponseTimeMs) : null,
		errorCount: row.errorCount,
		errorRate
	};
}

// =============================================================================
// Content Analysis Queries
// =============================================================================

/**
 * Gets the most searched content items.
 *
 * Requirements: 20.3
 */
export async function getMostSearchedItems(limit: number = 10): Promise<MostSearchedItem[]> {
	// Episode query
	const episodeQuery = db
		.select({
			contentType: sql<'episode'>`'episode'::text`.as('content_type'),
			contentId: searchHistory.contentId,
			title: sql<string>`COALESCE(${episodes.title}, 'Episode ' || ${episodes.seasonNumber} || 'x' || LPAD(${episodes.episodeNumber}::text, 2, '0'))`.as(
				'title'
			),
			seriesTitle: series.title,
			seasonNumber: episodes.seasonNumber,
			episodeNumber: episodes.episodeNumber,
			connectorName: connectors.name,
			searchCount: count(),
			lastSearched: sql<Date>`MAX(${searchHistory.createdAt})`.as('last_searched')
		})
		.from(searchHistory)
		.innerJoin(episodes, eq(searchHistory.contentId, episodes.id))
		.innerJoin(seasons, eq(episodes.seasonId, seasons.id))
		.innerJoin(series, eq(seasons.seriesId, series.id))
		.innerJoin(connectors, eq(searchHistory.connectorId, connectors.id))
		.where(eq(searchHistory.contentType, 'episode'))
		.groupBy(
			searchHistory.contentId,
			episodes.title,
			episodes.seasonNumber,
			episodes.episodeNumber,
			series.title,
			connectors.name
		);

	// Movie query
	const movieQuery = db
		.select({
			contentType: sql<'movie'>`'movie'::text`.as('content_type'),
			contentId: searchHistory.contentId,
			title: movies.title,
			seriesTitle: sql<string | null>`NULL::text`.as('series_title'),
			seasonNumber: sql<number | null>`NULL::integer`.as('season_number'),
			episodeNumber: sql<number | null>`NULL::integer`.as('episode_number'),
			connectorName: connectors.name,
			searchCount: count(),
			lastSearched: sql<Date>`MAX(${searchHistory.createdAt})`.as('last_searched')
		})
		.from(searchHistory)
		.innerJoin(movies, eq(searchHistory.contentId, movies.id))
		.innerJoin(connectors, eq(searchHistory.connectorId, connectors.id))
		.where(eq(searchHistory.contentType, 'movie'))
		.groupBy(searchHistory.contentId, movies.title, connectors.name);

	// UNION ALL and sort
	const unionQuery = sql`
		(${episodeQuery})
		UNION ALL
		(${movieQuery})
		ORDER BY search_count DESC
		LIMIT ${limit}
	`;

	const results = await db.execute(unionQuery);

	return (results as Record<string, unknown>[]).map((row) => ({
		contentType: row.content_type as 'episode' | 'movie',
		contentId: row.contentid as number,
		title: row.title as string,
		seriesTitle: row.series_title as string | null,
		seasonNumber: row.seasonnumber as number | null,
		episodeNumber: row.episodenumber as number | null,
		connectorName: row.connectorname as string,
		searchCount: Number(row.search_count),
		lastSearched: new Date(row.last_searched as string)
	}));
}

/**
 * Gets the hardest to find content (highest attempt count, still not found).
 *
 * Requirements: 20.3
 */
export async function getHardestToFindItems(limit: number = 10): Promise<HardestToFindItem[]> {
	// Episode query for items still being searched
	const episodeQuery = db
		.select({
			contentType: sql<'episode'>`'episode'::text`.as('content_type'),
			contentId: searchRegistry.contentId,
			title: sql<string>`COALESCE(${episodes.title}, 'Episode ' || ${episodes.seasonNumber} || 'x' || LPAD(${episodes.episodeNumber}::text, 2, '0'))`.as(
				'title'
			),
			seriesTitle: series.title,
			seasonNumber: episodes.seasonNumber,
			episodeNumber: episodes.episodeNumber,
			connectorName: connectors.name,
			attemptCount: searchRegistry.attemptCount,
			state: searchRegistry.state,
			daysSinceCreated: sql<number>`EXTRACT(DAY FROM NOW() - ${searchRegistry.createdAt})::int`.as(
				'days_since_created'
			)
		})
		.from(searchRegistry)
		.innerJoin(episodes, eq(searchRegistry.contentId, episodes.id))
		.innerJoin(seasons, eq(episodes.seasonId, seasons.id))
		.innerJoin(series, eq(seasons.seriesId, series.id))
		.innerJoin(connectors, eq(searchRegistry.connectorId, connectors.id))
		.where(and(eq(searchRegistry.contentType, 'episode'), sql`${searchRegistry.attemptCount} > 0`));

	// Movie query
	const movieQuery = db
		.select({
			contentType: sql<'movie'>`'movie'::text`.as('content_type'),
			contentId: searchRegistry.contentId,
			title: movies.title,
			seriesTitle: sql<string | null>`NULL::text`.as('series_title'),
			seasonNumber: sql<number | null>`NULL::integer`.as('season_number'),
			episodeNumber: sql<number | null>`NULL::integer`.as('episode_number'),
			connectorName: connectors.name,
			attemptCount: searchRegistry.attemptCount,
			state: searchRegistry.state,
			daysSinceCreated: sql<number>`EXTRACT(DAY FROM NOW() - ${searchRegistry.createdAt})::int`.as(
				'days_since_created'
			)
		})
		.from(searchRegistry)
		.innerJoin(movies, eq(searchRegistry.contentId, movies.id))
		.innerJoin(connectors, eq(searchRegistry.connectorId, connectors.id))
		.where(and(eq(searchRegistry.contentType, 'movie'), sql`${searchRegistry.attemptCount} > 0`));

	// UNION ALL and sort by attempt count
	const unionQuery = sql`
		(${episodeQuery})
		UNION ALL
		(${movieQuery})
		ORDER BY attempt_count DESC, days_since_created DESC
		LIMIT ${limit}
	`;

	const results = await db.execute(unionQuery);

	return (results as Record<string, unknown>[]).map((row) => ({
		contentType: row.content_type as 'episode' | 'movie',
		contentId: row.contentid as number,
		title: row.title as string,
		seriesTitle: row.series_title as string | null,
		seasonNumber: row.seasonnumber as number | null,
		episodeNumber: row.episodenumber as number | null,
		connectorName: row.connectorname as string,
		attemptCount: row.attemptcount as number,
		state: row.state as string,
		daysSinceCreated: row.days_since_created as number
	}));
}

/**
 * Gets the quality distribution for acquired content.
 *
 * Requirements: 20.3
 */
export async function getQualityDistribution(): Promise<QualityDistribution[]> {
	// Get quality distribution from episodes and movies that have files
	const episodeQuality = db
		.select({
			qualityName: sql<string>`${episodes.quality}->'quality'->>'name'`.as('quality_name'),
			count: count()
		})
		.from(episodes)
		.where(and(eq(episodes.hasFile, true), sql`${episodes.quality} IS NOT NULL`))
		.groupBy(sql`${episodes.quality}->'quality'->>'name'`);

	const movieQuality = db
		.select({
			qualityName: sql<string>`${movies.quality}->'quality'->>'name'`.as('quality_name'),
			count: count()
		})
		.from(movies)
		.where(and(eq(movies.hasFile, true), sql`${movies.quality} IS NOT NULL`))
		.groupBy(sql`${movies.quality}->'quality'->>'name'`);

	// UNION and aggregate
	const unionQuery = sql`
		WITH quality_counts AS (
			(${episodeQuality})
			UNION ALL
			(${movieQuality})
		)
		SELECT
			quality_name,
			SUM(count)::int as total_count
		FROM quality_counts
		WHERE quality_name IS NOT NULL
		GROUP BY quality_name
		ORDER BY total_count DESC
	`;

	const results = await db.execute(unionQuery);

	// Calculate total for percentage
	const rows = results as { quality_name: string; total_count: number }[];
	const total = rows.reduce((sum, row) => sum + row.total_count, 0);

	return rows.map((row) => ({
		qualityName: row.quality_name || 'Unknown',
		count: row.total_count,
		percentage: total > 0 ? Math.round((row.total_count / total) * 100) : 0
	}));
}

// =============================================================================
// Summary Statistics
// =============================================================================

/**
 * Gets summary statistics for the analytics dashboard.
 */
export async function getAnalyticsSummary(
	period: TimePeriod
): Promise<{
	totalSearches: number;
	successfulSearches: number;
	successRate: number;
	gapsDiscovered: number;
	upgradesDiscovered: number;
	avgResponseTimeMs: number | null;
}> {
	const startDate = getStartDate(period);

	if (useHourlyStats(period)) {
		const result = await db
			.select({
				totalSearches: sql<number>`COALESCE(SUM(${analyticsHourlyStats.searchesDispatched}), 0)::int`,
				successfulSearches: sql<number>`COALESCE(SUM(${analyticsHourlyStats.searchesSuccessful}), 0)::int`,
				gapsDiscovered: sql<number>`COALESCE(SUM(${analyticsHourlyStats.gapsDiscovered}), 0)::int`,
				upgradesDiscovered: sql<number>`COALESCE(SUM(${analyticsHourlyStats.upgradesDiscovered}), 0)::int`,
				avgResponseTimeMs: sql<number | null>`AVG(${analyticsHourlyStats.avgResponseTimeMs})`
			})
			.from(analyticsHourlyStats)
			.where(gte(analyticsHourlyStats.hourBucket, startDate));

		const row = result[0];
		const avgResponseTime = row?.avgResponseTimeMs;
		return {
			totalSearches: row?.totalSearches ?? 0,
			successfulSearches: row?.successfulSearches ?? 0,
			successRate:
				row && row.totalSearches > 0
					? Math.round((row.successfulSearches / row.totalSearches) * 100)
					: 0,
			gapsDiscovered: row?.gapsDiscovered ?? 0,
			upgradesDiscovered: row?.upgradesDiscovered ?? 0,
			avgResponseTimeMs: avgResponseTime !== null && avgResponseTime !== undefined ? Math.round(avgResponseTime) : null
		};
	} else {
		const result = await db
			.select({
				totalSearches: sql<number>`COALESCE(SUM(${analyticsDailyStats.searchesDispatched}), 0)::int`,
				successfulSearches: sql<number>`COALESCE(SUM(${analyticsDailyStats.searchesSuccessful}), 0)::int`,
				gapsDiscovered: sql<number>`COALESCE(SUM(${analyticsDailyStats.gapsDiscovered}), 0)::int`,
				upgradesDiscovered: sql<number>`COALESCE(SUM(${analyticsDailyStats.upgradesDiscovered}), 0)::int`,
				avgResponseTimeMs: sql<number | null>`AVG(${analyticsDailyStats.avgResponseTimeMs})`
			})
			.from(analyticsDailyStats)
			.where(gte(analyticsDailyStats.dateBucket, startDate));

		const row = result[0];
		const avgResponseTime = row?.avgResponseTimeMs;
		return {
			totalSearches: row?.totalSearches ?? 0,
			successfulSearches: row?.successfulSearches ?? 0,
			successRate:
				row && row.totalSearches > 0
					? Math.round((row.successfulSearches / row.totalSearches) * 100)
					: 0,
			gapsDiscovered: row?.gapsDiscovered ?? 0,
			upgradesDiscovered: row?.upgradesDiscovered ?? 0,
			avgResponseTimeMs: avgResponseTime !== null && avgResponseTime !== undefined ? Math.round(avgResponseTime) : null
		};
	}
}

// =============================================================================
// CSV Export Query (Requirement 12.4)
// =============================================================================

/**
 * Row structure for CSV export.
 */
export interface ExportRow {
	date: string;
	connector: string;
	connectorType: string;
	gapsDiscovered: number;
	upgradesDiscovered: number;
	searchesDispatched: number;
	searchesSuccessful: number;
	searchesFailed: number;
	searchesNoResults: number;
	avgQueueDepth: number;
	peakQueueDepth: number;
	avgResponseTimeMs: number | null;
	errorCount: number;
	successRate: number;
}

/**
 * Gets daily statistics for CSV export within a date range.
 *
 * Requirements: 12.4, 20.4
 *
 * @param startDate - Start of date range (inclusive)
 * @param endDate - End of date range (inclusive)
 * @returns Array of export rows ordered by date ascending, then connector name
 */
export async function getDailyStatsForExport(startDate: Date, endDate: Date): Promise<ExportRow[]> {
	const results = await db
		.select({
			dateBucket: analyticsDailyStats.dateBucket,
			connectorName: connectors.name,
			connectorType: connectors.type,
			gapsDiscovered: analyticsDailyStats.gapsDiscovered,
			upgradesDiscovered: analyticsDailyStats.upgradesDiscovered,
			searchesDispatched: analyticsDailyStats.searchesDispatched,
			searchesSuccessful: analyticsDailyStats.searchesSuccessful,
			searchesFailed: analyticsDailyStats.searchesFailed,
			searchesNoResults: analyticsDailyStats.searchesNoResults,
			avgQueueDepth: analyticsDailyStats.avgQueueDepth,
			peakQueueDepth: analyticsDailyStats.peakQueueDepth,
			avgResponseTimeMs: analyticsDailyStats.avgResponseTimeMs,
			errorCount: analyticsDailyStats.errorCount
		})
		.from(analyticsDailyStats)
		.innerJoin(connectors, eq(analyticsDailyStats.connectorId, connectors.id))
		.where(and(gte(analyticsDailyStats.dateBucket, startDate), lte(analyticsDailyStats.dateBucket, endDate)))
		.orderBy(analyticsDailyStats.dateBucket, connectors.name);

	return results.map((row) => {
		const successRate =
			row.searchesDispatched > 0
				? Math.round((row.searchesSuccessful / row.searchesDispatched) * 100)
				: 0;

		return {
			date: row.dateBucket.toISOString().split('T')[0]!,
			connector: row.connectorName,
			connectorType: row.connectorType,
			gapsDiscovered: row.gapsDiscovered,
			upgradesDiscovered: row.upgradesDiscovered,
			searchesDispatched: row.searchesDispatched,
			searchesSuccessful: row.searchesSuccessful,
			searchesFailed: row.searchesFailed,
			searchesNoResults: row.searchesNoResults,
			avgQueueDepth: row.avgQueueDepth,
			peakQueueDepth: row.peakQueueDepth,
			avgResponseTimeMs: row.avgResponseTimeMs,
			errorCount: row.errorCount,
			successRate
		};
	});
}
