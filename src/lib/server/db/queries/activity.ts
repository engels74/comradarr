/**
 * Activity feed query functions.
 * Display recent discoveries, search outcomes, and system events.
 */

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

// =============================================================================
// Types
// =============================================================================

/**
 * Activity item returned from the database.
 */
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

// =============================================================================
// Activity Feed Query
// =============================================================================

/**
 * Get recent activity for the dashboard feed.
 * Combines search outcomes, discoveries, and sync events.
 *
 * @param limit - Maximum number of activity items to return
 * @returns Array of activity items sorted by timestamp descending
 */
export async function getRecentActivity(limit: number = 20): Promise<ActivityItem[]> {
	// Time threshold for recent activity (last 24 hours for discoveries/syncs)
	const recentThreshold = new Date(Date.now() - 24 * 60 * 60 * 1000);

	// 1. Search outcomes from search_history (episode)
	const episodeSearches = db
		.select({
			id: sql<string>`'search-' || ${searchHistory.id}::text`.as('id'),
			type: sql<'search'>`'search'::text`.as('type'),
			timestamp: sql<Date>`${searchHistory.createdAt}`.as('timestamp'),
			outcome: searchHistory.outcome,
			contentType: sql<'episode'>`'episode'::text`.as('content_type'),
			contentTitle: episodes.title,
			seriesTitle: series.title,
			seasonNumber: episodes.seasonNumber,
			episodeNumber: episodes.episodeNumber,
			searchType: sql<null>`NULL::text`.as('search_type'),
			connectorId: searchHistory.connectorId,
			connectorName: connectors.name,
			connectorType: connectors.type
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
			outcome: searchHistory.outcome,
			contentType: sql<'movie'>`'movie'::text`.as('content_type'),
			contentTitle: movies.title,
			seriesTitle: sql<null>`NULL::text`.as('series_title'),
			seasonNumber: sql<null>`NULL::integer`.as('season_number'),
			episodeNumber: sql<null>`NULL::integer`.as('episode_number'),
			searchType: sql<null>`NULL::text`.as('search_type'),
			connectorId: searchHistory.connectorId,
			connectorName: connectors.name,
			connectorType: connectors.type
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
			contentTitle: episodes.title,
			seriesTitle: series.title,
			seasonNumber: episodes.seasonNumber,
			episodeNumber: episodes.episodeNumber,
			searchType: searchRegistry.searchType,
			connectorId: searchRegistry.connectorId,
			connectorName: connectors.name,
			connectorType: connectors.type
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
			contentTitle: movies.title,
			seriesTitle: sql<null>`NULL::text`.as('series_title'),
			seasonNumber: sql<null>`NULL::integer`.as('season_number'),
			episodeNumber: sql<null>`NULL::integer`.as('episode_number'),
			searchType: searchRegistry.searchType,
			connectorId: searchRegistry.connectorId,
			connectorName: connectors.name,
			connectorType: connectors.type
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
			connectorId: syncState.connectorId,
			connectorName: connectors.name,
			connectorType: connectors.type
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

	// Map rows to typed ActivityItem
	return (results as Record<string, unknown>[]).map((row) => ({
		id: row.id as string,
		type: row.type as 'search' | 'discovery' | 'sync',
		timestamp: new Date(row.timestamp as string),
		outcome: row.outcome as string | undefined,
		contentType: row.content_type as 'episode' | 'movie' | undefined,
		contentTitle: row.contenttitle as string | undefined,
		seriesTitle: row.series_title as string | undefined,
		seasonNumber: row.seasonnumber as number | undefined,
		episodeNumber: row.episodenumber as number | undefined,
		searchType: row.search_type as 'gap' | 'upgrade' | undefined,
		connectorId: row.connectorid as number | undefined,
		connectorName: row.connectorname as string | undefined,
		connectorType: row.connectortype as string | undefined
	}));
}
