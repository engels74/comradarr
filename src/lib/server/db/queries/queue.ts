import { and, asc, count, eq, ilike, inArray, or, type SQL, sql } from 'drizzle-orm';
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

export type QueueState = 'all' | 'queued' | 'searching' | 'cooldown' | 'pending' | 'exhausted';
export type QueueContentType = 'all' | 'episode' | 'movie';
export type QueueSearchType = 'all' | 'gap' | 'upgrade';

export interface QueueFilters {
	connectorId?: number | undefined;
	state?: QueueState | undefined;
	contentType?: QueueContentType | undefined;
	searchType?: QueueSearchType | undefined;
	search?: string | undefined;
	limit?: number | undefined;
	offset?: number | undefined;
}

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

export interface QueueListResult {
	items: QueueItemWithContent[];
	total: number;
}

export interface QueueStatusCounts {
	all: number;
	pending: number;
	queued: number;
	searching: number;
	cooldown: number;
	exhausted: number;
}

export interface QueueConnector {
	id: number;
	name: string;
	type: string;
	queueCount: number;
}

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
		offset: pageParam
			? (Math.max(1, Number(pageParam)) - 1) * (limitParam ? Number(limitParam) : 50)
			: 0
	};
}

export async function getQueueList(filters: QueueFilters): Promise<QueueListResult> {
	const buildConditions = (): SQL[] => {
		const conditions: SQL[] = [];

		if (filters.connectorId !== undefined) {
			conditions.push(eq(searchRegistry.connectorId, filters.connectorId));
		}

		if (filters.state && filters.state !== 'all') {
			conditions.push(eq(searchRegistry.state, filters.state));
		}

		if (filters.searchType && filters.searchType !== 'all') {
			conditions.push(eq(searchRegistry.searchType, filters.searchType));
		}

		return conditions;
	};

	const episodeConditions = buildConditions();
	episodeConditions.push(eq(searchRegistry.contentType, 'episode'));

	if (filters.contentType && filters.contentType !== 'all' && filters.contentType !== 'episode') {
		episodeConditions.push(sql`false`);
	}

	if (filters.search) {
		episodeConditions.push(
			or(ilike(episodes.title, `%${filters.search}%`), ilike(series.title, `%${filters.search}%`))!
		);
	}

	const episodeQuery = db
		.select({
			id: searchRegistry.id,
			search_registry_id: searchRegistry.id,
			connector_id: searchRegistry.connectorId,
			connector_name: connectors.name,
			connector_type: connectors.type,
			content_type: sql<'episode'>`'episode'::text`.as('content_type'),
			content_id: searchRegistry.contentId,
			title:
				sql<string>`COALESCE(${episodes.title}, 'Episode ' || ${episodes.seasonNumber} || 'x' || LPAD(${episodes.episodeNumber}::text, 2, '0'))`.as(
					'title'
				),
			series_title: series.title,
			season_number: episodes.seasonNumber,
			episode_number: episodes.episodeNumber,
			year: sql<number | null>`NULL::integer`.as('year'),
			search_type: sql<'gap' | 'upgrade'>`${searchRegistry.searchType}`.as('search_type'),
			state: sql<
				'pending' | 'queued' | 'searching' | 'cooldown' | 'exhausted'
			>`${searchRegistry.state}`.as('state'),
			priority: searchRegistry.priority,
			attempt_count: searchRegistry.attemptCount,
			scheduled_at: requestQueue.scheduledAt,
			created_at: searchRegistry.createdAt
		})
		.from(searchRegistry)
		.innerJoin(connectors, eq(searchRegistry.connectorId, connectors.id))
		.innerJoin(episodes, eq(searchRegistry.contentId, episodes.id))
		.innerJoin(seasons, eq(episodes.seasonId, seasons.id))
		.innerJoin(series, eq(seasons.seriesId, series.id))
		.leftJoin(requestQueue, eq(searchRegistry.id, requestQueue.searchRegistryId))
		.where(episodeConditions.length > 0 ? and(...episodeConditions) : undefined);

	const movieConditions = buildConditions();
	movieConditions.push(eq(searchRegistry.contentType, 'movie'));

	if (filters.contentType && filters.contentType !== 'all' && filters.contentType !== 'movie') {
		movieConditions.push(sql`false`);
	}

	if (filters.search) {
		movieConditions.push(ilike(movies.title, `%${filters.search}%`));
	}

	const movieQuery = db
		.select({
			id: searchRegistry.id,
			search_registry_id: searchRegistry.id,
			connector_id: searchRegistry.connectorId,
			connector_name: connectors.name,
			connector_type: connectors.type,
			content_type: sql<'movie'>`'movie'::text`.as('content_type'),
			content_id: searchRegistry.contentId,
			title: sql<string>`COALESCE(${movies.title}, 'Unknown Movie')`.as('title'),
			series_title: sql<string | null>`NULL::text`.as('series_title'),
			season_number: sql<number | null>`NULL::integer`.as('season_number'),
			episode_number: sql<number | null>`NULL::integer`.as('episode_number'),
			year: movies.year,
			search_type: sql<'gap' | 'upgrade'>`${searchRegistry.searchType}`.as('search_type'),
			state: sql<
				'pending' | 'queued' | 'searching' | 'cooldown' | 'exhausted'
			>`${searchRegistry.state}`.as('state'),
			priority: searchRegistry.priority,
			attempt_count: searchRegistry.attemptCount,
			scheduled_at: requestQueue.scheduledAt,
			created_at: searchRegistry.createdAt
		})
		.from(searchRegistry)
		.innerJoin(connectors, eq(searchRegistry.connectorId, connectors.id))
		.innerJoin(movies, eq(searchRegistry.contentId, movies.id))
		.leftJoin(requestQueue, eq(searchRegistry.id, requestQueue.searchRegistryId))
		.where(movieConditions.length > 0 ? and(...movieConditions) : undefined);

	const unionQuery = sql`
		(${episodeQuery})
		UNION ALL
		(${movieQuery})
		ORDER BY priority DESC, scheduled_at ASC NULLS LAST, created_at ASC
		LIMIT ${filters.limit ?? 50}
		OFFSET ${filters.offset ?? 0}
	`;

	const items = await db.execute(unionQuery);

	const countConditions = buildConditions();

	if (filters.contentType && filters.contentType !== 'all') {
		countConditions.push(eq(searchRegistry.contentType, filters.contentType));
	}

	const totalResult = await db
		.select({ count: count() })
		.from(searchRegistry)
		.where(countConditions.length > 0 ? and(...countConditions) : undefined);

	const mappedItems: QueueItemWithContent[] = (items as Record<string, unknown>[]).map((row) => ({
		id: row.id as number,
		searchRegistryId: row.search_registry_id as number,
		connectorId: row.connector_id as number,
		connectorName: row.connector_name as string,
		connectorType: row.connector_type as string,
		contentType: row.content_type as 'episode' | 'movie',
		contentId: row.content_id as number,
		title: row.title as string,
		seriesTitle: row.series_title as string | null,
		seasonNumber: row.season_number as number | null,
		episodeNumber: row.episode_number as number | null,
		year: row.year as number | null,
		searchType: row.search_type as 'gap' | 'upgrade',
		state: row.state as 'pending' | 'queued' | 'searching' | 'cooldown' | 'exhausted',
		priority: row.priority as number,
		attemptCount: row.attempt_count as number,
		scheduledAt: row.scheduled_at ? new Date(row.scheduled_at as string) : null,
		createdAt: new Date(row.created_at as string)
	}));

	return {
		items: mappedItems,
		total: totalResult[0]?.count ?? 0
	};
}

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

