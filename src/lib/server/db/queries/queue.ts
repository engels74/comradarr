/**
 * Database queries for queue management operations.
 *
 * Requirements: 18.1
 *
 * Provides queue queries for:
 * - Queue items in priority order with content joins
 * - Status counts for filter badges
 * - Throttle info for dispatch time estimation
 */

import { db } from '$lib/server/db';
import {
	connectors,
	episodes,
	movies,
	requestQueue,
	searchHistory,
	searchRegistry,
	seasons,
	series,
	throttleProfiles,
	throttleState
} from '$lib/server/db/schema';
import { and, asc, count, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';

// =============================================================================
// Types
// =============================================================================

/**
 * Queue state filter values.
 */
export type QueueState = 'all' | 'queued' | 'searching' | 'cooldown' | 'pending' | 'exhausted';

/**
 * Content type filter values.
 */
export type QueueContentType = 'all' | 'episode' | 'movie';

/**
 * Search type filter values.
 */
export type QueueSearchType = 'all' | 'gap' | 'upgrade';

/**
 * Filter options for queue queries.
 */
export interface QueueFilters {
	connectorId?: number | undefined;
	state?: QueueState | undefined;
	contentType?: QueueContentType | undefined;
	searchType?: QueueSearchType | undefined;
	search?: string | undefined;
	limit?: number | undefined;
	offset?: number | undefined;
}

/**
 * Queue item with joined content data for display.
 */
export interface QueueItemWithContent {
	id: number;
	searchRegistryId: number;
	connectorId: number;
	connectorName: string;
	connectorType: string;
	contentType: 'episode' | 'movie';
	contentId: number;
	title: string;
	seriesTitle: string | null;
	seasonNumber: number | null;
	episodeNumber: number | null;
	year: number | null;
	searchType: 'gap' | 'upgrade';
	state: 'pending' | 'queued' | 'searching' | 'cooldown' | 'exhausted';
	priority: number;
	attemptCount: number;
	scheduledAt: Date | null;
	createdAt: Date;
}

/**
 * Result from queue list query with pagination info.
 */
export interface QueueListResult {
	items: QueueItemWithContent[];
	total: number;
}

/**
 * Status counts for filter badges.
 */
export interface QueueStatusCounts {
	all: number;
	pending: number;
	queued: number;
	searching: number;
	cooldown: number;
	exhausted: number;
}

/**
 * Connector info for filter dropdown.
 */
export interface QueueConnector {
	id: number;
	name: string;
	type: string;
	queueCount: number;
}

/**
 * Throttle info for dispatch time estimation.
 */
export interface QueueThrottleInfo {
	connectorId: number;
	isPaused: boolean;
	pausedUntil: Date | null;
	pauseReason: string | null;
	requestsPerMinute: number;
	requestsThisMinute: number;
	dailyBudget: number | null;
	requestsToday: number;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Parse and validate queue filters with defaults.
 */
export function parseQueueFilters(searchParams: URLSearchParams): QueueFilters {
	const connectorParam = searchParams.get('connector');
	const pageParam = searchParams.get('page');
	const limitParam = searchParams.get('limit');

	return {
		connectorId: connectorParam ? Number(connectorParam) : undefined,
		state: (searchParams.get('state') as QueueState) ?? 'all',
		contentType: (searchParams.get('type') as QueueContentType) ?? 'all',
		searchType: (searchParams.get('searchType') as QueueSearchType) ?? 'all',
		search: searchParams.get('search') ?? undefined,
		limit: limitParam ? Math.min(100, Math.max(10, Number(limitParam))) : 50,
		offset: pageParam ? (Math.max(1, Number(pageParam)) - 1) * (limitParam ? Number(limitParam) : 50) : 0
	};
}

// =============================================================================
// Queue List Query
// =============================================================================

/**
 * Gets queue items with content data, sorted by priority (highest first).
 *
 * Query approach:
 * - UNION episode queue items and movie queue items
 * - For episodes: join through seasons -> series for full title
 * - For movies: direct join
 * - Sort by priority DESC, then scheduled time ASC
 *
 * Requirements: 18.1
 */
export async function getQueueList(filters: QueueFilters): Promise<QueueListResult> {
	// Build base conditions for search registry
	const buildConditions = (): SQL[] => {
		const conditions: SQL[] = [];

		// Connector filter
		if (filters.connectorId !== undefined) {
			conditions.push(eq(searchRegistry.connectorId, filters.connectorId));
		}

		// State filter - default to showing active queue items (queued, searching)
		if (filters.state && filters.state !== 'all') {
			conditions.push(eq(searchRegistry.state, filters.state));
		}

		// Search type filter
		if (filters.searchType && filters.searchType !== 'all') {
			conditions.push(eq(searchRegistry.searchType, filters.searchType));
		}

		return conditions;
	};

	// Episode query
	const episodeConditions = buildConditions();
	episodeConditions.push(eq(searchRegistry.contentType, 'episode'));

	if (filters.contentType && filters.contentType !== 'all' && filters.contentType !== 'episode') {
		// If filtering for movies only, skip episodes
		episodeConditions.push(sql`false`);
	}

	// Apply search filter to episode titles and series titles
	if (filters.search) {
		episodeConditions.push(
			or(
				ilike(episodes.title, `%${filters.search}%`),
				ilike(series.title, `%${filters.search}%`)
			)!
		);
	}

	const episodeQuery = db
		.select({
			id: searchRegistry.id,
			searchRegistryId: searchRegistry.id,
			connectorId: searchRegistry.connectorId,
			connectorName: connectors.name,
			connectorType: connectors.type,
			contentType: sql<'episode'>`'episode'::text`.as('content_type'),
			contentId: searchRegistry.contentId,
			title: sql<string>`COALESCE(${episodes.title}, 'Episode ' || ${episodes.seasonNumber} || 'x' || LPAD(${episodes.episodeNumber}::text, 2, '0'))`.as('title'),
			seriesTitle: series.title,
			seasonNumber: episodes.seasonNumber,
			episodeNumber: episodes.episodeNumber,
			year: sql<number | null>`NULL::integer`.as('year'),
			searchType: sql<'gap' | 'upgrade'>`${searchRegistry.searchType}`.as('search_type'),
			state: sql<'pending' | 'queued' | 'searching' | 'cooldown' | 'exhausted'>`${searchRegistry.state}`.as('state'),
			priority: searchRegistry.priority,
			attemptCount: searchRegistry.attemptCount,
			scheduledAt: requestQueue.scheduledAt,
			createdAt: searchRegistry.createdAt
		})
		.from(searchRegistry)
		.innerJoin(connectors, eq(searchRegistry.connectorId, connectors.id))
		.innerJoin(episodes, eq(searchRegistry.contentId, episodes.id))
		.innerJoin(seasons, eq(episodes.seasonId, seasons.id))
		.innerJoin(series, eq(seasons.seriesId, series.id))
		.leftJoin(requestQueue, eq(searchRegistry.id, requestQueue.searchRegistryId))
		.where(episodeConditions.length > 0 ? and(...episodeConditions) : undefined);

	// Movie query
	const movieConditions = buildConditions();
	movieConditions.push(eq(searchRegistry.contentType, 'movie'));

	if (filters.contentType && filters.contentType !== 'all' && filters.contentType !== 'movie') {
		// If filtering for episodes only, skip movies
		movieConditions.push(sql`false`);
	}

	// Apply search filter to movie titles
	if (filters.search) {
		movieConditions.push(ilike(movies.title, `%${filters.search}%`));
	}

	const movieQuery = db
		.select({
			id: searchRegistry.id,
			searchRegistryId: searchRegistry.id,
			connectorId: searchRegistry.connectorId,
			connectorName: connectors.name,
			connectorType: connectors.type,
			contentType: sql<'movie'>`'movie'::text`.as('content_type'),
			contentId: searchRegistry.contentId,
			title: movies.title,
			seriesTitle: sql<string | null>`NULL::text`.as('series_title'),
			seasonNumber: sql<number | null>`NULL::integer`.as('season_number'),
			episodeNumber: sql<number | null>`NULL::integer`.as('episode_number'),
			year: movies.year,
			searchType: sql<'gap' | 'upgrade'>`${searchRegistry.searchType}`.as('search_type'),
			state: sql<'pending' | 'queued' | 'searching' | 'cooldown' | 'exhausted'>`${searchRegistry.state}`.as('state'),
			priority: searchRegistry.priority,
			attemptCount: searchRegistry.attemptCount,
			scheduledAt: requestQueue.scheduledAt,
			createdAt: searchRegistry.createdAt
		})
		.from(searchRegistry)
		.innerJoin(connectors, eq(searchRegistry.connectorId, connectors.id))
		.innerJoin(movies, eq(searchRegistry.contentId, movies.id))
		.leftJoin(requestQueue, eq(searchRegistry.id, requestQueue.searchRegistryId))
		.where(movieConditions.length > 0 ? and(...movieConditions) : undefined);

	// Combine with UNION ALL and sort
	const unionQuery = sql`
		(${episodeQuery})
		UNION ALL
		(${movieQuery})
		ORDER BY priority DESC, scheduled_at ASC NULLS LAST, created_at ASC
		LIMIT ${filters.limit ?? 50}
		OFFSET ${filters.offset ?? 0}
	`;

	const items = await db.execute(unionQuery);

	// Get total count
	const countConditions = buildConditions();

	// For content type filter on count
	if (filters.contentType && filters.contentType !== 'all') {
		countConditions.push(eq(searchRegistry.contentType, filters.contentType));
	}

	const totalResult = await db
		.select({ count: count() })
		.from(searchRegistry)
		.where(countConditions.length > 0 ? and(...countConditions) : undefined);

	// Map rows to typed items
	const mappedItems: QueueItemWithContent[] = (items as Record<string, unknown>[]).map((row) => ({
		id: row.id as number,
		searchRegistryId: row.searchregistryid as number,
		connectorId: row.connectorid as number,
		connectorName: row.connectorname as string,
		connectorType: row.connectortype as string,
		contentType: row.content_type as 'episode' | 'movie',
		contentId: row.contentid as number,
		title: row.title as string,
		seriesTitle: row.series_title as string | null,
		seasonNumber: row.season_number as number | null,
		episodeNumber: row.episode_number as number | null,
		year: row.year as number | null,
		searchType: row.search_type as 'gap' | 'upgrade',
		state: row.state as 'pending' | 'queued' | 'searching' | 'cooldown' | 'exhausted',
		priority: row.priority as number,
		attemptCount: row.attemptcount as number,
		scheduledAt: row.scheduledat ? new Date(row.scheduledat as string) : null,
		createdAt: new Date(row.createdat as string)
	}));

	return {
		items: mappedItems,
		total: totalResult[0]?.count ?? 0
	};
}

// =============================================================================
// Status Counts Query
// =============================================================================

/**
 * Gets counts of queue items by state for filter badges.
 */
export async function getQueueStatusCounts(connectorId?: number): Promise<QueueStatusCounts> {
	const conditions: SQL[] = [];

	if (connectorId !== undefined) {
		conditions.push(eq(searchRegistry.connectorId, connectorId));
	}

	const result = await db
		.select({
			state: searchRegistry.state,
			count: count()
		})
		.from(searchRegistry)
		.where(conditions.length > 0 ? and(...conditions) : undefined)
		.groupBy(searchRegistry.state);

	const counts: QueueStatusCounts = {
		all: 0,
		pending: 0,
		queued: 0,
		searching: 0,
		cooldown: 0,
		exhausted: 0
	};

	for (const row of result) {
		const state = row.state as keyof Omit<QueueStatusCounts, 'all'>;
		if (state in counts) {
			counts[state] = row.count;
		}
		counts.all += row.count;
	}

	return counts;
}

// =============================================================================
// Connectors for Filter Query
// =============================================================================

/**
 * Gets connectors with queue item counts for filter dropdown.
 */
export async function getConnectorsForQueueFilter(): Promise<QueueConnector[]> {
	const result = await db
		.select({
			id: connectors.id,
			name: connectors.name,
			type: connectors.type,
			queueCount: sql<number>`COALESCE(queue_counts.queue_count, 0)::int`.as('queue_count')
		})
		.from(connectors)
		.leftJoin(
			sql`(
				SELECT connector_id, COUNT(*) as queue_count
				FROM search_registry
				WHERE state IN ('pending', 'queued', 'searching', 'cooldown')
				GROUP BY connector_id
			) AS queue_counts`,
			sql`queue_counts.connector_id = ${connectors.id}`
		)
		.where(eq(connectors.enabled, true))
		.orderBy(asc(connectors.name));

	return result.map((row) => ({
		id: row.id,
		name: row.name,
		type: row.type,
		queueCount: row.queueCount
	}));
}

// =============================================================================
// Throttle Info Query
// =============================================================================

/**
 * Gets throttle information for dispatch time estimation.
 */
export async function getThrottleInfo(connectorId: number): Promise<QueueThrottleInfo | null> {
	const result = await db
		.select({
			connectorId: connectors.id,
			queuePaused: connectors.queuePaused,
			pausedUntil: throttleState.pausedUntil,
			pauseReason: throttleState.pauseReason,
			requestsThisMinute: throttleState.requestsThisMinute,
			requestsToday: throttleState.requestsToday,
			// Join throttle profile (or use defaults)
			requestsPerMinute: sql<number>`COALESCE(${throttleProfiles.requestsPerMinute}, 5)`.as('requests_per_minute'),
			dailyBudget: throttleProfiles.dailyBudget
		})
		.from(connectors)
		.leftJoin(throttleState, eq(connectors.id, throttleState.connectorId))
		.leftJoin(throttleProfiles, eq(connectors.throttleProfileId, throttleProfiles.id))
		.where(eq(connectors.id, connectorId))
		.limit(1);

	if (result.length === 0) {
		return null;
	}

	const row = result[0]!;
	const now = new Date();
	const isPaused = row.queuePaused || (row.pausedUntil !== null && row.pausedUntil > now);

	return {
		connectorId: row.connectorId,
		isPaused,
		pausedUntil: row.pausedUntil,
		pauseReason: row.pauseReason,
		requestsPerMinute: row.requestsPerMinute,
		requestsThisMinute: row.requestsThisMinute ?? 0,
		dailyBudget: row.dailyBudget,
		requestsToday: row.requestsToday ?? 0
	};
}

/**
 * Gets throttle info for all connectors (for global view).
 */
export async function getAllThrottleInfo(): Promise<Map<number, QueueThrottleInfo>> {
	const result = await db
		.select({
			connectorId: connectors.id,
			queuePaused: connectors.queuePaused,
			pausedUntil: throttleState.pausedUntil,
			pauseReason: throttleState.pauseReason,
			requestsThisMinute: throttleState.requestsThisMinute,
			requestsToday: throttleState.requestsToday,
			requestsPerMinute: sql<number>`COALESCE(${throttleProfiles.requestsPerMinute}, 5)`.as('requests_per_minute'),
			dailyBudget: throttleProfiles.dailyBudget
		})
		.from(connectors)
		.leftJoin(throttleState, eq(connectors.id, throttleState.connectorId))
		.leftJoin(throttleProfiles, eq(connectors.throttleProfileId, throttleProfiles.id))
		.where(eq(connectors.enabled, true));

	const now = new Date();
	const map = new Map<number, QueueThrottleInfo>();

	for (const row of result) {
		const isPaused = row.queuePaused || (row.pausedUntil !== null && row.pausedUntil > now);
		map.set(row.connectorId, {
			connectorId: row.connectorId,
			isPaused,
			pausedUntil: row.pausedUntil,
			pauseReason: row.pauseReason,
			requestsPerMinute: row.requestsPerMinute,
			requestsThisMinute: row.requestsThisMinute ?? 0,
			dailyBudget: row.dailyBudget,
			requestsToday: row.requestsToday ?? 0
		});
	}

	return map;
}

// =============================================================================
// Queue Control Operations
// =============================================================================

/**
 * Pause status for a connector.
 */
export interface ConnectorPauseStatus {
	id: number;
	name: string;
	type: string;
	queuePaused: boolean;
	queueCount: number;
}

/**
 * Gets pause status for all enabled connectors.
 */
export async function getQueuePauseStatus(): Promise<ConnectorPauseStatus[]> {
	const result = await db
		.select({
			id: connectors.id,
			name: connectors.name,
			type: connectors.type,
			queuePaused: connectors.queuePaused,
			queueCount: sql<number>`COALESCE(queue_counts.queue_count, 0)::int`.as('queue_count')
		})
		.from(connectors)
		.leftJoin(
			sql`(
				SELECT connector_id, COUNT(*) as queue_count
				FROM search_registry
				WHERE state IN ('queued', 'searching')
				GROUP BY connector_id
			) AS queue_counts`,
			sql`queue_counts.connector_id = ${connectors.id}`
		)
		.where(eq(connectors.enabled, true))
		.orderBy(asc(connectors.name));

	return result.map((row) => ({
		id: row.id,
		name: row.name,
		type: row.type,
		queuePaused: row.queuePaused,
		queueCount: row.queueCount
	}));
}

/**
 * Updates priority for queue items.
 *
 * Updates both the search_registry.priority and request_queue.priority fields.
 *
 * @param registryIds - Search registry IDs to update
 * @param priority - New priority value (0-100 user override, will be added to calculated priority)
 * @returns Number of items updated
 */
export async function updateQueueItemPriority(
	registryIds: number[],
	priority: number
): Promise<number> {
	if (registryIds.length === 0) return 0;

	const now = new Date();

	// Update search_registry priority
	const updated = await db
		.update(searchRegistry)
		.set({
			priority,
			updatedAt: now
		})
		.where(inArray(searchRegistry.id, registryIds))
		.returning({ id: searchRegistry.id });

	// Also update request_queue if items are in queue
	await db
		.update(requestQueue)
		.set({ priority })
		.where(inArray(requestQueue.searchRegistryId, registryIds));

	return updated.length;
}

/**
 * Removes items from the queue and resets their state.
 *
 * Deletes from request_queue and resets search_registry state to 'pending'.
 *
 * @param registryIds - Search registry IDs to remove from queue
 * @returns Number of items removed
 */
export async function removeFromQueueByIds(registryIds: number[]): Promise<number> {
	if (registryIds.length === 0) return 0;

	const now = new Date();

	// Delete from request_queue
	const deleted = await db
		.delete(requestQueue)
		.where(inArray(requestQueue.searchRegistryId, registryIds))
		.returning({ id: requestQueue.id });

	// Reset search_registry state to 'pending' for items that were queued
	await db
		.update(searchRegistry)
		.set({
			state: 'pending',
			updatedAt: now
		})
		.where(
			and(
				inArray(searchRegistry.id, registryIds),
				eq(searchRegistry.state, 'queued')
			)
		);

	return deleted.length;
}

/**
 * Pauses queue processing for specified connectors.
 *
 * @param connectorIds - Connector IDs to pause (empty array = all connectors)
 * @returns Number of connectors updated
 */
export async function pauseQueueForConnectors(connectorIds?: number[]): Promise<number> {
	const now = new Date();

	if (connectorIds && connectorIds.length > 0) {
		const updated = await db
			.update(connectors)
			.set({
				queuePaused: true,
				updatedAt: now
			})
			.where(inArray(connectors.id, connectorIds))
			.returning({ id: connectors.id });
		return updated.length;
	} else {
		// Pause all enabled connectors
		const updated = await db
			.update(connectors)
			.set({
				queuePaused: true,
				updatedAt: now
			})
			.where(eq(connectors.enabled, true))
			.returning({ id: connectors.id });
		return updated.length;
	}
}

/**
 * Resumes queue processing for specified connectors.
 *
 * @param connectorIds - Connector IDs to resume (empty array = all connectors)
 * @returns Number of connectors updated
 */
export async function resumeQueueForConnectors(connectorIds?: number[]): Promise<number> {
	const now = new Date();

	if (connectorIds && connectorIds.length > 0) {
		const updated = await db
			.update(connectors)
			.set({
				queuePaused: false,
				updatedAt: now
			})
			.where(inArray(connectors.id, connectorIds))
			.returning({ id: connectors.id });
		return updated.length;
	} else {
		// Resume all enabled connectors
		const updated = await db
			.update(connectors)
			.set({
				queuePaused: false,
				updatedAt: now
			})
			.where(eq(connectors.enabled, true))
			.returning({ id: connectors.id });
		return updated.length;
	}
}

/**
 * Clears queue items for specified connectors.
 *
 * Deletes from request_queue and resets search_registry state to 'pending'.
 *
 * @param connectorIds - Connector IDs to clear (empty array = all connectors)
 * @returns Number of items cleared
 */
export async function clearQueueForConnectors(connectorIds?: number[]): Promise<number> {
	const now = new Date();

	let deletedCount: number;
	let registryIds: number[];

	if (connectorIds && connectorIds.length > 0) {
		// Get registry IDs before deletion
		const toDelete = await db
			.select({ searchRegistryId: requestQueue.searchRegistryId })
			.from(requestQueue)
			.where(inArray(requestQueue.connectorId, connectorIds));

		registryIds = toDelete.map((item) => item.searchRegistryId);

		// Delete from request_queue
		const deleted = await db
			.delete(requestQueue)
			.where(inArray(requestQueue.connectorId, connectorIds))
			.returning({ id: requestQueue.id });

		deletedCount = deleted.length;
	} else {
		// Clear all queues
		const toDelete = await db
			.select({ searchRegistryId: requestQueue.searchRegistryId })
			.from(requestQueue);

		registryIds = toDelete.map((item) => item.searchRegistryId);

		const deleted = await db
			.delete(requestQueue)
			.returning({ id: requestQueue.id });

		deletedCount = deleted.length;
	}

	// Reset search_registry state to 'pending'
	if (registryIds.length > 0) {
		await db
			.update(searchRegistry)
			.set({
				state: 'pending',
				updatedAt: now
			})
			.where(
				and(
					inArray(searchRegistry.id, registryIds),
					eq(searchRegistry.state, 'queued')
				)
			);
	}

	return deletedCount;
}

// =============================================================================
// Recent Completions Query
// =============================================================================

/**
 * Recent completion entry with content and connector info.
 * Requirements: 18.4
 */
export interface RecentCompletion {
	id: number;
	contentType: 'episode' | 'movie';
	contentId: number;
	contentTitle: string | null;
	seriesId: number | null;
	seriesTitle: string | null;
	seasonNumber: number | null;
	episodeNumber: number | null;
	connectorId: number;
	connectorName: string;
	connectorType: string;
	outcome: string;
	createdAt: Date;
}

/**
 * Gets recent completed searches (from search_history) for display.
 *
 * Fetches recent entries from search_history table, joined with content
 * tables to get titles and connector info for display.
 *
 * Requirements: 18.4
 *
 * @param limit - Maximum number of entries to return (default 25)
 * @returns Recent completion entries with content and connector info
 */
export async function getRecentCompletions(limit: number = 25): Promise<RecentCompletion[]> {
	// Episode completions query
	const episodeCompletions = db
		.select({
			id: searchHistory.id,
			contentType: sql<'episode'>`'episode'::text`.as('content_type'),
			contentId: searchHistory.contentId,
			contentTitle: episodes.title,
			seriesId: series.id,
			seriesTitle: series.title,
			seasonNumber: episodes.seasonNumber,
			episodeNumber: episodes.episodeNumber,
			connectorId: searchHistory.connectorId,
			connectorName: connectors.name,
			connectorType: connectors.type,
			outcome: searchHistory.outcome,
			createdAt: searchHistory.createdAt
		})
		.from(searchHistory)
		.innerJoin(connectors, eq(searchHistory.connectorId, connectors.id))
		.innerJoin(episodes, eq(searchHistory.contentId, episodes.id))
		.innerJoin(seasons, eq(episodes.seasonId, seasons.id))
		.innerJoin(series, eq(seasons.seriesId, series.id))
		.where(eq(searchHistory.contentType, 'episode'));

	// Movie completions query
	const movieCompletions = db
		.select({
			id: searchHistory.id,
			contentType: sql<'movie'>`'movie'::text`.as('content_type'),
			contentId: searchHistory.contentId,
			contentTitle: movies.title,
			seriesId: sql<number | null>`NULL::integer`.as('series_id'),
			seriesTitle: sql<string | null>`NULL::text`.as('series_title'),
			seasonNumber: sql<number | null>`NULL::integer`.as('season_number'),
			episodeNumber: sql<number | null>`NULL::integer`.as('episode_number'),
			connectorId: searchHistory.connectorId,
			connectorName: connectors.name,
			connectorType: connectors.type,
			outcome: searchHistory.outcome,
			createdAt: searchHistory.createdAt
		})
		.from(searchHistory)
		.innerJoin(connectors, eq(searchHistory.connectorId, connectors.id))
		.innerJoin(movies, eq(searchHistory.contentId, movies.id))
		.where(eq(searchHistory.contentType, 'movie'));

	// Combine with UNION ALL and sort by created_at DESC
	const unionQuery = sql`
		(${episodeCompletions})
		UNION ALL
		(${movieCompletions})
		ORDER BY created_at DESC
		LIMIT ${limit}
	`;

	const results = await db.execute(unionQuery);

	// Map rows to typed items
	return (results as Record<string, unknown>[]).map((row) => ({
		id: row.id as number,
		contentType: row.content_type as 'episode' | 'movie',
		contentId: row.contentid as number,
		contentTitle: row.contenttitle as string | null,
		seriesId: row.series_id as number | null,
		seriesTitle: row.series_title as string | null,
		seasonNumber: row.seasonnumber as number | null,
		episodeNumber: row.episodenumber as number | null,
		connectorId: row.connectorid as number,
		connectorName: row.connectorname as string,
		connectorType: row.connectortype as string,
		outcome: row.outcome as string,
		createdAt: new Date(row.createdat as string)
	}));
}
