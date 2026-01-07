import { and, count, eq, ne } from 'drizzle-orm';
import { DEFAULT_FALLBACK_PRESET, type ThrottlePreset } from '$lib/config/throttle-presets';
import { db } from '$lib/server/db';
import {
	type Connector,
	connectors,
	type NewThrottleProfile,
	type ThrottleProfile,
	throttleProfiles
} from '$lib/server/db/schema';

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

export async function getThrottleProfile(id: number): Promise<ThrottleProfile | null> {
	const result = await db
		.select()
		.from(throttleProfiles)
		.where(eq(throttleProfiles.id, id))
		.limit(1);

	return result[0] ?? null;
}

export async function getAllThrottleProfiles(): Promise<ThrottleProfile[]> {
	return db.select().from(throttleProfiles).orderBy(throttleProfiles.name);
}

export async function getDefaultThrottleProfile(): Promise<ThrottleProfile | null> {
	const result = await db
		.select()
		.from(throttleProfiles)
		.where(eq(throttleProfiles.isDefault, true))
		.limit(1);

	return result[0] ?? null;
}

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

export async function deleteThrottleProfile(id: number): Promise<boolean> {
	// Check if profile is in use
	const usageCount = await getConnectorCountUsingProfile(id);
	if (usageCount > 0) {
		throw new Error(`Cannot delete throttle profile: it is assigned to ${usageCount} connector(s)`);
	}

	const result = await db
		.delete(throttleProfiles)
		.where(eq(throttleProfiles.id, id))
		.returning({ id: throttleProfiles.id });

	return result.length > 0;
}

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

export type EffectiveThrottleConfig = ThrottleProfile | ThrottlePreset;

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

export async function getConnectorsUsingProfile(profileId: number): Promise<Connector[]> {
	return db
		.select()
		.from(connectors)
		.where(eq(connectors.throttleProfileId, profileId))
		.orderBy(connectors.name);
}

export async function getConnectorCountUsingProfile(profileId: number): Promise<number> {
	const result = await db
		.select({ count: count() })
		.from(connectors)
		.where(eq(connectors.throttleProfileId, profileId));

	return result[0]?.count ?? 0;
}

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

export function isThrottleProfile(config: EffectiveThrottleConfig): config is ThrottleProfile {
	return 'id' in config;
}

export * from './throttle-state';
