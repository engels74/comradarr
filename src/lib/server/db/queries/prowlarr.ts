/**
 * Database queries for Prowlarr instance and indexer health operations.
 *

 *
 * API keys are encrypted using AES-256-GCM before storage.
 * Decryption happens lazily, only when the key is needed for API calls.
 *
 * Indexer health is cached in the database for quick access and to survive
 * restarts. Cache is updated periodically by ProwlarrHealthMonitor.
 */

import { db } from '$lib/server/db';
import {
	prowlarrInstances,
	prowlarrIndexerHealth,
	type ProwlarrInstance,
	type NewProwlarrInstance,
	type ProwlarrIndexerHealth
} from '$lib/server/db/schema';
import { eq, and, notInArray, sql } from 'drizzle-orm';
import { encrypt, decrypt, DecryptionError, SecretKeyError } from '$lib/server/crypto';
import type { ProwlarrHealthStatus, IndexerHealth } from '$lib/server/services/prowlarr/types';

// Re-export crypto errors for consumers
export { DecryptionError, SecretKeyError };

/**
 * Input for creating a new Prowlarr instance.
 */
export interface CreateProwlarrInstanceInput {
	name: string;
	url: string;
	apiKey: string; // Plain text, will be encrypted
	enabled?: boolean;
}

/**
 * Input for updating an existing Prowlarr instance.
 */
export interface UpdateProwlarrInstanceInput {
	name?: string;
	url?: string;
	apiKey?: string; // Plain text, will be encrypted if provided
	enabled?: boolean;
	healthStatus?: ProwlarrHealthStatus;
}

/**
 * Creates a new Prowlarr instance with encrypted API key.
 *
 * @param input - Instance data with plain text API key
 * @returns Created instance (API key is encrypted)
 * @throws SecretKeyError if SECRET_KEY is not configured
 *

 */
export async function createProwlarrInstance(
	input: CreateProwlarrInstanceInput
): Promise<ProwlarrInstance> {
	// Encrypt API key before storage (Req 38.1)
	const apiKeyEncrypted = await encrypt(input.apiKey);

	const result = await db
		.insert(prowlarrInstances)
		.values({
			name: input.name,
			url: normalizeUrl(input.url),
			apiKeyEncrypted,
			enabled: input.enabled ?? true
		})
		.returning();

	return result[0]!;
}

/**
 * Gets a Prowlarr instance by ID.
 * Note: API key remains encrypted. Use getDecryptedApiKey() when needed.
 *
 * @param id - Instance ID
 * @returns Instance if found, null otherwise
 */
export async function getProwlarrInstance(id: number): Promise<ProwlarrInstance | null> {
	const result = await db
		.select()
		.from(prowlarrInstances)
		.where(eq(prowlarrInstances.id, id))
		.limit(1);

	return result[0] ?? null;
}

/**
 * Gets all Prowlarr instances.
 * Note: API keys remain encrypted. Use getDecryptedApiKey() when needed.
 *
 * @returns Array of all instances
 */
export async function getAllProwlarrInstances(): Promise<ProwlarrInstance[]> {
	return db.select().from(prowlarrInstances).orderBy(prowlarrInstances.name);
}

/**
 * Gets all enabled Prowlarr instances.
 * Note: API keys remain encrypted. Use getDecryptedApiKey() when needed.
 *
 * @returns Array of enabled instances
 */
export async function getEnabledProwlarrInstances(): Promise<ProwlarrInstance[]> {
	return db
		.select()
		.from(prowlarrInstances)
		.where(eq(prowlarrInstances.enabled, true))
		.orderBy(prowlarrInstances.name);
}

/**
 * Decrypts the API key from a Prowlarr instance.
 * Call this only when making actual API requests to Prowlarr.
 *
 * @param instance - Instance with encrypted API key
 * @returns Decrypted plain text API key
 * @throws DecryptionError if decryption fails
 * @throws SecretKeyError if SECRET_KEY is not configured
 */
export async function getDecryptedApiKey(instance: ProwlarrInstance): Promise<string> {
	return decrypt(instance.apiKeyEncrypted);
}

