/**
 * Database queries for throttle profile operations.
 *
 * Requirements: 7.1, 7.5, 7.6
 *
 * Throttle profiles control rate limiting for search dispatches.
 * Profile resolution follows: connector profile -> default profile -> fallback preset.
 */

import { db } from '$lib/server/db';
import {
	connectors,
	throttleProfiles,
	type Connector,
	type ThrottleProfile,
	type NewThrottleProfile
} from '$lib/server/db/schema';
import { and, count, eq, ne } from 'drizzle-orm';
import {
	DEFAULT_FALLBACK_PRESET,
	type ThrottlePreset
} from '$lib/server/services/throttle/presets';

// =============================================================================
// Input Types
// =============================================================================

/**
 * Input for creating a new throttle profile.
 * All rate limiting parameters are required for custom profiles.
 */
export interface CreateThrottleProfileInput {
	name: string;
	description?: string;
	requestsPerMinute: number;
	dailyBudget: number | null; // null = unlimited
	batchSize: number;
	batchCooldownSeconds: number;
	rateLimitPauseSeconds: number;
	isDefault?: boolean;
}

/**
 * Input for updating an existing throttle profile.
 * All fields are optional - only provided fields will be updated.
 */
export interface UpdateThrottleProfileInput {
	name?: string;
	description?: string;
	requestsPerMinute?: number;
	dailyBudget?: number | null;
	batchSize?: number;
	batchCooldownSeconds?: number;
	rateLimitPauseSeconds?: number;
	isDefault?: boolean;
}

// =============================================================================
// Basic CRUD Operations
// =============================================================================

/**
 * Gets a throttle profile by ID.
 *
 * @param id - Profile ID
 * @returns Profile if found, null otherwise
 */
export async function getThrottleProfile(id: number): Promise<ThrottleProfile | null> {
	const result = await db
		.select()
		.from(throttleProfiles)
		.where(eq(throttleProfiles.id, id))
		.limit(1);

	return result[0] ?? null;
}

/**
 * Gets all throttle profiles ordered by name.
 *
 * @returns Array of all throttle profiles
 */
export async function getAllThrottleProfiles(): Promise<ThrottleProfile[]> {
	return db.select().from(throttleProfiles).orderBy(throttleProfiles.name);
}

/**
 * Gets the default throttle profile (is_default = true).
 *
 * @returns Default profile if one exists, null otherwise
 */
export async function getDefaultThrottleProfile(): Promise<ThrottleProfile | null> {
	const result = await db
		.select()
		.from(throttleProfiles)
		.where(eq(throttleProfiles.isDefault, true))
		.limit(1);

	return result[0] ?? null;
}

/**
 * Creates a new throttle profile.
 *
 * @param input - Profile data
 * @returns Created profile
 * @throws Error if name is not unique
 */
export async function createThrottleProfile(
	input: CreateThrottleProfileInput
): Promise<ThrottleProfile> {
	// If setting as default, unset any existing default first
	if (input.isDefault) {
		await db
			.update(throttleProfiles)
			.set({ isDefault: false, updatedAt: new Date() })
			.where(eq(throttleProfiles.isDefault, true));
	}

	const result = await db
		.insert(throttleProfiles)
		.values({
			name: input.name,
			description: input.description ?? null,
			requestsPerMinute: input.requestsPerMinute,
			dailyBudget: input.dailyBudget,
			batchSize: input.batchSize,
			batchCooldownSeconds: input.batchCooldownSeconds,
			rateLimitPauseSeconds: input.rateLimitPauseSeconds,
			isDefault: input.isDefault ?? false
		})
		.returning();

	return result[0]!;
}

/**
 * Updates an existing throttle profile.
 *
 * @param id - Profile ID to update
 * @param input - Fields to update
 * @returns Updated profile, or null if not found
 */
