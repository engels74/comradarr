/**
 * Database queries for connector operations.
 *
 * Requirements: 1.1, 36.1
 *
 * API keys are encrypted using AES-256-GCM before storage.
 * Decryption happens lazily, only when the key is needed for API calls.
 */

import { db } from '$lib/server/db';
import { connectors, type Connector, type NewConnector } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
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
