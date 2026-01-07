import { and, count, desc, eq, inArray, or } from 'drizzle-orm';
import { DecryptionError, decrypt, encrypt, SecretKeyError } from '$lib/server/crypto';
import { db } from '$lib/server/db';
import {
	type Connector,
	connectors,
	episodes,
	movies,
	type NewConnector,
	requestQueue,
	type SyncState,
	searchHistory,
	searchRegistry,
	syncState
} from '$lib/server/db/schema';

export { DecryptionError, SecretKeyError };

export type ConnectorType = 'sonarr' | 'radarr' | 'whisparr';

export interface CreateConnectorInput {
	type: ConnectorType;
	name: string;
	url: string;
	apiKey: string; // Plain text, will be encrypted
	enabled?: boolean;
}

export interface UpdateConnectorInput {
	name?: string;
	url?: string;
	apiKey?: string; // Plain text, will be encrypted if provided
	enabled?: boolean;
	healthStatus?: string;
}

export async function createConnector(input: CreateConnectorInput): Promise<Connector> {
	// Encrypt API key before storage (Req 1.1)
	const apiKeyEncrypted = await encrypt(input.apiKey);

	const result = await db
		.insert(connectors)
		.values({
			type: input.type,
			name: input.name,
			url: normalizeUrl(input.url),
			apiKeyEncrypted,
			enabled: input.enabled ?? true
		})
		.returning();

	return result[0]!;
}

export async function getConnector(id: number): Promise<Connector | null> {
	const result = await db.select().from(connectors).where(eq(connectors.id, id)).limit(1);

	return result[0] ?? null;
}

export async function getAllConnectors(): Promise<Connector[]> {
	return db.select().from(connectors).orderBy(connectors.name);
}

export async function getEnabledConnectors(): Promise<Connector[]> {
	return db.select().from(connectors).where(eq(connectors.enabled, true)).orderBy(connectors.name);
}

export async function getHealthyConnectors(): Promise<Connector[]> {
	return db
		.select()
		.from(connectors)
		.where(
			and(eq(connectors.enabled, true), inArray(connectors.healthStatus, ['healthy', 'degraded']))
		)
		.orderBy(connectors.name);
}

export async function getDecryptedApiKey(connector: Connector): Promise<string> {
	return decrypt(connector.apiKeyEncrypted);
}

export async function updateConnector(
	id: number,
	input: UpdateConnectorInput
): Promise<Connector | null> {
	const updateData: Partial<NewConnector> & { updatedAt: Date } = {
		updatedAt: new Date()
	};

	if (input.name !== undefined) {
		updateData.name = input.name;
	}

	if (input.url !== undefined) {
		updateData.url = normalizeUrl(input.url);
	}

	if (input.apiKey !== undefined) {
		// Re-encrypt new API key (Req 36.1)
		updateData.apiKeyEncrypted = await encrypt(input.apiKey);
	}

	if (input.enabled !== undefined) {
		updateData.enabled = input.enabled;
	}

	if (input.healthStatus !== undefined) {
		updateData.healthStatus = input.healthStatus;
	}

	const result = await db
		.update(connectors)
		.set(updateData)
		.where(eq(connectors.id, id))
		.returning();

	return result[0] ?? null;
}

export async function updateConnectorHealth(
	id: number,
	healthStatus: 'healthy' | 'degraded' | 'unhealthy' | 'offline' | 'unknown'
): Promise<void> {
	await db
		.update(connectors)
		.set({
			healthStatus,
			updatedAt: new Date()
		})
		.where(eq(connectors.id, id));
}

export async function updateConnectorLastSync(id: number): Promise<void> {
	await db
		.update(connectors)
		.set({
			lastSync: new Date(),
			updatedAt: new Date()
		})
		.where(eq(connectors.id, id));
}

export async function deleteConnector(id: number): Promise<boolean> {
	const result = await db
		.delete(connectors)
		.where(eq(connectors.id, id))
		.returning({ id: connectors.id });

	return result.length > 0;
}

export async function connectorNameExists(name: string, excludeId?: number): Promise<boolean> {
	const result = await db
		.select({ id: connectors.id })
		.from(connectors)
		.where(eq(connectors.name, name))
		.limit(1);

	if (result.length === 0) return false;
	if (excludeId !== undefined && result[0]?.id === excludeId) return false;

	return true;
}

function normalizeUrl(url: string): string {
	return url.replace(/\/+$/, '');
}

export interface ConnectorStats {
	connectorId: number;
	gapsCount: number; // Episodes/movies with hasFile=false, monitored=true
	queueDepth: number;
}