export async function updateThrottleProfile(
	id: number,
	input: UpdateThrottleProfileInput
): Promise<ThrottleProfile | null> {
	// If setting as default, unset any existing default first
	if (input.isDefault === true) {
		await db
			.update(throttleProfiles)
			.set({ isDefault: false, updatedAt: new Date() })
			.where(and(eq(throttleProfiles.isDefault, true), ne(throttleProfiles.id, id)));
	}

	const updateData: Partial<NewThrottleProfile> & { updatedAt: Date } = {
		updatedAt: new Date()
	};

	if (input.name !== undefined) {
		updateData.name = input.name;
	}

	if (input.description !== undefined) {
		updateData.description = input.description;
	}

	if (input.requestsPerMinute !== undefined) {
		updateData.requestsPerMinute = input.requestsPerMinute;
	}

	if (input.dailyBudget !== undefined) {
		updateData.dailyBudget = input.dailyBudget;
	}

	if (input.batchSize !== undefined) {
		updateData.batchSize = input.batchSize;
	}

	if (input.batchCooldownSeconds !== undefined) {
		updateData.batchCooldownSeconds = input.batchCooldownSeconds;
	}

	if (input.rateLimitPauseSeconds !== undefined) {
		updateData.rateLimitPauseSeconds = input.rateLimitPauseSeconds;
	}

	if (input.isDefault !== undefined) {
		updateData.isDefault = input.isDefault;
	}

	const result = await db
		.update(throttleProfiles)
		.set(updateData)
		.where(eq(throttleProfiles.id, id))
		.returning();

	return result[0] ?? null;
}

/**
 * Deletes a throttle profile.
 * Will fail if the profile is currently assigned to any connectors.
 *
 * @param id - Profile ID to delete
 * @returns true if deleted, false if not found
 * @throws Error if profile is in use by connectors
 */
export async function deleteThrottleProfile(id: number): Promise<boolean> {
	// Check if profile is in use
	const usageCount = await getConnectorCountUsingProfile(id);
	if (usageCount > 0) {
		throw new Error(
			`Cannot delete throttle profile: it is assigned to ${usageCount} connector(s)`
		);
	}

	const result = await db
		.delete(throttleProfiles)
		.where(eq(throttleProfiles.id, id))
		.returning({ id: throttleProfiles.id });

	return result.length > 0;
}

/**
 * Checks if a throttle profile name already exists.
 *
 * @param name - Profile name to check
 * @param excludeId - Optional ID to exclude (for updates)
 * @returns true if a profile with this name exists
 */
export async function throttleProfileNameExists(
	name: string,
	excludeId?: number
): Promise<boolean> {
	const result = await db
		.select({ id: throttleProfiles.id })
		.from(throttleProfiles)
		.where(eq(throttleProfiles.name, name))
		.limit(1);

	if (result.length === 0) return false;
	if (excludeId !== undefined && result[0]?.id === excludeId) return false;

	return true;
}

// =============================================================================
// Profile Resolution (Requirements 7.5, 7.6)
// =============================================================================

/**
 * Effective throttle configuration type.
 * Can be either a database profile or a preset constant.
 */
export type EffectiveThrottleConfig = ThrottleProfile | ThrottlePreset;

/**
 * Gets the effective throttle profile for a connector.
 *
 * Profile resolution order:
 * 1. Connector's assigned profile (connectors.throttle_profile_id)
 * 2. Default profile (throttle_profiles.is_default = true)
 * 3. Fallback to Moderate preset constants
 *
 * @param connectorId - Connector ID
 * @returns The effective throttle configuration
 */