/**
 * Updates a Prowlarr instance.
 * If apiKey is provided, it will be encrypted before storage.
 *
 * @param id - Instance ID to update
 * @param input - Fields to update
 * @returns Updated instance, or null if not found
 * @throws SecretKeyError if SECRET_KEY is not configured (when updating apiKey)
 */
export async function updateProwlarrInstance(
	id: number,
	input: UpdateProwlarrInstanceInput
): Promise<ProwlarrInstance | null> {
	const updateData: Partial<NewProwlarrInstance> & { updatedAt: Date } = {
		updatedAt: new Date()
	};

	if (input.name !== undefined) {
		updateData.name = input.name;
	}

	if (input.url !== undefined) {
		updateData.url = normalizeUrl(input.url);
	}

	if (input.apiKey !== undefined) {
		// Re-encrypt new API key
		updateData.apiKeyEncrypted = await encrypt(input.apiKey);
	}

	if (input.enabled !== undefined) {
		updateData.enabled = input.enabled;
	}

	if (input.healthStatus !== undefined) {
		updateData.healthStatus = input.healthStatus;
	}

	const result = await db
		.update(prowlarrInstances)
		.set(updateData)
		.where(eq(prowlarrInstances.id, id))
		.returning();

	return result[0] ?? null;
}

/**
 * Updates a Prowlarr instance's health status and last check timestamp.
 *
 * @param id - Instance ID
 * @param healthStatus - New health status
 */
export async function updateProwlarrHealth(
	id: number,
	healthStatus: ProwlarrHealthStatus
): Promise<void> {
	await db
		.update(prowlarrInstances)
		.set({
			healthStatus,
			lastHealthCheck: new Date(),
			updatedAt: new Date()
		})
		.where(eq(prowlarrInstances.id, id));
}

/**
 * Deletes a Prowlarr instance.
 *
 * @param id - Instance ID to delete
 * @returns true if deleted, false if not found
 */
export async function deleteProwlarrInstance(id: number): Promise<boolean> {
	const result = await db
		.delete(prowlarrInstances)
		.where(eq(prowlarrInstances.id, id))
		.returning({ id: prowlarrInstances.id });

	return result.length > 0;
}

/**
 * Checks if a Prowlarr instance exists with the given name.
 *
 * @param name - Instance name to check
 * @param excludeId - Optional ID to exclude (for updates)
 * @returns true if an instance with this name exists
 */
