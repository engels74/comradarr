import { and, eq, notInArray, sql } from 'drizzle-orm';
import { DecryptionError, decrypt, encrypt, SecretKeyError } from '$lib/server/crypto';
import { db } from '$lib/server/db';
import {
	type NewProwlarrInstance,
	type ProwlarrIndexerHealth,
	type ProwlarrInstance,
	prowlarrIndexerHealth,
	prowlarrInstances
} from '$lib/server/db/schema';
import type { IndexerHealth, ProwlarrHealthStatus } from '$lib/server/services/prowlarr/types';

export { DecryptionError, SecretKeyError };

export interface CreateProwlarrInstanceInput {
	name: string;
	url: string;
	apiKey: string; // Plain text, will be encrypted
	enabled?: boolean;
}

export interface UpdateProwlarrInstanceInput {
	name?: string;
	url?: string;
	apiKey?: string; // Plain text, will be encrypted if provided
	enabled?: boolean;
	healthStatus?: ProwlarrHealthStatus;
}

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

export async function getProwlarrInstance(id: number): Promise<ProwlarrInstance | null> {
	const result = await db
		.select()
		.from(prowlarrInstances)
		.where(eq(prowlarrInstances.id, id))
		.limit(1);

	return result[0] ?? null;
}

export async function getAllProwlarrInstances(): Promise<ProwlarrInstance[]> {
	return db.select().from(prowlarrInstances).orderBy(prowlarrInstances.name);
}

export async function getEnabledProwlarrInstances(): Promise<ProwlarrInstance[]> {
	return db
		.select()
		.from(prowlarrInstances)
		.where(eq(prowlarrInstances.enabled, true))
		.orderBy(prowlarrInstances.name);
}

export async function getDecryptedApiKey(instance: ProwlarrInstance): Promise<string> {
	return decrypt(instance.apiKeyEncrypted);
}

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

export async function deleteProwlarrInstance(id: number): Promise<boolean> {
	const result = await db
		.delete(prowlarrInstances)
		.where(eq(prowlarrInstances.id, id))
		.returning({ id: prowlarrInstances.id });

	return result.length > 0;
}

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

function normalizeUrl(url: string): string {
	return url.replace(/\/+$/, '');
}

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
	const _result = await db
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

export async function getIndexerHealthByInstance(
	instanceId: number
): Promise<ProwlarrIndexerHealth[]> {
	return db
		.select()
		.from(prowlarrIndexerHealth)
		.where(eq(prowlarrIndexerHealth.prowlarrInstanceId, instanceId))
		.orderBy(prowlarrIndexerHealth.name);
}

export async function getAllCachedIndexerHealth(): Promise<ProwlarrIndexerHealth[]> {
	return db.select().from(prowlarrIndexerHealth).orderBy(prowlarrIndexerHealth.name);
}

export async function getRateLimitedIndexers(instanceId: number): Promise<ProwlarrIndexerHealth[]> {
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

export async function clearIndexerHealthCache(instanceId: number): Promise<number> {
	const result = await db
		.delete(prowlarrIndexerHealth)
		.where(eq(prowlarrIndexerHealth.prowlarrInstanceId, instanceId))
		.returning({ id: prowlarrIndexerHealth.id });

	return result.length;
}

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
