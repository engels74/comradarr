import { and, asc, count, desc, eq, ilike, inArray, type SQL, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	connectors,
	episodes,
	movies,
	searchHistory,
	searchRegistry,
	seasons,
	series
} from '$lib/server/db/schema';

export type ContentType = 'series' | 'movie';

export type ContentStatus = 'all' | 'missing' | 'upgrade' | 'queued' | 'searching' | 'exhausted';

export type SortColumn = 'title' | 'connector' | 'year';

export type SortDirection = 'asc' | 'desc';

export interface ContentFilters {
	connectorId?: number | undefined;
	contentType?: ContentType | 'all' | undefined;
	status?: ContentStatus | undefined;
	search?: string | undefined;
	sortColumn?: SortColumn | undefined;
	sortDirection?: SortDirection | undefined;
	limit?: number | undefined;
	offset?: number | undefined;
	cursor?: string | undefined;
}

export interface ContentCursor {
	type: 'series' | 'movie';
	id: number;
	title: string;
}

export function encodeCursor(type: 'series' | 'movie', id: number, title: string): string {
	return Buffer.from(JSON.stringify({ type, id, title })).toString('base64url');
}

export function decodeCursor(cursor: string): ContentCursor | null {
	try {
		const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf-8'));
		if (
			decoded &&
			typeof decoded === 'object' &&
			(decoded.type === 'series' || decoded.type === 'movie') &&
			typeof decoded.id === 'number' &&
			typeof decoded.title === 'string'
		) {
			return decoded as ContentCursor;
		}
		return null;
	} catch {
		return null;
	}
}

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
	searchStateCount: number | null;
}

export interface ContentListResult {
	items: ContentItem[];
	total: number;
	nextCursor: string | null;
}

export interface ContentStatusCounts {
	all: number;
	missing: number;
	upgrade: number;
	queued: number;
	searching: number;
	exhausted: number;
}

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

export interface SeasonSummary {
	id: number;
	seasonNumber: number;
	monitored: boolean;
	totalEpisodes: number;
	downloadedEpisodes: number;
	nextAiring: Date | null;
	missingCount: number;
	upgradeCount: number;
}

export interface MovieDetail {
	id: number;
	connectorId: number;
	arrId: number;
	tmdbId: number | null;
	imdbId: string | null;
	title: string;
	year: number | null;
	monitored: boolean;
	hasFile: boolean;
	quality: QualityModel | null;
	qualityCutoffNotMet: boolean;
	movieFileId: number | null;
	lastSearchTime: Date | null;
	createdAt: Date;
	updatedAt: Date;
	connectorName: string;
	connectorType: string;
	connectorUrl: string;
}

export interface MovieSearchHistoryEntry {
	id: number;
	movieTitle: string;
	outcome: string;
	createdAt: Date;
	metadata: unknown;
}

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
		offset: pageParam
			? (Math.max(1, Number(pageParam)) - 1) * (limitParam ? Number(limitParam) : 50)
			: 0
	};
}

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
	searchStateCount: number | null;
}

const episodeCountsSubquery = db
	.select({
		seriesId: seasons.seriesId,
		missingCount:
			sql<number>`COUNT(*) FILTER (WHERE ${episodes.hasFile} = false AND ${episodes.monitored} = true)::int`.as(
				'missing_count'
			),
		upgradeCount:
			sql<number>`COUNT(*) FILTER (WHERE ${episodes.qualityCutoffNotMet} = true AND ${episodes.monitored} = true AND ${episodes.hasFile} = true)::int`.as(
				'upgrade_count'
			)
	})
	.from(episodes)
	.innerJoin(seasons, eq(episodes.seasonId, seasons.id))
	.groupBy(seasons.seriesId)
	.as('ep_counts');

