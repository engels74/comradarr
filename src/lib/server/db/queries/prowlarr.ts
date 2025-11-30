/**
 * Database queries for Prowlarr instance operations.
 *
 * @requirements 38.1
 *
 * API keys are encrypted using AES-256-GCM before storage.
 * Decryption happens lazily, only when the key is needed for API calls.
 */

import { db } from '$lib/server/db';
import {
	prowlarrInstances,
	type ProwlarrInstance,
	type NewProwlarrInstance
} from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { encrypt, decrypt, DecryptionError, SecretKeyError } from '$lib/server/crypto';
import type { ProwlarrHealthStatus } from '$lib/server/services/prowlarr/types';

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
 * @requirements 38.1
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
