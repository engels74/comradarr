import { and, eq, gte, sql } from 'drizzle-orm';
import { db } from '../index';
import {
	connectors,
	episodes,
	movies,
	searchHistory,
	searchRegistry,
	seasons,
	series,
	syncState
} from '../schema';

export interface ActivityItem {
	/** Unique identifier with type prefix (e.g., 'search-1', 'discovery-2', 'sync-3') */
	id: string;
	/** Type of activity */
	type: 'search' | 'discovery' | 'sync';
	/** Timestamp of the activity */
	timestamp: Date;

	// Search-specific fields
	/** Search outcome (success, no_results, error, timeout) */
	outcome?: string | undefined;
	/** Content type for searches */
	contentType?: 'episode' | 'movie' | undefined;
	/** Episode or movie title */
	contentTitle?: string | undefined;
	/** Series title for episodes */
	seriesTitle?: string | undefined;
	/** Season number for episodes */
	seasonNumber?: number | undefined;
	/** Episode number for episodes */
	episodeNumber?: number | undefined;

	// Discovery-specific fields
	/** Type of discovery (gap or upgrade) */
	searchType?: 'gap' | 'upgrade' | undefined;

	// Common connector fields
	/** Connector ID */
	connectorId?: number | undefined;
	/** Connector display name */
	connectorName?: string | undefined;
	/** Connector type (sonarr, radarr, whisparr) */
	connectorType?: string | undefined;
}