const searchStateSubquery = db
	.select({
		seriesId: sql<number>`sr_agg.series_id`.as('series_id'),
		state: sql<string | null>`sr_agg.state`.as('state'),
		stateCount: sql<number | null>`sr_agg.state_count`.as('state_count')
	})
	.from(
		sql`(
			WITH state_counts AS (
				SELECT
					sea.series_id,
					sr.state,
					COUNT(*) as state_count,
					ROW_NUMBER() OVER (
						PARTITION BY sea.series_id
						ORDER BY CASE sr.state
							WHEN 'searching' THEN 1
							WHEN 'queued' THEN 2
							WHEN 'cooldown' THEN 3
							WHEN 'exhausted' THEN 4
							WHEN 'pending' THEN 5
							ELSE 6
						END
					) as rn
				FROM search_registry sr
				JOIN episodes e ON sr.content_id = e.id AND sr.content_type = 'episode'
				JOIN seasons sea ON e.season_id = sea.id
				GROUP BY sea.series_id, sr.state
			)
			SELECT series_id, state, state_count
			FROM state_counts
			WHERE rn = 1
		) AS sr_agg`
	)
	.as('sr_state');

function buildSeriesStatusConditions(status: ContentStatus | undefined): SQL | undefined {
	switch (status) {
		case 'missing':
			// Series with at least one missing episode
			return sql`COALESCE(ep_counts.missing_count, 0) > 0`;
		case 'upgrade':
			// Series with at least one episode needing upgrade
			return sql`COALESCE(ep_counts.upgrade_count, 0) > 0`;
		case 'queued':
			return sql`sr_state.state = 'queued'`;
		case 'searching':
			return sql`sr_state.state = 'searching'`;
		case 'exhausted':
			return sql`sr_state.state = 'exhausted'`;
		default:
			return undefined;
	}
}

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

	// Status filter (applied in SQL, not post-filtering)
	const statusCondition = buildSeriesStatusConditions(filters.status);
	if (statusCondition) {
		conditions.push(statusCondition);
	}

	// Build order by
	const direction = filters.sortDirection === 'desc' ? desc : asc;
	let orderBy: SQL;
	switch (filters.sortColumn) {
		case 'connector':
			orderBy = direction(connectors.name);
			break;
		default:
			orderBy = direction(series.title);
			break;
	}

	// Optimized query using pre-aggregated subqueries instead of correlated subqueries
	// This reduces 3N+1 queries to a single query with JOINs
	const result = await db
		.select({
			id: series.id,
			title: series.title,
			status: series.status,
			connectorId: series.connectorId,
			connectorName: connectors.name,
			connectorType: connectors.type,
			monitored: series.monitored,
			missingCount: sql<number>`COALESCE(ep_counts.missing_count, 0)`.as('missing_count'),
			upgradeCount: sql<number>`COALESCE(ep_counts.upgrade_count, 0)`.as('upgrade_count'),
			searchState: sql<string | null>`sr_state.state`.as('search_state'),
			searchStateCount: sql<number | null>`sr_state.state_count`.as('search_state_count')
		})
		.from(series)
		.innerJoin(connectors, eq(series.connectorId, connectors.id))
		.leftJoin(episodeCountsSubquery, eq(series.id, episodeCountsSubquery.seriesId))
		.leftJoin(searchStateSubquery, sql`${series.id} = sr_state.series_id`)
		.where(conditions.length > 0 ? and(...conditions) : undefined)
		.orderBy(orderBy)
		.limit(filters.limit ?? 50)
		.offset(filters.offset ?? 0);

	return result;
}

async function getSeriesCount(filters: ContentFilters): Promise<number> {
	const conditions: SQL[] = [];

	if (filters.connectorId !== undefined) {
		conditions.push(eq(series.connectorId, filters.connectorId));
	}

	if (filters.search) {
		conditions.push(ilike(series.title, `%${filters.search}%`));
	}

	// Status filter (same logic as getSeriesList for consistent counts)
	const statusCondition = buildSeriesStatusConditions(filters.status);
	if (statusCondition) {
		conditions.push(statusCondition);
	}

	// If we have status filters that require aggregation, we need to join the subqueries
	const needsAggregation = filters.status && filters.status !== 'all';

	if (needsAggregation) {
		// Count with aggregation subqueries for status filtering
		const result = await db
			.select({ count: count() })
			.from(series)
			.leftJoin(episodeCountsSubquery, eq(series.id, episodeCountsSubquery.seriesId))
			.leftJoin(searchStateSubquery, sql`${series.id} = sr_state.series_id`)
			.where(conditions.length > 0 ? and(...conditions) : undefined);

		return result[0]?.count ?? 0;
	} else {
		// Simple count without aggregation (faster for 'all' status)
		const result = await db
			.select({ count: count() })
			.from(series)
			.where(conditions.length > 0 ? and(...conditions) : undefined);

		return result[0]?.count ?? 0;
	}
}

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

