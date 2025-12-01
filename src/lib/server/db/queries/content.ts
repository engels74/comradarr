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
	searchHistory,
	searchRegistry,
	seasons,
	series,
	type Connector
} from '$lib/server/db/schema';
import { and, asc, count, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';

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
// Series Detail Types (Requirement 17.3)
// =============================================================================

/**
 * Quality model structure (from *arr API).
 */
export interface QualityModel {
	quality: {
		id: number;
		name: string;
		source: string;
		resolution: number;
	};
	revision: {
		version: number;
		real: number;
		isRepack: boolean;
	};
}

/**
 * Full series detail with connector info.
 */
export interface SeriesDetail {
	id: number;
	connectorId: number;
	arrId: number;
	tvdbId: number | null;
	title: string;
	status: string | null;
	monitored: boolean;
	qualityProfileId: number | null;
	createdAt: Date;
	updatedAt: Date;
	connectorName: string;
	connectorType: string;
	connectorUrl: string;
}

/**
 * Episode detail with search state.
 */
export interface EpisodeDetail {
	id: number;
	arrId: number;
	seasonNumber: number;
	episodeNumber: number;
	title: string | null;
	airDate: Date | null;
	monitored: boolean;
	hasFile: boolean;
	quality: QualityModel | null;
	qualityCutoffNotMet: boolean;
	lastSearchTime: Date | null;
	searchState: string | null;
	searchType: string | null;
	attemptCount: number;
	nextEligible: Date | null;
}

/**
 * Season with aggregated stats and episode list.
 */
export interface SeasonWithEpisodes {
	id: number;
	seasonNumber: number;
	monitored: boolean;
	totalEpisodes: number;
	downloadedEpisodes: number;
	nextAiring: Date | null;
	missingCount: number;
	upgradeCount: number;
	episodes: EpisodeDetail[];
}

/**
 * Search history entry for series episodes.
 */
export interface SeriesSearchHistoryEntry {
	id: number;
	episodeId: number;
	episodeTitle: string | null;
	seasonNumber: number;
	episodeNumber: number;
	outcome: string;
	createdAt: Date;
	metadata: unknown;
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

// =============================================================================
// Series Detail Queries (Requirement 17.3)
// =============================================================================

/**
 * Gets series detail with connector information.
 *
 * @param id - Series ID (Comradarr internal ID)
 * @returns Series detail or null if not found
 */
export async function getSeriesDetail(id: number): Promise<SeriesDetail | null> {
	const result = await db
		.select({
			id: series.id,
			connectorId: series.connectorId,
			arrId: series.arrId,
			tvdbId: series.tvdbId,
			title: series.title,
			status: series.status,
			monitored: series.monitored,
			qualityProfileId: series.qualityProfileId,
			createdAt: series.createdAt,
			updatedAt: series.updatedAt,
			connectorName: connectors.name,
			connectorType: connectors.type,
			connectorUrl: connectors.url
		})
		.from(series)
		.innerJoin(connectors, eq(series.connectorId, connectors.id))
		.where(eq(series.id, id))
		.limit(1);

	return result[0] ?? null;
}

/**
 * Gets all seasons for a series with episodes and search state.
 *
 * @param seriesId - Series ID
 * @returns Array of seasons with episodes
 */
export async function getSeriesSeasonsWithEpisodes(
	seriesId: number
): Promise<SeasonWithEpisodes[]> {
	// Get seasons
	const seasonRows = await db
		.select()
		.from(seasons)
		.where(eq(seasons.seriesId, seriesId))
		.orderBy(asc(seasons.seasonNumber));

	if (seasonRows.length === 0) return [];

	// Get all episodes for these seasons with search state
	const seasonIds = seasonRows.map((s) => s.id);

	const episodeRows = await db
		.select({
			id: episodes.id,
			seasonId: episodes.seasonId,
			arrId: episodes.arrId,
			seasonNumber: episodes.seasonNumber,
			episodeNumber: episodes.episodeNumber,
			title: episodes.title,
			airDate: episodes.airDate,
			monitored: episodes.monitored,
			hasFile: episodes.hasFile,
			quality: episodes.quality,
			qualityCutoffNotMet: episodes.qualityCutoffNotMet,
			lastSearchTime: episodes.lastSearchTime,
			// Search registry fields
			searchState: searchRegistry.state,
			searchType: searchRegistry.searchType,
			attemptCount: searchRegistry.attemptCount,
			nextEligible: searchRegistry.nextEligible
		})
		.from(episodes)
		.leftJoin(
			searchRegistry,
			and(
				eq(searchRegistry.contentType, 'episode'),
				eq(searchRegistry.contentId, episodes.id)
			)
		)
		.where(inArray(episodes.seasonId, seasonIds))
		.orderBy(asc(episodes.seasonNumber), asc(episodes.episodeNumber));

	// Group episodes by season
	const episodesBySeason = new Map<number, EpisodeDetail[]>();
	for (const ep of episodeRows) {
		if (!episodesBySeason.has(ep.seasonId)) {
			episodesBySeason.set(ep.seasonId, []);
		}
		episodesBySeason.get(ep.seasonId)!.push({
			id: ep.id,
			arrId: ep.arrId,
			seasonNumber: ep.seasonNumber,
			episodeNumber: ep.episodeNumber,
			title: ep.title,
			airDate: ep.airDate,
			monitored: ep.monitored,
			hasFile: ep.hasFile,
			quality: ep.quality as QualityModel | null,
			qualityCutoffNotMet: ep.qualityCutoffNotMet,
			lastSearchTime: ep.lastSearchTime,
			searchState: ep.searchState,
			searchType: ep.searchType,
			attemptCount: ep.attemptCount ?? 0,
			nextEligible: ep.nextEligible
		});
	}

	// Build result with computed counts
	return seasonRows.map((season) => {
		const eps = episodesBySeason.get(season.id) ?? [];
		const missingCount = eps.filter((e) => e.monitored && !e.hasFile).length;
		const upgradeCount = eps.filter((e) => e.monitored && e.hasFile && e.qualityCutoffNotMet).length;

		return {
			id: season.id,
			seasonNumber: season.seasonNumber,
			monitored: season.monitored,
			totalEpisodes: season.totalEpisodes,
			downloadedEpisodes: season.downloadedEpisodes,
			nextAiring: season.nextAiring,
			missingCount,
			upgradeCount,
			episodes: eps
		};
	});
}

/**
 * Gets search history for all episodes in a series.
 *
 * @param seriesId - Series ID
 * @param limit - Maximum entries to return (default 20)
 * @returns Search history entries with episode info
 */
export async function getSeriesSearchHistory(
	seriesId: number,
	limit: number = 20
): Promise<SeriesSearchHistoryEntry[]> {
	// Get all episode IDs for this series
	const episodeIds = await db
		.select({ id: episodes.id })
		.from(episodes)
		.innerJoin(seasons, eq(episodes.seasonId, seasons.id))
		.where(eq(seasons.seriesId, seriesId));

	if (episodeIds.length === 0) return [];

	const ids = episodeIds.map((e) => e.id);

	// Get search history for these episodes
	const history = await db
		.select({
			id: searchHistory.id,
			contentId: searchHistory.contentId,
			outcome: searchHistory.outcome,
			metadata: searchHistory.metadata,
			createdAt: searchHistory.createdAt,
			// Episode info
			episodeTitle: episodes.title,
			seasonNumber: episodes.seasonNumber,
			episodeNumber: episodes.episodeNumber
		})
		.from(searchHistory)
		.innerJoin(episodes, eq(searchHistory.contentId, episodes.id))
		.where(
			and(eq(searchHistory.contentType, 'episode'), inArray(searchHistory.contentId, ids))
		)
		.orderBy(desc(searchHistory.createdAt))
		.limit(limit);

	return history.map((h) => ({
		id: h.id,
		episodeId: h.contentId,
		episodeTitle: h.episodeTitle,
		seasonNumber: h.seasonNumber,
		episodeNumber: h.episodeNumber,
		outcome: h.outcome,
		createdAt: h.createdAt,
		metadata: h.metadata
	}));
}
