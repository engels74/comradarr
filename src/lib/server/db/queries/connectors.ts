/**
 * Database queries for connector operations.
 *
 * Requirements: 1.1, 36.1
 *
 * API keys are encrypted using AES-256-GCM before storage.
 * Decryption happens lazily, only when the key is needed for API calls.
 */

import { db } from '$lib/server/db';
import {
	connectors,
	episodes,
	movies,
	requestQueue,
	type Connector,
	type NewConnector
} from '$lib/server/db/schema';
import { and, count, eq, sql } from 'drizzle-orm';
import { encrypt, decrypt, DecryptionError, SecretKeyError } from '$lib/server/crypto';

// Re-export crypto errors for consumers
export { DecryptionError, SecretKeyError };

/**
 * Supported connector types.
 */
export type ConnectorType = 'sonarr' | 'radarr' | 'whisparr';

/**
 * Input for creating a new connector.
 */
export interface CreateConnectorInput {
	type: ConnectorType;
	name: string;
	url: string;
	apiKey: string; // Plain text, will be encrypted
	enabled?: boolean;
}

/**
 * Input for updating an existing connector.
 */
export interface UpdateConnectorInput {
	name?: string;
	url?: string;
	apiKey?: string; // Plain text, will be encrypted if provided
	enabled?: boolean;
	healthStatus?: string;
}

/**
 * Creates a new connector with encrypted API key.
 *
 * @param input - Connector data with plain text API key
 * @returns Created connector (API key is encrypted)
 * @throws SecretKeyError if SECRET_KEY is not configured
 */
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

/**
 * Gets a connector by ID.
 * Note: API key remains encrypted. Use getDecryptedApiKey() when needed.
 *
 * @param id - Connector ID
 * @returns Connector if found, null otherwise
 */
export async function getConnector(id: number): Promise<Connector | null> {
	const result = await db.select().from(connectors).where(eq(connectors.id, id)).limit(1);

	return result[0] ?? null;
}

/**
 * Gets all connectors.
 * Note: API keys remain encrypted. Use getDecryptedApiKey() when needed.
 *
 * @returns Array of all connectors
 */
export async function getAllConnectors(): Promise<Connector[]> {
	return db.select().from(connectors).orderBy(connectors.name);
}

/**
 * Gets all enabled connectors.
 * Note: API keys remain encrypted. Use getDecryptedApiKey() when needed.
 *
 * @returns Array of enabled connectors
 */
export async function getEnabledConnectors(): Promise<Connector[]> {
	return db.select().from(connectors).where(eq(connectors.enabled, true)).orderBy(connectors.name);
}

/**
 * Decrypts the API key from a connector.
 * Call this only when making actual API requests to the *arr application.
 *
 * @param connector - Connector with encrypted API key
 * @returns Decrypted plain text API key
 * @throws DecryptionError if decryption fails
 * @throws SecretKeyError if SECRET_KEY is not configured
 */
export async function getDecryptedApiKey(connector: Connector): Promise<string> {
	return decrypt(connector.apiKeyEncrypted);
}

/**
 * Updates a connector.
 * If apiKey is provided, it will be encrypted before storage.
 *
 * @param id - Connector ID to update
 * @param input - Fields to update
 * @returns Updated connector, or null if not found
 * @throws SecretKeyError if SECRET_KEY is not configured (when updating apiKey)
 */
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

	const result = await db.update(connectors).set(updateData).where(eq(connectors.id, id)).returning();

	return result[0] ?? null;
}

/**
 * Updates a connector's health status.
 *
 * @param id - Connector ID
 * @param healthStatus - New health status
 */
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

/**
 * Updates a connector's last sync timestamp.
 *
 * @param id - Connector ID
 */
export async function updateConnectorLastSync(id: number): Promise<void> {
	await db
		.update(connectors)
		.set({
			lastSync: new Date(),
			updatedAt: new Date()
		})
		.where(eq(connectors.id, id));
}

/**
 * Deletes a connector.
 * Cascades to related content and search state.
 *
 * @param id - Connector ID to delete
 * @returns true if deleted, false if not found
 */
export async function deleteConnector(id: number): Promise<boolean> {
	const result = await db.delete(connectors).where(eq(connectors.id, id)).returning({ id: connectors.id });

	return result.length > 0;
}

/**
 * Checks if a connector exists with the given name.
 *
 * @param name - Connector name to check
 * @param excludeId - Optional ID to exclude (for updates)
 * @returns true if a connector with this name exists
 */
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

/**
 * Normalizes a URL for consistent storage.
 * Removes trailing slashes.
 */
function normalizeUrl(url: string): string {
	return url.replace(/\/+$/, '');
}

// =============================================================================
// Connector Statistics (Requirement 16.1)
// =============================================================================

/**
 * Statistics for a single connector.
 */
export interface ConnectorStats {
	connectorId: number;
	gapsCount: number; // Episodes/movies with hasFile=false, monitored=true
	queueDepth: number; // Items in request_queue
}

/**
 * Gets statistics for a single connector.
 *
 * @param connectorId - Connector ID
 * @returns Statistics for the connector
 */
export async function getConnectorStats(connectorId: number): Promise<ConnectorStats> {
	// Count episode gaps (hasFile=false, monitored=true)
	const episodeGapsResult = await db
		.select({ count: count() })
		.from(episodes)
		.where(and(eq(episodes.connectorId, connectorId), eq(episodes.hasFile, false), eq(episodes.monitored, true)));

	// Count movie gaps (hasFile=false, monitored=true)
	const movieGapsResult = await db
		.select({ count: count() })
		.from(movies)
		.where(and(eq(movies.connectorId, connectorId), eq(movies.hasFile, false), eq(movies.monitored, true)));

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

/**
 * Gets statistics for all connectors efficiently.
 *
 * @returns Map of connectorId to ConnectorStats
 */
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