export async function getConnectorStats(connectorId: number): Promise<ConnectorStats> {
	// Count episode gaps (hasFile=false, monitored=true)
	const episodeGapsResult = await db
		.select({ count: count() })
		.from(episodes)
		.where(
			and(
				eq(episodes.connectorId, connectorId),
				eq(episodes.hasFile, false),
				eq(episodes.monitored, true)
			)
		);

	// Count movie gaps (hasFile=false, monitored=true)
	const movieGapsResult = await db
		.select({ count: count() })
		.from(movies)
		.where(
			and(
				eq(movies.connectorId, connectorId),
				eq(movies.hasFile, false),
				eq(movies.monitored, true)
			)
		);

	// Count queue depth
	const queueResult = await db
		.select({ count: count() })
		.from(requestQueue)
		.where(eq(requestQueue.connectorId, connectorId));

	const episodeGaps = episodeGapsResult[0]?.count ?? 0;
	const movieGaps = movieGapsResult[0]?.count ?? 0;
	const queueDepth = queueResult[0]?.count ?? 0;

	return {
		connectorId,
		gapsCount: episodeGaps + movieGaps,
		queueDepth
	};
}

export async function getAllConnectorStats(): Promise<Map<number, ConnectorStats>> {
	// Get all connector IDs first
	const allConnectors = await db.select({ id: connectors.id }).from(connectors);
	const connectorIds = allConnectors.map((c) => c.id);

	// Initialize stats map with zeros
	const statsMap = new Map<number, ConnectorStats>();
	for (const id of connectorIds) {
		statsMap.set(id, { connectorId: id, gapsCount: 0, queueDepth: 0 });
	}

	// Count episode gaps grouped by connector
	const episodeGaps = await db
		.select({
			connectorId: episodes.connectorId,
			count: count()
		})
		.from(episodes)
		.where(and(eq(episodes.hasFile, false), eq(episodes.monitored, true)))
		.groupBy(episodes.connectorId);

	for (const row of episodeGaps) {
		const stats = statsMap.get(row.connectorId);
		if (stats) {
			stats.gapsCount += row.count;
		}
	}

	// Count movie gaps grouped by connector
	const movieGaps = await db
		.select({
			connectorId: movies.connectorId,
			count: count()
		})
		.from(movies)
		.where(and(eq(movies.hasFile, false), eq(movies.monitored, true)))
		.groupBy(movies.connectorId);

	for (const row of movieGaps) {
		const stats = statsMap.get(row.connectorId);
		if (stats) {
			stats.gapsCount += row.count;
		}
	}

	// Count queue depth grouped by connector
	const queueCounts = await db
		.select({
			connectorId: requestQueue.connectorId,
			count: count()
		})
		.from(requestQueue)
		.groupBy(requestQueue.connectorId);

	for (const row of queueCounts) {
		const stats = statsMap.get(row.connectorId);
		if (stats) {
			stats.queueDepth = row.count;
		}
	}

	return statsMap;
}

export async function getSyncState(connectorId: number): Promise<SyncState | null> {
	const result = await db
		.select()
		.from(syncState)
		.where(eq(syncState.connectorId, connectorId))
		.limit(1);

	return result[0] ?? null;
}

export interface ConnectorDetailedStats {
	connectorId: number;
	episodeGapsCount: number; // Episodes with hasFile=false, monitored=true
	episodeUpgradesCount: number; // Episodes with qualityCutoffNotMet=true, monitored=true, hasFile=true
	movieGapsCount: number; // Movies with hasFile=false, monitored=true
	movieUpgradesCount: number; // Movies with qualityCutoffNotMet=true, monitored=true, hasFile=true
	totalEpisodes: number;
	totalMovies: number;
	queueDepth: number;
}