export async function prowlarrInstanceNameExists(
	name: string,
	excludeId?: number
): Promise<boolean> {
	const result = await db
		.select({ id: prowlarrInstances.id })
		.from(prowlarrInstances)
		.where(eq(prowlarrInstances.name, name))
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
// Indexer Health Cache Operations
// =============================================================================

/**
 * Upserts indexer health data for a Prowlarr instance.
 * Inserts new indexers and updates existing ones.
 *
 * Uses ON CONFLICT DO UPDATE for atomic upsert.
 *
 * @param instanceId - Prowlarr instance ID
 * @param healthData - Array of indexer health from Prowlarr API
 * @returns Number of rows affected
 *

 */
export async function upsertIndexerHealth(
	instanceId: number,
	healthData: IndexerHealth[]
): Promise<number> {
	if (healthData.length === 0) {
		return 0;
	}

	const now = new Date();

	// Use raw SQL for ON CONFLICT DO UPDATE since Drizzle's onConflictDoUpdate
	// requires specific handling for composite unique constraints
	const values = healthData.map((h) => ({
		prowlarrInstanceId: instanceId,
		indexerId: h.indexerId,
		name: h.name,
		enabled: h.enabled,
		isRateLimited: h.isRateLimited,
		rateLimitExpiresAt: h.rateLimitExpiresAt,
		mostRecentFailure: h.mostRecentFailure,
		lastUpdated: now
	}));

	// Drizzle upsert with onConflictDoUpdate
	const result = await db
		.insert(prowlarrIndexerHealth)
		.values(values)
		.onConflictDoUpdate({
			target: [prowlarrIndexerHealth.prowlarrInstanceId, prowlarrIndexerHealth.indexerId],
			set: {
				name: sql`excluded.name`,
				enabled: sql`excluded.enabled`,
				isRateLimited: sql`excluded.is_rate_limited`,
				rateLimitExpiresAt: sql`excluded.rate_limit_expires_at`,
				mostRecentFailure: sql`excluded.most_recent_failure`,
				lastUpdated: sql`excluded.last_updated`
			}
		});

	return healthData.length;
}

/**
 * Gets cached indexer health for a specific Prowlarr instance.
 *
 * @param instanceId - Prowlarr instance ID
 * @returns Array of cached indexer health records
 *

 */
export async function getIndexerHealthByInstance(
	instanceId: number
): Promise<ProwlarrIndexerHealth[]> {
	return db
		.select()
		.from(prowlarrIndexerHealth)
		.where(eq(prowlarrIndexerHealth.prowlarrInstanceId, instanceId))
		.orderBy(prowlarrIndexerHealth.name);
}

/**
 * Gets all cached indexer health across all instances.
 *
 * @returns Array of all cached indexer health records
 *

 */
export async function getAllCachedIndexerHealth(): Promise<ProwlarrIndexerHealth[]> {
	return db.select().from(prowlarrIndexerHealth).orderBy(prowlarrIndexerHealth.name);
}

/**
 * Gets rate-limited indexers for a specific instance.
 *
 * @param instanceId - Prowlarr instance ID
 * @returns Array of rate-limited indexer records
 */
export async function getRateLimitedIndexers(
	instanceId: number
): Promise<ProwlarrIndexerHealth[]> {
	return db
		.select()
		.from(prowlarrIndexerHealth)
		.where(
			and(
				eq(prowlarrIndexerHealth.prowlarrInstanceId, instanceId),
				eq(prowlarrIndexerHealth.isRateLimited, true)
			)
		)
		.orderBy(prowlarrIndexerHealth.name);
}

/**
 * Deletes indexer health records for indexers that no longer exist in Prowlarr.
 * Called after a successful health check to remove stale data.
 *
 * @param instanceId - Prowlarr instance ID
 * @param activeIndexerIds - Array of indexer IDs that still exist in Prowlarr
 * @returns Number of deleted records
 */
export async function deleteStaleIndexerHealth(
	instanceId: number,
	activeIndexerIds: number[]
): Promise<number> {
	if (activeIndexerIds.length === 0) {
		// Delete all indexer health for this instance if no active indexers
		const result = await db
			.delete(prowlarrIndexerHealth)
			.where(eq(prowlarrIndexerHealth.prowlarrInstanceId, instanceId))
			.returning({ id: prowlarrIndexerHealth.id });
		return result.length;
	}

	const result = await db
		.delete(prowlarrIndexerHealth)
		.where(
			and(
				eq(prowlarrIndexerHealth.prowlarrInstanceId, instanceId),
				notInArray(prowlarrIndexerHealth.indexerId, activeIndexerIds)
			)
		)
		.returning({ id: prowlarrIndexerHealth.id });

	return result.length;
}

/**
 * Deletes all cached indexer health for a Prowlarr instance.
 * Used when an instance is deleted (cascades via FK) or manually cleared.
 *
 * @param instanceId - Prowlarr instance ID
 * @returns Number of deleted records
 */
export async function clearIndexerHealthCache(instanceId: number): Promise<number> {
	const result = await db
		.delete(prowlarrIndexerHealth)
		.where(eq(prowlarrIndexerHealth.prowlarrInstanceId, instanceId))
		.returning({ id: prowlarrIndexerHealth.id });

	return result.length;
}

/**
 * Gets health summary for a Prowlarr instance.
 *
 * @param instanceId - Prowlarr instance ID
 * @returns Summary with total indexers, enabled count, and rate-limited count
 */
export async function getIndexerHealthSummary(instanceId: number): Promise<{
	totalIndexers: number;
	enabledIndexers: number;
	rateLimitedIndexers: number;
}> {
	const indexers = await getIndexerHealthByInstance(instanceId);

	return {
		totalIndexers: indexers.length,
		enabledIndexers: indexers.filter((i) => i.enabled).length,
		rateLimitedIndexers: indexers.filter((i) => i.isRateLimited).length
	};
}
