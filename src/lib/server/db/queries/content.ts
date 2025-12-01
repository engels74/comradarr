/**
 * Database queries for content browser operations.
 *
 * Requirements: 17.1, 17.2
 *
 * Provides unified content queries for series and movies with:
 * - Connector, type, and status filtering
 * - Title search with ILIKE
 * - Sortable columns
 * - Pagination
 */

import { db } from '$lib/server/db';
import {
	connectors,
	episodes,
	movies,
	searchRegistry,
	seasons,
	series,
	type Connector
} from '$lib/server/db/schema';
import { and, asc, count, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';

// =============================================================================
// Types
// =============================================================================

/**
 * Content type filter values.
 */
export type ContentType = 'series' | 'movie';

/**
 * Content status filter values.
 * - all: No status filter
 * - missing: Has missing content (hasFile=false)
 * - upgrade: Has upgrade candidates (qualityCutoffNotMet=true)
 * - queued/searching/exhausted: Search registry states
 */
export type ContentStatus = 'all' | 'missing' | 'upgrade' | 'queued' | 'searching' | 'exhausted';

/**
 * Sortable columns for content list.
 */
export type SortColumn = 'title' | 'connector' | 'year';

/**
 * Sort direction.
 */
export type SortDirection = 'asc' | 'desc';

/**
 * Filter options for content queries.
 * Note: Optional properties include `| undefined` for exactOptionalPropertyTypes compliance.
 */
export interface ContentFilters {
	connectorId?: number | undefined;
	contentType?: ContentType | 'all' | undefined;
	status?: ContentStatus | undefined;
	search?: string | undefined;
	sortColumn?: SortColumn | undefined;
	sortDirection?: SortDirection | undefined;
	limit?: number | undefined;
	offset?: number | undefined;
}

/**
 * Unified content item for display.
 * Represents either a series or movie with aggregated stats.
 */
export interface ContentItem {
	id: number;
	type: 'series' | 'movie';
	title: string;
	year: number | null;
	status: string | null;
	connectorId: number;
	connectorName: string;
	connectorType: string;
	monitored: boolean;
	missingCount: number;
	upgradeCount: number;
	searchState: string | null;
}

/**
 * Result from content list query with pagination info.
 */
export interface ContentListResult {
	items: ContentItem[];
	total: number;
}

/**
 * Status counts for filter badges.
 */
export interface ContentStatusCounts {
	all: number;
	missing: number;
	upgrade: number;
	queued: number;
	searching: number;
	exhausted: number;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Parse and validate content filters with defaults.
 */
export function parseContentFilters(searchParams: URLSearchParams): ContentFilters {
	const connectorParam = searchParams.get('connector');
	const pageParam = searchParams.get('page');
	const limitParam = searchParams.get('limit');

	return {
		connectorId: connectorParam ? Number(connectorParam) : undefined,
		contentType: (searchParams.get('type') as ContentFilters['contentType']) ?? 'all',
		status: (searchParams.get('status') as ContentStatus) ?? 'all',
		search: searchParams.get('search') ?? undefined,
		sortColumn: (searchParams.get('sort') as SortColumn) ?? 'title',
		sortDirection: (searchParams.get('order') as SortDirection) ?? 'asc',
		limit: limitParam ? Math.min(100, Math.max(10, Number(limitParam))) : 50,
		offset: pageParam ? (Math.max(1, Number(pageParam)) - 1) * (limitParam ? Number(limitParam) : 50) : 0
	};
}

// =============================================================================
// Series Queries
// =============================================================================

/**
 * Internal series item with aggregated episode stats.
 */
interface SeriesWithStats {
	id: number;
	title: string;
	status: string | null;
	connectorId: number;
	connectorName: string;
	connectorType: string;
	monitored: boolean;
	missingCount: number;
	upgradeCount: number;
	searchState: string | null;
}

/**
 * Gets series with aggregated episode stats and search state.
 */
async function getSeriesList(filters: ContentFilters): Promise<SeriesWithStats[]> {
	const conditions: SQL[] = [];

	// Connector filter
	if (filters.connectorId !== undefined) {
		conditions.push(eq(series.connectorId, filters.connectorId));
	}

	// Search filter
	if (filters.search) {
		conditions.push(ilike(series.title, `%${filters.search}%`));
	}

	// Build order by
	let orderBy;
	const direction = filters.sortDirection === 'desc' ? desc : asc;
	switch (filters.sortColumn) {
		case 'connector':
			orderBy = direction(connectors.name);
			break;
		case 'title':
		default:
			orderBy = direction(series.title);
			break;
	}

	const result = await db
		.select({
			id: series.id,
			title: series.title,
			status: series.status,
			connectorId: series.connectorId,
			connectorName: connectors.name,
			connectorType: connectors.type,
			monitored: series.monitored,
			// Subquery for missing count
			missingCount: sql<number>`(
				SELECT COUNT(*)::int FROM episodes e
				JOIN seasons s ON e.season_id = s.id
				WHERE s.series_id = ${series.id}
				AND e.has_file = false AND e.monitored = true
			)`.as('missing_count'),
			// Subquery for upgrade count
			upgradeCount: sql<number>`(
				SELECT COUNT(*)::int FROM episodes e
				JOIN seasons s ON e.season_id = s.id
				WHERE s.series_id = ${series.id}
				AND e.quality_cutoff_not_met = true AND e.monitored = true AND e.has_file = true
			)`.as('upgrade_count'),
			// Latest search state for any episode in this series
			searchState: sql<string | null>`(
				SELECT sr.state FROM search_registry sr
				JOIN episodes e ON sr.content_id = e.id AND sr.content_type = 'episode'
				JOIN seasons s ON e.season_id = s.id
				WHERE s.series_id = ${series.id} AND sr.connector_id = ${series.connectorId}
				ORDER BY
					CASE sr.state
						WHEN 'searching' THEN 1
						WHEN 'queued' THEN 2
						WHEN 'cooldown' THEN 3
						WHEN 'exhausted' THEN 4
						WHEN 'pending' THEN 5
						ELSE 6
					END
				LIMIT 1
			)`.as('search_state')
		})
		.from(series)
		.innerJoin(connectors, eq(series.connectorId, connectors.id))
		.where(conditions.length > 0 ? and(...conditions) : undefined)
		.orderBy(orderBy)
		.limit(filters.limit ?? 50)
		.offset(filters.offset ?? 0);

	return result;
}

/**
 * Gets count of series matching filters.
 */
async function getSeriesCount(filters: ContentFilters): Promise<number> {
	const conditions: SQL[] = [];

	if (filters.connectorId !== undefined) {
		conditions.push(eq(series.connectorId, filters.connectorId));
	}

	if (filters.search) {
		conditions.push(ilike(series.title, `%${filters.search}%`));
	}

	const result = await db
		.select({ count: count() })
		.from(series)
		.where(conditions.length > 0 ? and(...conditions) : undefined);

	return result[0]?.count ?? 0;
}

// =============================================================================
// Movies Queries
// =============================================================================

/**
 * Internal movie item with search state.
 */
interface MovieWithStats {
	id: number;
	title: string;
	year: number | null;
	connectorId: number;
	connectorName: string;
	connectorType: string;
	monitored: boolean;
	hasFile: boolean;
	qualityCutoffNotMet: boolean;
	searchState: string | null;
}

/**
 * Gets movies with search state.
 */
async function getMoviesList(filters: ContentFilters): Promise<MovieWithStats[]> {
	const conditions: SQL[] = [];

	// Connector filter
	if (filters.connectorId !== undefined) {
		conditions.push(eq(movies.connectorId, filters.connectorId));
	}

	// Search filter
	if (filters.search) {
		conditions.push(ilike(movies.title, `%${filters.search}%`));
	}

	// Build order by
	let orderBy;
	const direction = filters.sortDirection === 'desc' ? desc : asc;
	switch (filters.sortColumn) {
		case 'connector':
			orderBy = direction(connectors.name);
			break;
		case 'year':
			orderBy = direction(movies.year);
			break;
		case 'title':
		default:
			orderBy = direction(movies.title);
			break;
	}

	const result = await db
		.select({
			id: movies.id,
			title: movies.title,
			year: movies.year,
			connectorId: movies.connectorId,
			connectorName: connectors.name,
			connectorType: connectors.type,
			monitored: movies.monitored,
			hasFile: movies.hasFile,
			qualityCutoffNotMet: movies.qualityCutoffNotMet,
			searchState: searchRegistry.state
		})
		.from(movies)
		.innerJoin(connectors, eq(movies.connectorId, connectors.id))
		.leftJoin(
			searchRegistry,
			and(
				eq(searchRegistry.contentType, 'movie'),
				eq(searchRegistry.contentId, movies.id),
				eq(searchRegistry.connectorId, movies.connectorId)
			)
		)
		.where(conditions.length > 0 ? and(...conditions) : undefined)
		.orderBy(orderBy)
		.limit(filters.limit ?? 50)
		.offset(filters.offset ?? 0);

	return result;
}

/**
 * Gets count of movies matching filters.
 */
async function getMoviesCount(filters: ContentFilters): Promise<number> {
	const conditions: SQL[] = [];

	if (filters.connectorId !== undefined) {
		conditions.push(eq(movies.connectorId, filters.connectorId));
	}

	if (filters.search) {
		conditions.push(ilike(movies.title, `%${filters.search}%`));
	}

	const result = await db
		.select({ count: count() })
		.from(movies)
		.where(conditions.length > 0 ? and(...conditions) : undefined);

	return result[0]?.count ?? 0;
}

// =============================================================================
// Unified Content Queries
// =============================================================================

/**
 * Gets unified content list (series and/or movies) with filters.
 *
 * @param filters - Query filters
 * @returns Content items and total count
 */
export async function getContentList(filters: ContentFilters): Promise<ContentListResult> {
	const contentType = filters.contentType ?? 'all';

	// Determine what to query based on content type filter
	const querySeries = contentType === 'all' || contentType === 'series';
	const queryMovies = contentType === 'all' || contentType === 'movie';

	let items: ContentItem[] = [];
	let total = 0;

	// For status filters, we need to filter after aggregation
	const statusFilter = filters.status ?? 'all';

	if (querySeries && queryMovies) {
		// Query both, merge and sort
		const [seriesResult, moviesResult, seriesCount, moviesCount] = await Promise.all([
			getSeriesList({ ...filters, limit: filters.limit, offset: filters.offset }),
			getMoviesList({ ...filters, limit: filters.limit, offset: filters.offset }),
			getSeriesCount(filters),
			getMoviesCount(filters)
		]);

		// Convert to unified format
		const seriesItems: ContentItem[] = seriesResult.map((s) => ({
			id: s.id,
			type: 'series' as const,
			title: s.title,
			year: null,
			status: s.status,
			connectorId: s.connectorId,
			connectorName: s.connectorName,
			connectorType: s.connectorType,
			monitored: s.monitored,
			missingCount: s.missingCount,
			upgradeCount: s.upgradeCount,
			searchState: s.searchState
		}));

		const movieItems: ContentItem[] = moviesResult.map((m) => ({
			id: m.id,
			type: 'movie' as const,
			title: m.title,
			year: m.year,
			status: null,
			connectorId: m.connectorId,
			connectorName: m.connectorName,
			connectorType: m.connectorType,
			monitored: m.monitored,
			missingCount: !m.hasFile && m.monitored ? 1 : 0,
			upgradeCount: m.qualityCutoffNotMet && m.hasFile && m.monitored ? 1 : 0,
			searchState: m.searchState
		}));

		// Merge and sort
		items = [...seriesItems, ...movieItems];

		// Apply status filter
		items = filterByStatus(items, statusFilter);

		// Sort merged results
		items = sortItems(items, filters.sortColumn ?? 'title', filters.sortDirection ?? 'asc');

		// Apply pagination to merged results
		items = items.slice(0, filters.limit ?? 50);

		total = seriesCount + moviesCount;
	} else if (querySeries) {
		const [seriesResult, seriesCount] = await Promise.all([
			getSeriesList(filters),
			getSeriesCount(filters)
		]);

		items = seriesResult.map((s) => ({
			id: s.id,
			type: 'series' as const,
			title: s.title,
			year: null,
			status: s.status,
			connectorId: s.connectorId,
			connectorName: s.connectorName,
			connectorType: s.connectorType,
			monitored: s.monitored,
			missingCount: s.missingCount,
			upgradeCount: s.upgradeCount,
			searchState: s.searchState
		}));

		// Apply status filter
		items = filterByStatus(items, statusFilter);

		total = seriesCount;
	} else if (queryMovies) {
		const [moviesResult, moviesCount] = await Promise.all([
			getMoviesList(filters),
			getMoviesCount(filters)
		]);

		items = moviesResult.map((m) => ({
			id: m.id,
			type: 'movie' as const,
			title: m.title,
			year: m.year,
			status: null,
			connectorId: m.connectorId,
			connectorName: m.connectorName,
			connectorType: m.connectorType,
			monitored: m.monitored,
			missingCount: !m.hasFile && m.monitored ? 1 : 0,
			upgradeCount: m.qualityCutoffNotMet && m.hasFile && m.monitored ? 1 : 0,
			searchState: m.searchState
		}));

		// Apply status filter
		items = filterByStatus(items, statusFilter);

		total = moviesCount;
	}

	return { items, total };
}

/**
 * Filters content items by status.
 */
function filterByStatus(items: ContentItem[], status: ContentStatus): ContentItem[] {
	switch (status) {
		case 'missing':
			return items.filter((item) => item.missingCount > 0);
		case 'upgrade':
			return items.filter((item) => item.upgradeCount > 0);
		case 'queued':
			return items.filter((item) => item.searchState === 'queued');
		case 'searching':
			return items.filter((item) => item.searchState === 'searching');
		case 'exhausted':
			return items.filter((item) => item.searchState === 'exhausted');
		case 'all':
		default:
			return items;
	}
}

/**
 * Sorts content items.
 */
function sortItems(items: ContentItem[], column: SortColumn, direction: SortDirection): ContentItem[] {
	const multiplier = direction === 'asc' ? 1 : -1;

	return items.sort((a, b) => {
		switch (column) {
			case 'connector':
				return multiplier * a.connectorName.localeCompare(b.connectorName);
			case 'year':
				return multiplier * ((a.year ?? 0) - (b.year ?? 0));
			case 'title':
			default:
				return multiplier * a.title.localeCompare(b.title);
		}
	});
}

// =============================================================================
// Supporting Queries
// =============================================================================

/**
 * Gets connectors for filter dropdown.
 *
 * @returns Array of connector options
 */
export async function getConnectorsForFilter(): Promise<
	Array<{ id: number; name: string; type: string }>
> {
	const result = await db
		.select({
			id: connectors.id,
			name: connectors.name,
			type: connectors.type
		})
		.from(connectors)
		.orderBy(connectors.name);

	return result;
}

/**
 * Gets content status counts for filter badges.
 *
 * @param connectorId - Optional connector ID to filter by
 * @returns Status counts
 */
export async function getContentStatusCounts(connectorId?: number): Promise<ContentStatusCounts> {
	// Build connector conditions
	const episodeConnectorCondition = connectorId !== undefined ? eq(episodes.connectorId, connectorId) : undefined;
	const movieConnectorCondition = connectorId !== undefined ? eq(movies.connectorId, connectorId) : undefined;
	const searchRegistryCondition = connectorId !== undefined ? eq(searchRegistry.connectorId, connectorId) : undefined;

	// Run all counts in parallel
	const [
		totalSeriesResult,
		totalMoviesResult,
		missingEpisodesResult,
		missingMoviesResult,
		upgradeEpisodesResult,
		upgradeMoviesResult,
		searchStateResult
	] = await Promise.all([
		// Total series
		db
			.select({ count: count() })
			.from(series)
			.where(connectorId !== undefined ? eq(series.connectorId, connectorId) : undefined),
		// Total movies
		db
			.select({ count: count() })
			.from(movies)
			.where(movieConnectorCondition),
		// Series with missing episodes (count distinct series)
		db
			.select({ count: sql<number>`COUNT(DISTINCT s.series_id)::int` })
			.from(episodes)
			.innerJoin(seasons, eq(episodes.seasonId, seasons.id))
			.where(
				and(
					episodeConnectorCondition,
					eq(episodes.hasFile, false),
					eq(episodes.monitored, true)
				)
			),
		// Movies missing
		db
			.select({ count: count() })
			.from(movies)
			.where(
				and(
					movieConnectorCondition,
					eq(movies.hasFile, false),
					eq(movies.monitored, true)
				)
			),
		// Series with upgrade episodes (count distinct series)
		db
			.select({ count: sql<number>`COUNT(DISTINCT s.series_id)::int` })
			.from(episodes)
			.innerJoin(seasons, eq(episodes.seasonId, seasons.id))
			.where(
				and(
					episodeConnectorCondition,
					eq(episodes.qualityCutoffNotMet, true),
					eq(episodes.monitored, true),
					eq(episodes.hasFile, true)
				)
			),
		// Movies with upgrades
		db
			.select({ count: count() })
			.from(movies)
			.where(
				and(
					movieConnectorCondition,
					eq(movies.qualityCutoffNotMet, true),
					eq(movies.monitored, true),
					eq(movies.hasFile, true)
				)
			),
		// Search states
		db
			.select({
				state: searchRegistry.state,
				count: count()
			})
			.from(searchRegistry)
			.where(searchRegistryCondition)
			.groupBy(searchRegistry.state)
	]);

	// Parse search state counts
	const searchStateCounts: Record<string, number> = {};
	for (const row of searchStateResult) {
		searchStateCounts[row.state] = row.count;
	}

	const totalSeries = totalSeriesResult[0]?.count ?? 0;
	const totalMovies = totalMoviesResult[0]?.count ?? 0;

	return {
		all: totalSeries + totalMovies,
		missing: (missingEpisodesResult[0]?.count ?? 0) + (missingMoviesResult[0]?.count ?? 0),
		upgrade: (upgradeEpisodesResult[0]?.count ?? 0) + (upgradeMoviesResult[0]?.count ?? 0),
		queued: searchStateCounts['queued'] ?? 0,
		searching: searchStateCounts['searching'] ?? 0,
		exhausted: searchStateCounts['exhausted'] ?? 0
	};
}