function buildMovieStatusConditions(status: ContentStatus | undefined): SQL | undefined {
	switch (status) {
		case 'missing':
			return and(eq(movies.hasFile, false), eq(movies.monitored, true));
		case 'upgrade':
			return and(
				eq(movies.qualityCutoffNotMet, true),
				eq(movies.hasFile, true),
				eq(movies.monitored, true)
			);
		case 'queued':
			return sql`search_registry.state = 'queued'`;
		case 'searching':
			return sql`search_registry.state = 'searching'`;
		case 'exhausted':
			return sql`search_registry.state = 'exhausted'`;
		default:
			return undefined;
	}
}

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

	// Status filter (applied in SQL, not post-filtering)
	const statusCondition = buildMovieStatusConditions(filters.status);
	if (statusCondition) {
		conditions.push(statusCondition);
	}

	// Build order by
	const direction = filters.sortDirection === 'desc' ? desc : asc;
	let orderBy: SQL;
	switch (filters.sortColumn) {
		case 'connector':
			orderBy = direction(connectors.name);
			break;
		case 'year':
			orderBy = direction(movies.year);
			break;
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

async function getMoviesCount(filters: ContentFilters): Promise<number> {
	const conditions: SQL[] = [];

	if (filters.connectorId !== undefined) {
		conditions.push(eq(movies.connectorId, filters.connectorId));
	}

	if (filters.search) {
		conditions.push(ilike(movies.title, `%${filters.search}%`));
	}

	// Status filter (same logic as getMoviesList for consistent counts)
	const statusCondition = buildMovieStatusConditions(filters.status);
	if (statusCondition) {
		conditions.push(statusCondition);
	}

	// If we have search state status filters, we need to join search_registry
	const needsSearchRegistry =
		filters.status === 'queued' || filters.status === 'searching' || filters.status === 'exhausted';

	if (needsSearchRegistry) {
		const result = await db
			.select({ count: count() })
			.from(movies)
			.leftJoin(
				searchRegistry,
				and(
					eq(searchRegistry.contentType, 'movie'),
					eq(searchRegistry.contentId, movies.id),
					eq(searchRegistry.connectorId, movies.connectorId)
				)
			)
			.where(conditions.length > 0 ? and(...conditions) : undefined);

		return result[0]?.count ?? 0;
	} else {
		const result = await db
			.select({ count: count() })
			.from(movies)
			.where(conditions.length > 0 ? and(...conditions) : undefined);

		return result[0]?.count ?? 0;
	}
}

export async function getContentList(filters: ContentFilters): Promise<ContentListResult> {
	const contentType = filters.contentType ?? 'all';

	// Determine what to query based on content type filter
	const querySeries = contentType === 'all' || contentType === 'series';
	const queryMovies = contentType === 'all' || contentType === 'movie';

	let items: ContentItem[] = [];
	let total = 0;

	if (querySeries && queryMovies) {
		// Query both, merge and sort
		// Note: Status filtering is now done in SQL within getSeriesList/getMoviesList
		const [seriesResult, moviesResult, seriesCount, moviesCount] = await Promise.all([
			getSeriesList(filters),
			getMoviesList(filters),
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
			searchState: s.searchState,
			searchStateCount: s.searchStateCount
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
			searchState: m.searchState,
			searchStateCount: m.searchState ? 1 : null
		}));

		// Merge and sort
		items = [...seriesItems, ...movieItems];

		items = sortItems(items, filters.sortColumn ?? 'title', filters.sortDirection ?? 'asc');
		items = items.slice(0, filters.limit ?? 50);
		total = seriesCount + moviesCount;
	} else if (querySeries) {
		const [seriesResult, seriesCount] = await Promise.all([
			getSeriesList(filters),
			getSeriesCount(filters)
		]);

		// Status filtering already done in SQL
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
			searchState: s.searchState,
			searchStateCount: s.searchStateCount
		}));

		total = seriesCount;
	} else if (queryMovies) {
		const [moviesResult, moviesCount] = await Promise.all([
			getMoviesList(filters),
			getMoviesCount(filters)
		]);

		// Status filtering already done in SQL
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
			searchState: m.searchState,
			searchStateCount: m.searchState ? 1 : null
		}));

		total = moviesCount;
	}

	// Generate next cursor if there are more results
	const _limit = filters.limit ?? 50;
	const offset = filters.offset ?? 0;
	const hasMore = offset + items.length < total;
	let nextCursor: string | null = null;

	if (hasMore && items.length > 0) {
		const lastItem = items[items.length - 1];
		if (lastItem) {
			nextCursor = encodeCursor(lastItem.type, lastItem.id, lastItem.title);
		}
	}

	return { items, total, nextCursor };
}