export async function getRecentActivity(limit: number = 20): Promise<ActivityItem[]> {
	// Time threshold for recent activity (last 24 hours for discoveries/syncs)
	const recentThreshold = new Date(Date.now() - 24 * 60 * 60 * 1000);

	// 1. Search outcomes from search_history (episode)
	const episodeSearches = db
		.select({
			id: sql<string>`'search-' || ${searchHistory.id}::text`.as('id'),
			type: sql<'search'>`'search'::text`.as('type'),
			timestamp: sql<Date>`${searchHistory.createdAt}`.as('timestamp'),
			outcome: sql<string | null>`${searchHistory.outcome}`.as('outcome'),
			contentType: sql<'episode'>`'episode'::text`.as('content_type'),
			contentTitle: sql<string>`${episodes.title}`.as('content_title'),
			seriesTitle: sql<string>`${series.title}`.as('series_title'),
			seasonNumber: sql<number>`${episodes.seasonNumber}`.as('season_number'),
			episodeNumber: sql<number>`${episodes.episodeNumber}`.as('episode_number'),
			searchType: sql<null>`NULL::text`.as('search_type'),
			connectorId: sql<number>`${searchHistory.connectorId}`.as('connector_id'),
			connectorName: sql<string>`${connectors.name}`.as('connector_name'),
			connectorType: sql<string>`${connectors.type}`.as('connector_type')
		})
		.from(searchHistory)
		.innerJoin(connectors, eq(searchHistory.connectorId, connectors.id))
		.innerJoin(episodes, eq(searchHistory.contentId, episodes.id))
		.innerJoin(seasons, eq(episodes.seasonId, seasons.id))
		.innerJoin(series, eq(seasons.seriesId, series.id))
		.where(eq(searchHistory.contentType, 'episode'));

	// 2. Search outcomes from search_history (movie)
	const movieSearches = db
		.select({
			id: sql<string>`'search-' || ${searchHistory.id}::text`.as('id'),
			type: sql<'search'>`'search'::text`.as('type'),
			timestamp: sql<Date>`${searchHistory.createdAt}`.as('timestamp'),
			outcome: sql<string | null>`${searchHistory.outcome}`.as('outcome'),
			contentType: sql<'movie'>`'movie'::text`.as('content_type'),
			contentTitle: sql<string>`${movies.title}`.as('content_title'),
			seriesTitle: sql<null>`NULL::text`.as('series_title'),
			seasonNumber: sql<null>`NULL::integer`.as('season_number'),
			episodeNumber: sql<null>`NULL::integer`.as('episode_number'),
			searchType: sql<null>`NULL::text`.as('search_type'),
			connectorId: sql<number>`${searchHistory.connectorId}`.as('connector_id'),
			connectorName: sql<string>`${connectors.name}`.as('connector_name'),
			connectorType: sql<string>`${connectors.type}`.as('connector_type')
		})
		.from(searchHistory)
		.innerJoin(connectors, eq(searchHistory.connectorId, connectors.id))
		.innerJoin(movies, eq(searchHistory.contentId, movies.id))
		.where(eq(searchHistory.contentType, 'movie'));

	// 3. Recent discoveries from search_registry (episodes)
	const episodeDiscoveries = db
		.select({
			id: sql<string>`'discovery-' || ${searchRegistry.id}::text`.as('id'),
			type: sql<'discovery'>`'discovery'::text`.as('type'),
			timestamp: sql<Date>`${searchRegistry.createdAt}`.as('timestamp'),
			outcome: sql<null>`NULL::text`.as('outcome'),
			contentType: sql<'episode'>`'episode'::text`.as('content_type'),
			contentTitle: sql<string>`${episodes.title}`.as('content_title'),
			seriesTitle: sql<string>`${series.title}`.as('series_title'),
			seasonNumber: sql<number>`${episodes.seasonNumber}`.as('season_number'),
			episodeNumber: sql<number>`${episodes.episodeNumber}`.as('episode_number'),
			searchType: sql<string>`${searchRegistry.searchType}`.as('search_type'),
			connectorId: sql<number>`${searchRegistry.connectorId}`.as('connector_id'),
			connectorName: sql<string>`${connectors.name}`.as('connector_name'),
			connectorType: sql<string>`${connectors.type}`.as('connector_type')
		})
		.from(searchRegistry)
		.innerJoin(connectors, eq(searchRegistry.connectorId, connectors.id))
		.innerJoin(episodes, eq(searchRegistry.contentId, episodes.id))
		.innerJoin(seasons, eq(episodes.seasonId, seasons.id))
		.innerJoin(series, eq(seasons.seriesId, series.id))
		.where(
			and(
				eq(searchRegistry.contentType, 'episode'),
				eq(searchRegistry.state, 'pending'),
				gte(searchRegistry.createdAt, recentThreshold)
			)
		);

	// 4. Recent discoveries from search_registry (movies)
	const movieDiscoveries = db
		.select({
			id: sql<string>`'discovery-' || ${searchRegistry.id}::text`.as('id'),
			type: sql<'discovery'>`'discovery'::text`.as('type'),
			timestamp: sql<Date>`${searchRegistry.createdAt}`.as('timestamp'),
			outcome: sql<null>`NULL::text`.as('outcome'),
			contentType: sql<'movie'>`'movie'::text`.as('content_type'),
			contentTitle: sql<string>`${movies.title}`.as('content_title'),
			seriesTitle: sql<null>`NULL::text`.as('series_title'),
			seasonNumber: sql<null>`NULL::integer`.as('season_number'),
			episodeNumber: sql<null>`NULL::integer`.as('episode_number'),
			searchType: sql<string>`${searchRegistry.searchType}`.as('search_type'),
			connectorId: sql<number>`${searchRegistry.connectorId}`.as('connector_id'),
			connectorName: sql<string>`${connectors.name}`.as('connector_name'),
			connectorType: sql<string>`${connectors.type}`.as('connector_type')
		})
		.from(searchRegistry)
		.innerJoin(connectors, eq(searchRegistry.connectorId, connectors.id))
		.innerJoin(movies, eq(searchRegistry.contentId, movies.id))
		.where(
			and(
				eq(searchRegistry.contentType, 'movie'),
				eq(searchRegistry.state, 'pending'),
				gte(searchRegistry.createdAt, recentThreshold)
			)
		);

	// 5. Recent syncs from sync_state
	const recentSyncs = db
		.select({
			id: sql<string>`'sync-' || ${syncState.id}::text`.as('id'),
			type: sql<'sync'>`'sync'::text`.as('type'),
			timestamp: sql<Date>`${syncState.lastSync}`.as('timestamp'),
			outcome: sql<null>`NULL::text`.as('outcome'),
			contentType: sql<null>`NULL::text`.as('content_type'),
			contentTitle: sql<null>`NULL::text`.as('content_title'),
			seriesTitle: sql<null>`NULL::text`.as('series_title'),
			seasonNumber: sql<null>`NULL::integer`.as('season_number'),
			episodeNumber: sql<null>`NULL::integer`.as('episode_number'),
			searchType: sql<null>`NULL::text`.as('search_type'),
			connectorId: sql<number>`${syncState.connectorId}`.as('connector_id'),
			connectorName: sql<string>`${connectors.name}`.as('connector_name'),
			connectorType: sql<string>`${connectors.type}`.as('connector_type')
		})
		.from(syncState)
		.innerJoin(connectors, eq(syncState.connectorId, connectors.id))
		.where(gte(syncState.lastSync, recentThreshold));

	// Combine all queries with UNION ALL and sort by timestamp DESC
	const unionQuery = sql`
		(${episodeSearches})
		UNION ALL
		(${movieSearches})
		UNION ALL
		(${episodeDiscoveries})
		UNION ALL
		(${movieDiscoveries})
		UNION ALL
		(${recentSyncs})
		ORDER BY timestamp DESC
		LIMIT ${limit}
	`;

	const results = await db.execute(unionQuery);

	// Map rows to typed ActivityItem, normalizing NULL → undefined
	return (results as Record<string, unknown>[]).map((row) => ({
		id: row.id as string,
		type: row.type as 'search' | 'discovery' | 'sync',
		timestamp: new Date(row.timestamp as string),
		outcome: (row.outcome as string | null) ?? undefined,
		contentType: (row.content_type as 'episode' | 'movie' | null) ?? undefined,
		contentTitle: (row.content_title as string | null) ?? undefined,
		seriesTitle: (row.series_title as string | null) ?? undefined,
		seasonNumber: (row.season_number as number | null) ?? undefined,
		episodeNumber: (row.episode_number as number | null) ?? undefined,
		searchType: (row.search_type as 'gap' | 'upgrade' | null) ?? undefined,
		connectorId: (row.connector_id as number | null) ?? undefined,
		connectorName: (row.connector_name as string | null) ?? undefined,
		connectorType: (row.connector_type as string | null) ?? undefined
	}));
}