export async function getConnectorDetailedStats(
	connectorId: number
): Promise<ConnectorDetailedStats> {
	// Run all queries in parallel for efficiency
	const [
		episodeGapsResult,
		episodeUpgradesResult,
		movieGapsResult,
		movieUpgradesResult,
		totalEpisodesResult,
		totalMoviesResult,
		queueResult
	] = await Promise.all([
		// Episode gaps (hasFile=false, monitored=true)
		db
			.select({ count: count() })
			.from(episodes)
			.where(
				and(
					eq(episodes.connectorId, connectorId),
					eq(episodes.hasFile, false),
					eq(episodes.monitored, true)
				)
			),
		// Episode upgrades (qualityCutoffNotMet=true, monitored=true, hasFile=true)
		db
			.select({ count: count() })
			.from(episodes)
			.where(
				and(
					eq(episodes.connectorId, connectorId),
					eq(episodes.qualityCutoffNotMet, true),
					eq(episodes.monitored, true),
					eq(episodes.hasFile, true)
				)
			),
		// Movie gaps (hasFile=false, monitored=true)
		db
			.select({ count: count() })
			.from(movies)
			.where(
				and(
					eq(movies.connectorId, connectorId),
					eq(movies.hasFile, false),
					eq(movies.monitored, true)
				)
			),
		// Movie upgrades (qualityCutoffNotMet=true, monitored=true, hasFile=true)
		db
			.select({ count: count() })
			.from(movies)
			.where(
				and(
					eq(movies.connectorId, connectorId),
					eq(movies.qualityCutoffNotMet, true),
					eq(movies.monitored, true),
					eq(movies.hasFile, true)
				)
			),
		// Total episodes for connector
		db
			.select({ count: count() })
			.from(episodes)
			.where(eq(episodes.connectorId, connectorId)),
		// Total movies for connector
		db
			.select({ count: count() })
			.from(movies)
			.where(eq(movies.connectorId, connectorId)),
		// Queue depth
		db
			.select({ count: count() })
			.from(requestQueue)
			.where(eq(requestQueue.connectorId, connectorId))
	]);

	return {
		connectorId,
		episodeGapsCount: episodeGapsResult[0]?.count ?? 0,
		episodeUpgradesCount: episodeUpgradesResult[0]?.count ?? 0,
		movieGapsCount: movieGapsResult[0]?.count ?? 0,
		movieUpgradesCount: movieUpgradesResult[0]?.count ?? 0,
		totalEpisodes: totalEpisodesResult[0]?.count ?? 0,
		totalMovies: totalMoviesResult[0]?.count ?? 0,
		queueDepth: queueResult[0]?.count ?? 0
	};
}

export interface SearchStateDistribution {
	pending: number;
	queued: number;
	searching: number;
	cooldown: number;
	exhausted: number;
}

export async function getSearchStateDistribution(
	connectorId: number
): Promise<SearchStateDistribution> {
	const result = await db
		.select({
			state: searchRegistry.state,
			count: count()
		})
		.from(searchRegistry)
		.where(eq(searchRegistry.connectorId, connectorId))
		.groupBy(searchRegistry.state);

	// Initialize all states to 0
	const distribution: SearchStateDistribution = {
		pending: 0,
		queued: 0,
		searching: 0,
		cooldown: 0,
		exhausted: 0
	};

	// Fill in counts from query results
	for (const row of result) {
		const state = row.state as keyof SearchStateDistribution;
		if (state in distribution) {
			distribution[state] = row.count;
		}
	}

	return distribution;
}

export interface SearchHistoryEntry {
	id: number;
	contentType: string;
	contentId: number;
	outcome: string;
	createdAt: Date;
	contentTitle: string | null;
}

export async function getRecentSearchHistory(
	connectorId: number,
	limit: number = 15
): Promise<SearchHistoryEntry[]> {
	// Get recent search history entries
	const historyEntries = await db
		.select({
			id: searchHistory.id,
			contentType: searchHistory.contentType,
			contentId: searchHistory.contentId,
			outcome: searchHistory.outcome,
			createdAt: searchHistory.createdAt
		})
		.from(searchHistory)
		.where(eq(searchHistory.connectorId, connectorId))
		.orderBy(desc(searchHistory.createdAt))
		.limit(limit);

	if (historyEntries.length === 0) {
		return [];
	}

	// Collect content IDs by type for batch lookups
	const episodeIds: number[] = [];
	const movieIds: number[] = [];
	for (const entry of historyEntries) {
		if (entry.contentType === 'episode') {
			episodeIds.push(entry.contentId);
		} else if (entry.contentType === 'movie') {
			movieIds.push(entry.contentId);
		}
	}

	// Batch lookup titles
	const titleMap = new Map<string, string>();

	if (episodeIds.length > 0) {
		const episodeTitles = await db
			.select({ id: episodes.id, title: episodes.title })
			.from(episodes)
			.where(inArray(episodes.id, episodeIds));
		for (const ep of episodeTitles) {
			titleMap.set(`episode-${ep.id}`, ep.title ?? 'Unknown Episode');
		}
	}

	if (movieIds.length > 0) {
		const movieTitles = await db
			.select({ id: movies.id, title: movies.title })
			.from(movies)
			.where(inArray(movies.id, movieIds));
		for (const movie of movieTitles) {
			titleMap.set(`movie-${movie.id}`, movie.title);
		}
	}

	// Map entries with titles
	return historyEntries.map((entry) => ({
		id: entry.id,
		contentType: entry.contentType,
		contentId: entry.contentId,
		outcome: entry.outcome,
		createdAt: entry.createdAt,
		contentTitle: titleMap.get(`${entry.contentType}-${entry.contentId}`) ?? null
	}));
}

export async function clearFailedSearches(connectorId: number): Promise<number> {
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
				eq(searchRegistry.connectorId, connectorId),
				or(eq(searchRegistry.state, 'exhausted'), eq(searchRegistry.state, 'cooldown'))
			)
		)
		.returning({ id: searchRegistry.id });

	return result.length;
}