function sortItems(
	items: ContentItem[],
	column: SortColumn,
	direction: SortDirection
): ContentItem[] {
	const multiplier = direction === 'asc' ? 1 : -1;

	return items.sort((a, b) => {
		switch (column) {
			case 'connector':
				return multiplier * a.connectorName.localeCompare(b.connectorName);
			case 'year':
				return multiplier * ((a.year ?? 0) - (b.year ?? 0));
			default:
				return multiplier * a.title.localeCompare(b.title);
		}
	});
}

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

export async function getContentStatusCounts(connectorId?: number): Promise<ContentStatusCounts> {
	// Build connector conditions
	const episodeConnectorCondition =
		connectorId !== undefined ? eq(episodes.connectorId, connectorId) : undefined;
	const movieConnectorCondition =
		connectorId !== undefined ? eq(movies.connectorId, connectorId) : undefined;
	const searchRegistryCondition =
		connectorId !== undefined ? eq(searchRegistry.connectorId, connectorId) : undefined;

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
			.select({ count: sql<number>`COUNT(DISTINCT ${seasons.seriesId})::int` })
			.from(episodes)
			.innerJoin(seasons, eq(episodes.seasonId, seasons.id))
			.where(
				and(episodeConnectorCondition, eq(episodes.hasFile, false), eq(episodes.monitored, true))
			),
		// Movies missing
		db
			.select({ count: count() })
			.from(movies)
			.where(and(movieConnectorCondition, eq(movies.hasFile, false), eq(movies.monitored, true))),
		// Series with upgrade episodes (count distinct series)
		db
			.select({ count: sql<number>`COUNT(DISTINCT ${seasons.seriesId})::int` })
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
		queued: searchStateCounts.queued ?? 0,
		searching: searchStateCounts.searching ?? 0,
		exhausted: searchStateCounts.exhausted ?? 0
	};
}

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
			and(eq(searchRegistry.contentType, 'episode'), eq(searchRegistry.contentId, episodes.id))
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
		const upgradeCount = eps.filter(
			(e) => e.monitored && e.hasFile && e.qualityCutoffNotMet
		).length;

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

export async function getSeasonSummaries(seriesId: number): Promise<SeasonSummary[]> {
	const result = await db
		.select({
			id: seasons.id,
			seasonNumber: seasons.seasonNumber,
			monitored: seasons.monitored,
			totalEpisodes: seasons.totalEpisodes,
			downloadedEpisodes: seasons.downloadedEpisodes,
			nextAiring: seasons.nextAiring,
			// Compute missing count via subquery
			missingCount: sql<number>`(
				SELECT COUNT(*)::int FROM episodes e
				WHERE e.season_id = ${seasons.id}
				AND e.has_file = false AND e.monitored = true
			)`.as('missing_count'),
			// Compute upgrade count via subquery
			upgradeCount: sql<number>`(
				SELECT COUNT(*)::int FROM episodes e
				WHERE e.season_id = ${seasons.id}
				AND e.quality_cutoff_not_met = true AND e.monitored = true AND e.has_file = true
			)`.as('upgrade_count')
		})
		.from(seasons)
		.where(eq(seasons.seriesId, seriesId))
		.orderBy(asc(seasons.seasonNumber));

	return result;
}

