import { and, desc, eq, gt, isNull, or } from 'drizzle-orm';
import { hashPassword, verifyPassword } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { type ApiKey, apiKeys, apiKeyUsageLogs } from '$lib/server/db/schema';

/** API key length in bytes (256 bits of entropy) */
const API_KEY_BYTES = 32;

/** Prefix length for display in UI */
const PREFIX_LENGTH = 8;

const KEY_PREFIX = 'cmdr_';

export type ApiKeyScope = 'read' | 'full';

export interface ApiKeyDisplay {
	id: number;
	userId: number;
	name: string;
	description: string | null;
	scope: ApiKeyScope;
	keyPrefix: string;
	rateLimitPerMinute: number | null; // null = unlimited
	expiresAt: Date | null;
	revokedAt: Date | null;
	lastUsedAt: Date | null;
	createdAt: Date;
}

export interface CreateApiKeyResult {
	key: ApiKeyDisplay;
	plainKey: string;
}

export interface CreateApiKeyInput {
	userId: number;
	name: string;
	description?: string | null;
	scope: ApiKeyScope;
	rateLimitPerMinute?: number | null; // null = unlimited
	expiresAt?: Date | null;
}

function generateApiKey(): string {
	const bytes = new Uint8Array(API_KEY_BYTES);
	crypto.getRandomValues(bytes);
	const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
	return `${KEY_PREFIX}${hex}`;
}

function extractPrefix(key: string): string {
	return key.substring(KEY_PREFIX.length, KEY_PREFIX.length + PREFIX_LENGTH);
}

function toDisplay(row: ApiKey): ApiKeyDisplay {
	return {
		id: row.id,
		userId: row.userId,
		name: row.name,
		description: row.description,
		scope: row.scope as ApiKeyScope,
		keyPrefix: row.keyPrefix,
		rateLimitPerMinute: row.rateLimitPerMinute,
		expiresAt: row.expiresAt,
		revokedAt: row.revokedAt,
		lastUsedAt: row.lastUsedAt,
		createdAt: row.createdAt
	};
}

export async function createApiKey(input: CreateApiKeyInput): Promise<CreateApiKeyResult> {
	const plainKey = generateApiKey();
	const keyPrefix = extractPrefix(plainKey);
	const keyHash = await hashPassword(plainKey);

	const result = await db
		.insert(apiKeys)
		.values({
			userId: input.userId,
			name: input.name,
			description: input.description ?? null,
			scope: input.scope,
			keyPrefix,
			keyHash,
			rateLimitPerMinute: input.rateLimitPerMinute ?? null,
			expiresAt: input.expiresAt ?? null
		})
		.returning();

	const created = result[0]!;

	return {
		key: toDisplay(created),
		plainKey
	};
}

export async function getApiKeysByUser(userId: number): Promise<ApiKeyDisplay[]> {
	const results = await db
		.select()
		.from(apiKeys)
		.where(eq(apiKeys.userId, userId))
		.orderBy(desc(apiKeys.createdAt));

	return results.map(toDisplay);
}

export async function getApiKey(id: number, userId: number): Promise<ApiKeyDisplay | null> {
	const result = await db
		.select()
		.from(apiKeys)
		.where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)))
		.limit(1);

	return result[0] ? toDisplay(result[0]) : null;
}

export interface ValidateApiKeyResult {
	userId: number;
	scope: ApiKeyScope;
	keyId: number;
	rateLimitPerMinute: number | null;
}

export async function validateApiKey(key: string): Promise<ValidateApiKeyResult | null> {
	// Must start with cmdr_ prefix
	if (!key.startsWith(KEY_PREFIX)) {
		return null;
	}

	const prefix = extractPrefix(key);

	// Find keys with matching prefix (narrows search before expensive hash verification)
	const now = new Date();
	const candidates = await db
		.select()
		.from(apiKeys)
		.where(
			and(
				eq(apiKeys.keyPrefix, prefix),
				or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, now)),
				isNull(apiKeys.revokedAt)
			)
		);

	// Verify against each candidate (typically just one due to prefix uniqueness)
	for (const candidate of candidates) {
		const isValid = await verifyPassword(candidate.keyHash, key);
		if (isValid) {
			// Update last used timestamp (fire and forget)
			db.update(apiKeys)
				.set({ lastUsedAt: now })
				.where(eq(apiKeys.id, candidate.id))
				.execute()
				.catch(() => {
					/* ignore errors */
				});

			return {
				userId: candidate.userId,
				scope: candidate.scope as ApiKeyScope,
				keyId: candidate.id,
				rateLimitPerMinute: candidate.rateLimitPerMinute
			};
		}
	}

	return null;
}

export async function deleteApiKey(id: number, userId: number): Promise<boolean> {
	const result = await db
		.delete(apiKeys)
		.where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)))
		.returning({ id: apiKeys.id });

	return result.length > 0;
}

export async function revokeApiKey(id: number, userId: number): Promise<boolean> {
	const result = await db
		.update(apiKeys)
		.set({ revokedAt: new Date() })
		.where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)))
		.returning({ id: apiKeys.id });

	return result.length > 0;
}

export async function deleteAllApiKeys(userId: number): Promise<number> {
	const result = await db
		.delete(apiKeys)
		.where(eq(apiKeys.userId, userId))
		.returning({ id: apiKeys.id });

	return result.length;
}

export async function apiKeyNameExists(
	userId: number,
	name: string,
	excludeId?: number
): Promise<boolean> {
	const conditions = [eq(apiKeys.userId, userId), eq(apiKeys.name, name)];

	const result = await db
		.select({ id: apiKeys.id })
		.from(apiKeys)
		.where(and(...conditions))
		.limit(1);

	// If excludeId provided, check if the found key is different
	if (excludeId !== undefined && result.length > 0) {
		return result[0]!.id !== excludeId;
	}

	return result.length > 0;
}

export interface ApiKeyUsageLogInput {
	apiKeyId: number;
	endpoint: string;
	method: string;
	statusCode?: number | undefined;
	responseTimeMs?: number | undefined;
	ipAddress?: string | undefined;
	userAgent?: string | undefined;
}

export async function logApiKeyUsage(input: ApiKeyUsageLogInput): Promise<void> {
	await db.insert(apiKeyUsageLogs).values({
		apiKeyId: input.apiKeyId,
		endpoint: input.endpoint,
		method: input.method,
		statusCode: input.statusCode,
		responseTimeMs: input.responseTimeMs,
		ipAddress: input.ipAddress,
		userAgent: input.userAgent
	});
}

export async function updateApiKeyRateLimit(
	keyId: number,
	userId: number,
	rateLimitPerMinute: number | null
): Promise<boolean> {
	const result = await db
		.update(apiKeys)
		.set({ rateLimitPerMinute })
		.where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId)))
		.returning({ id: apiKeys.id });

	return result.length > 0;
}
