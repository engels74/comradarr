/**
 * Database queries for API key operations.
 *
 * Requirement: 34.1
 *
 * API keys are hashed using Argon2id (same as passwords) since they cannot be recovered.
 * The full key is shown only once at creation, following industry best practices.
 */

import { db } from '$lib/server/db';
import { apiKeys, type ApiKey } from '$lib/server/db/schema';
import { and, desc, eq, gt, isNull, or } from 'drizzle-orm';
import { hashPassword, verifyPassword } from '$lib/server/auth';

/** API key length in bytes (256 bits of entropy) */
const API_KEY_BYTES = 32;

/** Prefix length for display in UI */
const PREFIX_LENGTH = 8;

/** API key format prefix */
const KEY_PREFIX = 'cmdr_';

/**
 * API key scope types.
 */
export type ApiKeyScope = 'read' | 'full';

/**
 * API key display type (without sensitive hash).
 * Used for listing keys in UI.
 */
export interface ApiKeyDisplay {
	id: number;
	userId: number;
	name: string;
	description: string | null;
	scope: ApiKeyScope;
	keyPrefix: string;
	expiresAt: Date | null;
	lastUsedAt: Date | null;
	createdAt: Date;
}

/**
 * Result of creating an API key.
 * The plainKey is shown only once at creation.
 */
export interface CreateApiKeyResult {
	key: ApiKeyDisplay;
	plainKey: string; // Full key - shown only once
}

/**
 * Input for creating a new API key.
 */
export interface CreateApiKeyInput {
	userId: number;
	name: string;
	description?: string | null;
	scope: ApiKeyScope;
	expiresAt?: Date | null;
}

/**
 * Generates a cryptographically secure API key.
 * Format: cmdr_<64-char-hex> = 69 characters total
 */
function generateApiKey(): string {
	const bytes = new Uint8Array(API_KEY_BYTES);
	crypto.getRandomValues(bytes);
	const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
	return `${KEY_PREFIX}${hex}`;
}

/**
 * Extracts the prefix from an API key for display.
 * Returns the first 8 characters after the cmdr_ prefix.
 */
function extractPrefix(key: string): string {
	return key.substring(KEY_PREFIX.length, KEY_PREFIX.length + PREFIX_LENGTH);
}

/**
 * Maps an ApiKey database row to ApiKeyDisplay (without hash).
 */
function toDisplay(row: ApiKey): ApiKeyDisplay {
	return {
		id: row.id,
		userId: row.userId,
		name: row.name,
		description: row.description,
		scope: row.scope as ApiKeyScope,
		keyPrefix: row.keyPrefix,
		expiresAt: row.expiresAt,
		lastUsedAt: row.lastUsedAt,
		createdAt: row.createdAt
	};
}

/**
 * Creates a new API key.
 *
 * @param input - API key configuration
 * @returns The created key info and plaintext key (shown only once)
 */
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
			expiresAt: input.expiresAt ?? null
		})
		.returning();

	const created = result[0]!;

	return {
		key: toDisplay(created),
		plainKey
	};
}

/**
 * Gets all API keys for a user (for display, without hashes).
 *
 * @param userId - User ID to get keys for
 * @returns Array of API key display info
 */
export async function getApiKeysByUser(userId: number): Promise<ApiKeyDisplay[]> {
	const results = await db
		.select()
		.from(apiKeys)
		.where(eq(apiKeys.userId, userId))
		.orderBy(desc(apiKeys.createdAt));

	return results.map(toDisplay);
}

/**
 * Gets a single API key by ID (for display, without hash).
 *
 * @param id - API key ID
 * @param userId - User ID (for ownership verification)
 * @returns API key display info if found and owned by user, null otherwise
 */
export async function getApiKey(id: number, userId: number): Promise<ApiKeyDisplay | null> {
	const result = await db
		.select()
		.from(apiKeys)
		.where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)))
		.limit(1);

	return result[0] ? toDisplay(result[0]) : null;
}

/**
 * Result of API key validation.
 */
export interface ValidateApiKeyResult {
	userId: number;
	scope: ApiKeyScope;
	keyId: number;
}

/**
 * Validates an API key and returns user info if valid.
 * Updates lastUsedAt on successful validation.
 *
 * @param key - The full API key to validate
 * @returns User ID, scope, and key ID if valid, null if invalid/expired
 */
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
			and(eq(apiKeys.keyPrefix, prefix), or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, now)))
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
				keyId: candidate.id
			};
		}
	}

	return null;
}

/**
 * Deletes an API key.
 *
 * @param id - The key ID to delete
 * @param userId - The user who owns the key (for authorization)
 * @returns true if deleted, false if not found or unauthorized
 */
export async function deleteApiKey(id: number, userId: number): Promise<boolean> {
	const result = await db
		.delete(apiKeys)
		.where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)))
		.returning({ id: apiKeys.id });

	return result.length > 0;
}

/**
 * Deletes all API keys for a user.
 *
 * @param userId - The user whose keys to delete
 * @returns Number of keys deleted
 */
export async function deleteAllApiKeys(userId: number): Promise<number> {
	const result = await db
		.delete(apiKeys)
		.where(eq(apiKeys.userId, userId))
		.returning({ id: apiKeys.id });

	return result.length;
}

/**
 * Checks if an API key name already exists for a user.
 *
 * @param userId - User ID
 * @param name - Key name to check
 * @param excludeId - Optional key ID to exclude (for updates)
 * @returns true if name exists, false otherwise
 */
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