export async function getThrottleInfo(connectorId: number): Promise<QueueThrottleInfo | null> {
	const result = await db
		.select({
			connectorId: connectors.id,
			queuePaused: connectors.queuePaused,
			pausedUntil: throttleState.pausedUntil,
			pauseReason: throttleState.pauseReason,
			requestsThisMinute: throttleState.requestsThisMinute,
			requestsToday: throttleState.requestsToday,
			requestsPerMinute: sql<number>`COALESCE(${throttleProfiles.requestsPerMinute}, 5)`.as(
				'requests_per_minute'
			),
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

export async function getAllThrottleInfo(): Promise<Map<number, QueueThrottleInfo>> {
	const result = await db
		.select({
			connectorId: connectors.id,
			queuePaused: connectors.queuePaused,
			pausedUntil: throttleState.pausedUntil,
			pauseReason: throttleState.pauseReason,
			requestsThisMinute: throttleState.requestsThisMinute,
			requestsToday: throttleState.requestsToday,
			requestsPerMinute: sql<number>`COALESCE(${throttleProfiles.requestsPerMinute}, 5)`.as(
				'requests_per_minute'
			),
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

export interface ConnectorPauseStatus {
	id: number;
	name: string;
	type: string;
	queuePaused: boolean;
	queueCount: number;
}

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

export async function updateQueueItemPriority(
	registryIds: number[],
	priority: number
): Promise<number> {
	if (registryIds.length === 0) return 0;

	const now = new Date();

	const updated = await db
		.update(searchRegistry)
		.set({
			priority,
			updatedAt: now
		})
		.where(inArray(searchRegistry.id, registryIds))
		.returning({ id: searchRegistry.id });

	await db
		.update(requestQueue)
		.set({ priority })
		.where(inArray(requestQueue.searchRegistryId, registryIds));

	return updated.length;
}

export async function removeFromQueueByIds(registryIds: number[]): Promise<number> {
	if (registryIds.length === 0) return 0;

	const now = new Date();

	const deleted = await db
		.delete(requestQueue)
		.where(inArray(requestQueue.searchRegistryId, registryIds))
		.returning({ id: requestQueue.id });

	await db
		.update(searchRegistry)
		.set({
			state: 'pending',
			updatedAt: now
		})
		.where(and(inArray(searchRegistry.id, registryIds), eq(searchRegistry.state, 'queued')));

	return deleted.length;
}

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

export async function clearQueueForConnectors(connectorIds?: number[]): Promise<number> {
	const now = new Date();

	let deletedCount: number;
	let registryIds: number[];

	if (connectorIds && connectorIds.length > 0) {
		const toDelete = await db
			.select({ searchRegistryId: requestQueue.searchRegistryId })
			.from(requestQueue)
			.where(inArray(requestQueue.connectorId, connectorIds));

		registryIds = toDelete.map((item) => item.searchRegistryId);

		const deleted = await db
			.delete(requestQueue)
			.where(inArray(requestQueue.connectorId, connectorIds))
			.returning({ id: requestQueue.id });

		deletedCount = deleted.length;
	} else {
		const toDelete = await db
			.select({ searchRegistryId: requestQueue.searchRegistryId })
			.from(requestQueue);

		registryIds = toDelete.map((item) => item.searchRegistryId);

		const deleted = await db.delete(requestQueue).returning({ id: requestQueue.id });

		deletedCount = deleted.length;
	}

	if (registryIds.length > 0) {
		await db
			.update(searchRegistry)
			.set({
				state: 'pending',
				updatedAt: now
			})
			.where(and(inArray(searchRegistry.id, registryIds), eq(searchRegistry.state, 'queued')));
	}

	return deletedCount;
}

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

export async function getRecentCompletions(limit: number = 25): Promise<RecentCompletion[]> {
	const episodeCompletions = db
		.select({
			id: searchHistory.id,
			content_type: sql<'episode'>`'episode'::text`.as('content_type'),
			content_id: searchHistory.contentId,
			content_title: episodes.title,
			series_id: series.id,
			series_title: series.title,
			season_number: episodes.seasonNumber,
			episode_number: episodes.episodeNumber,
			connector_id: searchHistory.connectorId,
			connector_name: connectors.name,
			connector_type: connectors.type,
			outcome: searchHistory.outcome,
			created_at: searchHistory.createdAt
		})
		.from(searchHistory)
		.innerJoin(connectors, eq(searchHistory.connectorId, connectors.id))
		.innerJoin(episodes, eq(searchHistory.contentId, episodes.id))
		.innerJoin(seasons, eq(episodes.seasonId, seasons.id))
		.innerJoin(series, eq(seasons.seriesId, series.id))
		.where(eq(searchHistory.contentType, 'episode'));

	const movieCompletions = db
		.select({
			id: searchHistory.id,
			content_type: sql<'movie'>`'movie'::text`.as('content_type'),
			content_id: searchHistory.contentId,
			content_title: movies.title,
			series_id: sql<number | null>`NULL::integer`.as('series_id'),
			series_title: sql<string | null>`NULL::text`.as('series_title'),
			season_number: sql<number | null>`NULL::integer`.as('season_number'),
			episode_number: sql<number | null>`NULL::integer`.as('episode_number'),
			connector_id: searchHistory.connectorId,
			connector_name: connectors.name,
			connector_type: connectors.type,
			outcome: searchHistory.outcome,
			created_at: searchHistory.createdAt
		})
		.from(searchHistory)
		.innerJoin(connectors, eq(searchHistory.connectorId, connectors.id))
		.innerJoin(movies, eq(searchHistory.contentId, movies.id))
		.where(eq(searchHistory.contentType, 'movie'));

	const unionQuery = sql`
		(${episodeCompletions})
		UNION ALL
		(${movieCompletions})
		ORDER BY created_at DESC
		LIMIT ${limit}
	`;

	const results = await db.execute(unionQuery);

	return (results as Record<string, unknown>[]).map((row) => ({
		id: row.id as number,
		contentType: row.content_type as 'episode' | 'movie',
		contentId: row.content_id as number,
		contentTitle: row.content_title as string | null,
		seriesId: row.series_id as number | null,
		seriesTitle: row.series_title as string | null,
		seasonNumber: row.season_number as number | null,
		episodeNumber: row.episode_number as number | null,
		connectorId: row.connector_id as number,
		connectorName: row.connector_name as string,
		connectorType: row.connector_type as string,
		outcome: row.outcome as string,
		createdAt: new Date(row.created_at as string)
	}));
}

export interface TodaySearchStats {
	completedToday: number;
	successfulToday: number;
	successRate: number;
}

export async function getTodaySearchStats(): Promise<TodaySearchStats> {
	const todayStart = new Date();
	todayStart.setUTCHours(0, 0, 0, 0);

	const result = await db
		.select({
			total: count(),
			successful: sql<number>`COUNT(*) FILTER (WHERE ${searchHistory.outcome} = 'success')::int`
		})
		.from(searchHistory)
		.where(sql`${searchHistory.createdAt} >= ${todayStart.toISOString()}`);

	const completedToday = result[0]?.total ?? 0;
	const successfulToday = result[0]?.successful ?? 0;
	const successRate = completedToday > 0 ? Math.round((successfulToday / completedToday) * 100) : 0;

	return {
		completedToday,
		successfulToday,
		successRate
	};
}