export async function getSeasonEpisodes(seasonId: number): Promise<EpisodeDetail[]> {
	const result = await db
		.select({
			id: episodes.id,
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
			and(eq(searchRegistry.contentType, 'episode'), eq(searchRegistry.contentId, episodes.id))
		)
		.where(eq(episodes.seasonId, seasonId))
		.orderBy(asc(episodes.episodeNumber));

	return result.map((ep) => ({
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
	}));
}

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
		.where(and(eq(searchHistory.contentType, 'episode'), inArray(searchHistory.contentId, ids)))
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

export async function getMovieDetail(id: number): Promise<MovieDetail | null> {
	const result = await db
		.select({
			id: movies.id,
			connectorId: movies.connectorId,
			arrId: movies.arrId,
			tmdbId: movies.tmdbId,
			imdbId: movies.imdbId,
			title: movies.title,
			year: movies.year,
			monitored: movies.monitored,
			hasFile: movies.hasFile,
			quality: movies.quality,
			qualityCutoffNotMet: movies.qualityCutoffNotMet,
			movieFileId: movies.movieFileId,
			lastSearchTime: movies.lastSearchTime,
			createdAt: movies.createdAt,
			updatedAt: movies.updatedAt,
			connectorName: connectors.name,
			connectorType: connectors.type,
			connectorUrl: connectors.url
		})
		.from(movies)
		.innerJoin(connectors, eq(movies.connectorId, connectors.id))
		.where(eq(movies.id, id))
		.limit(1);

	const row = result[0];
	if (!row) return null;

	return {
		...row,
		quality: row.quality as QualityModel | null
	};
}

export async function getMovieSearchHistory(
	movieId: number,
	limit: number = 20
): Promise<MovieSearchHistoryEntry[]> {
	const history = await db
		.select({
			id: searchHistory.id,
			outcome: searchHistory.outcome,
			metadata: searchHistory.metadata,
			createdAt: searchHistory.createdAt,
			movieTitle: movies.title
		})
		.from(searchHistory)
		.innerJoin(movies, eq(searchHistory.contentId, movies.id))
		.where(and(eq(searchHistory.contentType, 'movie'), eq(searchHistory.contentId, movieId)))
		.orderBy(desc(searchHistory.createdAt))
		.limit(limit);

	return history.map((h) => ({
		id: h.id,
		movieTitle: h.movieTitle,
		outcome: h.outcome,
		createdAt: h.createdAt,
		metadata: h.metadata
	}));
}

export interface BulkActionTarget {
	type: 'series' | 'movie';
	id: number;
}

export interface BulkActionResult {
	affected: number;
	skipped: number;
}

export async function bulkQueueForSearch(
	targets: BulkActionTarget[],
	searchType: 'gap' | 'upgrade' = 'gap'
): Promise<BulkActionResult> {
	if (targets.length === 0) {
		return { affected: 0, skipped: 0 };
	}

	const seriesIds = targets.filter((t) => t.type === 'series').map((t) => t.id);
	const movieIds = targets.filter((t) => t.type === 'movie').map((t) => t.id);

	let affected = 0;

	// Handle series - get all eligible episodes
	if (seriesIds.length > 0) {
		// Get all episodes from these series that match the search criteria
		const episodeCondition =
			searchType === 'gap'
				? and(eq(episodes.hasFile, false), eq(episodes.monitored, true))
				: and(
						eq(episodes.qualityCutoffNotMet, true),
						eq(episodes.hasFile, true),
						eq(episodes.monitored, true)
					);

		const episodeRows = await db
			.select({
				id: episodes.id,
				connectorId: episodes.connectorId
			})
			.from(episodes)
			.innerJoin(seasons, eq(episodes.seasonId, seasons.id))
			.where(and(inArray(seasons.seriesId, seriesIds), episodeCondition));

		// Upsert search registry entries for episodes
		for (const ep of episodeRows) {
			await db
				.insert(searchRegistry)
				.values({
					connectorId: ep.connectorId,
					contentType: 'episode',
					contentId: ep.id,
					searchType,
					state: 'pending',
					attemptCount: 0,
					priority: 0
				})
				.onConflictDoUpdate({
					target: [
						searchRegistry.connectorId,
						searchRegistry.contentType,
						searchRegistry.contentId
					],
					set: {
						state: 'pending',
						searchType,
						updatedAt: new Date()
					}
				});
			affected++;
		}
	}

	// Handle movies
	if (movieIds.length > 0) {
		// Get movies that match the search criteria
		const movieCondition =
			searchType === 'gap'
				? and(eq(movies.hasFile, false), eq(movies.monitored, true))
				: and(
						eq(movies.qualityCutoffNotMet, true),
						eq(movies.hasFile, true),
						eq(movies.monitored, true)
					);

		const movieRows = await db
			.select({
				id: movies.id,
				connectorId: movies.connectorId
			})
			.from(movies)
			.where(and(inArray(movies.id, movieIds), movieCondition));

		// Upsert search registry entries for movies
		for (const mv of movieRows) {
			await db
				.insert(searchRegistry)
				.values({
					connectorId: mv.connectorId,
					contentType: 'movie',
					contentId: mv.id,
					searchType,
					state: 'pending',
					attemptCount: 0,
					priority: 0
				})
				.onConflictDoUpdate({
					target: [
						searchRegistry.connectorId,
						searchRegistry.contentType,
						searchRegistry.contentId
					],
					set: {
						state: 'pending',
						searchType,
						updatedAt: new Date()
					}
				});
			affected++;
		}
	}

	return { affected, skipped: 0 };
}

export async function bulkSetPriority(
	targets: BulkActionTarget[],
	priority: number
): Promise<BulkActionResult> {
	if (targets.length === 0) {
		return { affected: 0, skipped: 0 };
	}

	// Clamp priority to valid range
	const clampedPriority = Math.max(0, Math.min(100, priority));

	const seriesIds = targets.filter((t) => t.type === 'series').map((t) => t.id);
	const movieIds = targets.filter((t) => t.type === 'movie').map((t) => t.id);

	let affected = 0;

	// Handle series - update all episode entries
	if (seriesIds.length > 0) {
		// Get episode IDs for these series
		const episodeRows = await db
			.select({ id: episodes.id })
			.from(episodes)
			.innerJoin(seasons, eq(episodes.seasonId, seasons.id))
			.where(inArray(seasons.seriesId, seriesIds));

		const episodeIds = episodeRows.map((e) => e.id);

		if (episodeIds.length > 0) {
			const result = await db
				.update(searchRegistry)
				.set({ priority: clampedPriority, updatedAt: new Date() })
				.where(
					and(
						eq(searchRegistry.contentType, 'episode'),
						inArray(searchRegistry.contentId, episodeIds)
					)
				)
				.returning({ id: searchRegistry.id });

			affected += result.length;
		}
	}

	// Handle movies
	if (movieIds.length > 0) {
		const result = await db
			.update(searchRegistry)
			.set({ priority: clampedPriority, updatedAt: new Date() })
			.where(
				and(eq(searchRegistry.contentType, 'movie'), inArray(searchRegistry.contentId, movieIds))
			)
			.returning({ id: searchRegistry.id });

		affected += result.length;
	}

	return { affected, skipped: 0 };
}

export async function bulkMarkExhausted(targets: BulkActionTarget[]): Promise<BulkActionResult> {
	if (targets.length === 0) {
		return { affected: 0, skipped: 0 };
	}

	const seriesIds = targets.filter((t) => t.type === 'series').map((t) => t.id);
	const movieIds = targets.filter((t) => t.type === 'movie').map((t) => t.id);

	let affected = 0;
	let skipped = 0;

	// Handle series - update all episode entries (skip items currently searching)
	if (seriesIds.length > 0) {
		// Get episode IDs for these series
		const episodeRows = await db
			.select({ id: episodes.id })
			.from(episodes)
			.innerJoin(seasons, eq(episodes.seasonId, seasons.id))
			.where(inArray(seasons.seriesId, seriesIds));

		const episodeIds = episodeRows.map((e) => e.id);

		if (episodeIds.length > 0) {
			// Count items that will be skipped (currently searching)
			const searchingCount = await db
				.select({ count: count() })
				.from(searchRegistry)
				.where(
					and(
						eq(searchRegistry.contentType, 'episode'),
						inArray(searchRegistry.contentId, episodeIds),
						eq(searchRegistry.state, 'searching')
					)
				);
			skipped += searchingCount[0]?.count ?? 0;

			// Update entries that are not currently searching
			const result = await db
				.update(searchRegistry)
				.set({
					state: 'exhausted',
					nextEligible: null,
					updatedAt: new Date()
				})
				.where(
					and(
						eq(searchRegistry.contentType, 'episode'),
						inArray(searchRegistry.contentId, episodeIds),
						sql`${searchRegistry.state} != 'searching'`
					)
				)
				.returning({ id: searchRegistry.id });

			affected += result.length;
		}
	}

	// Handle movies
	if (movieIds.length > 0) {
		// Count items that will be skipped (currently searching)
		const searchingCount = await db
			.select({ count: count() })
			.from(searchRegistry)
			.where(
				and(
					eq(searchRegistry.contentType, 'movie'),
					inArray(searchRegistry.contentId, movieIds),
					eq(searchRegistry.state, 'searching')
				)
			);
		skipped += searchingCount[0]?.count ?? 0;

		// Update entries that are not currently searching
		const result = await db
			.update(searchRegistry)
			.set({
				state: 'exhausted',
				nextEligible: null,
				updatedAt: new Date()
			})
			.where(
				and(
					eq(searchRegistry.contentType, 'movie'),
					inArray(searchRegistry.contentId, movieIds),
					sql`${searchRegistry.state} != 'searching'`
				)
			)
			.returning({ id: searchRegistry.id });

		affected += result.length;
	}

	return { affected, skipped };
}

export async function bulkClearSearchState(targets: BulkActionTarget[]): Promise<BulkActionResult> {
	if (targets.length === 0) {
		return { affected: 0, skipped: 0 };
	}

	const seriesIds = targets.filter((t) => t.type === 'series').map((t) => t.id);
	const movieIds = targets.filter((t) => t.type === 'movie').map((t) => t.id);

	let affected = 0;
	let skipped = 0;

	// Handle series - reset all episode entries
	if (seriesIds.length > 0) {
		// Get episode IDs for these series
		const episodeRows = await db
			.select({ id: episodes.id })
			.from(episodes)
			.innerJoin(seasons, eq(episodes.seasonId, seasons.id))
			.where(inArray(seasons.seriesId, seriesIds));

		const episodeIds = episodeRows.map((e) => e.id);

		if (episodeIds.length > 0) {
			// Count items that will be skipped (currently searching)
			const searchingCount = await db
				.select({ count: count() })
				.from(searchRegistry)
				.where(
					and(
						eq(searchRegistry.contentType, 'episode'),
						inArray(searchRegistry.contentId, episodeIds),
						eq(searchRegistry.state, 'searching')
					)
				);
			skipped += searchingCount[0]?.count ?? 0;

			// Reset entries that are not currently searching
			const result = await db
				.update(searchRegistry)
				.set({
					state: 'pending',
					attemptCount: 0,
					failureCategory: null,
					nextEligible: null,
					seasonPackFailed: false,
					updatedAt: new Date()
				})
				.where(
					and(
						eq(searchRegistry.contentType, 'episode'),
						inArray(searchRegistry.contentId, episodeIds),
						sql`${searchRegistry.state} != 'searching'`
					)
				)
				.returning({ id: searchRegistry.id });

			affected += result.length;
		}
	}

	// Handle movies
	if (movieIds.length > 0) {
		// Count items that will be skipped (currently searching)
		const searchingCount = await db
			.select({ count: count() })
			.from(searchRegistry)
			.where(
				and(
					eq(searchRegistry.contentType, 'movie'),
					inArray(searchRegistry.contentId, movieIds),
					eq(searchRegistry.state, 'searching')
				)
			);
		skipped += searchingCount[0]?.count ?? 0;

		// Reset entries that are not currently searching
		const result = await db
			.update(searchRegistry)
			.set({
				state: 'pending',
				attemptCount: 0,
				failureCategory: null,
				nextEligible: null,
				updatedAt: new Date()
			})
			.where(
				and(
					eq(searchRegistry.contentType, 'movie'),
					inArray(searchRegistry.contentId, movieIds),
					sql`${searchRegistry.state} != 'searching'`
				)
			)
			.returning({ id: searchRegistry.id });

		affected += result.length;
	}

	return { affected, skipped };
}
