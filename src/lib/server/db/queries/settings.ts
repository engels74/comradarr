/**
 * Database queries for application settings operations.
 *
 * Requirements: 21.1
 *
 * Application settings are stored as key-value pairs with defaults applied
 * when a setting is not explicitly configured.
 */

import { db } from '$lib/server/db';
import { appSettings, type AppSetting } from '$lib/server/db/schema';
import { eq, inArray } from 'drizzle-orm';

// =============================================================================
// Default Values
// =============================================================================

/**
 * Default values for all application settings.
 * These are used when a setting is not found in the database.
 */
export const SETTINGS_DEFAULTS = {
	app_name: 'Comradarr',
	timezone: 'UTC',
	log_level: 'info',
	check_for_updates: 'true'
} as const;

export type SettingKey = keyof typeof SETTINGS_DEFAULTS;

// =============================================================================
// General Settings Type
// =============================================================================

/**
 * Represents the general settings with camelCase keys for UI use.
 */
export interface GeneralSettings {
	appName: string;
	timezone: string;
	logLevel: string;
	checkForUpdates: boolean;
}

/**
 * Input type for updating general settings.
 */
export interface GeneralSettingsInput {
	appName: string;
	timezone: string;
	logLevel: string;
	checkForUpdates: boolean;
}

// =============================================================================
// Basic Operations
// =============================================================================

/**
 * Gets a single setting value by key.
 *
 * @param key - Setting key
 * @returns Setting value if found, null otherwise
 */
export async function getSetting(key: string): Promise<string | null> {
	const result = await db
		.select({ value: appSettings.value })
		.from(appSettings)
		.where(eq(appSettings.key, key))
		.limit(1);

	return result[0]?.value ?? null;
}

/**
 * Gets a single setting value with default fallback.
 *
 * @param key - Setting key
 * @returns Setting value or default if not found
 */
export async function getSettingWithDefault(key: SettingKey): Promise<string> {
	const value = await getSetting(key);
	return value ?? SETTINGS_DEFAULTS[key];
}

/**
 * Sets a single setting value. Creates if not exists, updates if exists.
 *
 * @param key - Setting key
 * @param value - Setting value
 */
export async function setSetting(key: string, value: string): Promise<void> {
	await db
		.insert(appSettings)
		.values({
			key,
			value,
			updatedAt: new Date()
		})
		.onConflictDoUpdate({
			target: appSettings.key,
			set: {
				value,
				updatedAt: new Date()
			}
		});
}

/**
 * Gets multiple settings by keys.
 *
 * @param keys - Array of setting keys
 * @returns Record of key-value pairs (null for missing keys)
 */
export async function getSettings(keys: string[]): Promise<Record<string, string | null>> {
	if (keys.length === 0) {
		return {};
	}

	const result = await db
		.select({ key: appSettings.key, value: appSettings.value })
		.from(appSettings)
		.where(inArray(appSettings.key, keys));

	const settings: Record<string, string | null> = {};
	for (const key of keys) {
		settings[key] = null;
	}
	for (const row of result) {
		settings[row.key] = row.value;
	}

	return settings;
}

/**
 * Gets all settings from the database.
 *
 * @returns Array of all settings
 */
export async function getAllSettings(): Promise<AppSetting[]> {
	return db.select().from(appSettings).orderBy(appSettings.key);
}

// =============================================================================
// General Settings Operations
// =============================================================================

/**
 * Gets general settings with defaults applied.
 *
 * @returns General settings object with all fields populated
 */
export async function getGeneralSettings(): Promise<GeneralSettings> {
	const keys: SettingKey[] = ['app_name', 'timezone', 'log_level', 'check_for_updates'];
	const settings = await getSettings(keys);

	return {
		appName: settings['app_name'] ?? SETTINGS_DEFAULTS.app_name,
		timezone: settings['timezone'] ?? SETTINGS_DEFAULTS.timezone,
		logLevel: settings['log_level'] ?? SETTINGS_DEFAULTS.log_level,
		checkForUpdates: (settings['check_for_updates'] ?? SETTINGS_DEFAULTS.check_for_updates) === 'true'
	};
}

/**
 * Updates general settings.
 *
 * @param input - Settings to update
 */
export async function updateGeneralSettings(input: GeneralSettingsInput): Promise<void> {
	const updates: Array<{ key: string; value: string }> = [
		{ key: 'app_name', value: input.appName },
		{ key: 'timezone', value: input.timezone },
		{ key: 'log_level', value: input.logLevel },
		{ key: 'check_for_updates', value: input.checkForUpdates ? 'true' : 'false' }
	];

	// Use a transaction to ensure all settings are updated atomically
	await db.transaction(async (tx) => {
		for (const { key, value } of updates) {
			await tx
				.insert(appSettings)
				.values({
					key,
					value,
					updatedAt: new Date()
				})
				.onConflictDoUpdate({
					target: appSettings.key,
					set: {
						value,
						updatedAt: new Date()
					}
				});
		}
	});
}

/**
 * Deletes a setting by key.
 *
 * @param key - Setting key to delete
 * @returns true if setting was deleted, false if not found
 */
export async function deleteSetting(key: string): Promise<boolean> {
	const result = await db.delete(appSettings).where(eq(appSettings.key, key)).returning();

	return result.length > 0;
}