export async function getThrottleProfileForConnector(
	connectorId: number
): Promise<EffectiveThrottleConfig> {
	// 1. Get connector's assigned profile
	const connector = await db
		.select({
			id: connectors.id,
			throttleProfileId: connectors.throttleProfileId
		})
		.from(connectors)
		.where(eq(connectors.id, connectorId))
		.limit(1);

	if (connector.length === 0) {
		// Connector not found, return fallback
		return DEFAULT_FALLBACK_PRESET;
	}

	const throttleProfileId = connector[0]?.throttleProfileId;

	if (throttleProfileId !== null && throttleProfileId !== undefined) {
		const profile = await getThrottleProfile(throttleProfileId);
		if (profile) return profile;
	}

	// 2. Try default profile
	const defaultProfile = await getDefaultThrottleProfile();
	if (defaultProfile) return defaultProfile;

	// 3. Fallback to Moderate preset constants
	return DEFAULT_FALLBACK_PRESET;
}

/**
 * Gets the effective throttle profile for a connector by connector record.
 * Use this when you already have the connector loaded to avoid an extra query.
 *
 * @param connector - Connector record
 * @returns The effective throttle configuration
 */
export async function getThrottleProfileForConnectorRecord(
	connector: Pick<Connector, 'throttleProfileId'>
): Promise<EffectiveThrottleConfig> {
	// 1. Check connector's assigned profile
	if (connector.throttleProfileId !== null && connector.throttleProfileId !== undefined) {
		const profile = await getThrottleProfile(connector.throttleProfileId);
		if (profile) return profile;
	}

	// 2. Try default profile
	const defaultProfile = await getDefaultThrottleProfile();
	if (defaultProfile) return defaultProfile;

	// 3. Fallback to Moderate preset constants
	return DEFAULT_FALLBACK_PRESET;
}

// =============================================================================
// Connector Assignment Operations
// =============================================================================

/**
 * Assigns a throttle profile to a connector.
 *
 * @param connectorId - Connector ID
 * @param profileId - Profile ID to assign (null to use default)
 * @returns Updated connector, or null if connector not found
 */
export async function assignThrottleProfileToConnector(
	connectorId: number,
	profileId: number | null
): Promise<Connector | null> {
	const result = await db
		.update(connectors)
		.set({
			throttleProfileId: profileId,
			updatedAt: new Date()
		})
		.where(eq(connectors.id, connectorId))
		.returning();

	return result[0] ?? null;
}

/**
 * Gets all connectors using a specific throttle profile.
 *
 * @param profileId - Profile ID
 * @returns Array of connectors using the profile
 */
export async function getConnectorsUsingProfile(profileId: number): Promise<Connector[]> {
	return db
		.select()
		.from(connectors)
		.where(eq(connectors.throttleProfileId, profileId))
		.orderBy(connectors.name);
}

/**
 * Gets the count of connectors using a specific throttle profile.
 *
 * @param profileId - Profile ID
 * @returns Number of connectors using the profile
 */
export async function getConnectorCountUsingProfile(profileId: number): Promise<number> {
	const result = await db
		.select({ count: count() })
		.from(connectors)
		.where(eq(connectors.throttleProfileId, profileId));

	return result[0]?.count ?? 0;
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Sets a profile as the default, unsetting any existing default.
 *
 * @param id - Profile ID to set as default
 * @returns Updated profile, or null if not found
 */
export async function setDefaultThrottleProfile(id: number): Promise<ThrottleProfile | null> {
	// Unset existing default
	await db
		.update(throttleProfiles)
		.set({ isDefault: false, updatedAt: new Date() })
		.where(eq(throttleProfiles.isDefault, true));

	// Set new default
	const result = await db
		.update(throttleProfiles)
		.set({ isDefault: true, updatedAt: new Date() })
		.where(eq(throttleProfiles.id, id))
		.returning();

	return result[0] ?? null;
}

/**
 * Type guard to check if an effective config is a database profile.
 *
 * @param config - Configuration to check
 * @returns true if the config is a ThrottleProfile (has id)
 */
export function isThrottleProfile(
	config: EffectiveThrottleConfig
): config is ThrottleProfile {
	return 'id' in config;
}

// =============================================================================
// Re-export Throttle State Queries
// =============================================================================

export * from './throttle-state';
