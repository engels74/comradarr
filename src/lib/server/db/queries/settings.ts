/**
 * Database queries for application settings operations.
 *
 * Requirements: 21.1, 21.4, 21.5
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
 * Default values for general application settings.
 * These are used when a setting is not found in the database.
 */
export const GENERAL_SETTINGS_DEFAULTS = {
	app_name: 'Comradarr',
	timezone: 'UTC',
	log_level: 'info',
	check_for_updates: 'true'
} as const;

/**
 * Default values for security settings.
 *
 * Requirements: 21.5, 10.3
 */
export const SECURITY_SETTINGS_DEFAULTS = {
	auth_mode: 'full'
} as const;

/**
 * Default values for search behavior settings.
 * These match the original hard-coded constants in queue/config.ts.
 *
 * Requirements: 21.4
 */
export const SEARCH_SETTINGS_DEFAULTS = {
	// Priority Weights
	search_priority_weight_content_age: '30',
	search_priority_weight_missing_duration: '25',
	search_priority_weight_user_priority: '40',
	search_priority_weight_failure_penalty: '10',
	search_priority_weight_gap_bonus: '20',

	// Season Pack Thresholds
	search_season_pack_min_missing_percent: '50',
	search_season_pack_min_missing_count: '3',

	// Cooldown Configuration
	search_cooldown_base_delay_hours: '1',
	search_cooldown_max_delay_hours: '24',
	search_cooldown_multiplier: '2',
	search_cooldown_jitter: 'true',

	// Retry Configuration
	search_max_attempts: '5'
} as const;

/**
 * Combined default values for all application settings.
 */
export const SETTINGS_DEFAULTS = {
	...GENERAL_SETTINGS_DEFAULTS,
	...SECURITY_SETTINGS_DEFAULTS,
	...SEARCH_SETTINGS_DEFAULTS
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

// =============================================================================
// Search Settings Types
// =============================================================================

/**
 * Represents the search behavior settings.
 *
 * Requirements: 21.4
 */
export interface SearchSettings {
	priorityWeights: {
		contentAge: number;
		missingDuration: number;
		userPriority: number;
		failurePenalty: number;
		gapBonus: number;
	};
	seasonPackThresholds: {
		minMissingPercent: number;
		minMissingCount: number;
	};
	cooldownConfig: {
		baseDelayHours: number;
		maxDelayHours: number;
		multiplier: number;
		jitter: boolean;
	};
	retryConfig: {
		maxAttempts: number;
	};
}

// =============================================================================
// Search Settings Operations
// =============================================================================

/**
 * Gets search behavior settings with defaults applied.
 *
 * Requirements: 21.4
 *
 * @returns Search settings object with all fields populated
 */
export async function getSearchSettings(): Promise<SearchSettings> {
	const keys = Object.keys(SEARCH_SETTINGS_DEFAULTS) as Array<keyof typeof SEARCH_SETTINGS_DEFAULTS>;
	const settings = await getSettings(keys);

	return {
		priorityWeights: {
			contentAge: Number(
				settings['search_priority_weight_content_age'] ??
					SEARCH_SETTINGS_DEFAULTS.search_priority_weight_content_age
			),
			missingDuration: Number(
				settings['search_priority_weight_missing_duration'] ??
					SEARCH_SETTINGS_DEFAULTS.search_priority_weight_missing_duration
			),
			userPriority: Number(
				settings['search_priority_weight_user_priority'] ??
					SEARCH_SETTINGS_DEFAULTS.search_priority_weight_user_priority
			),
			failurePenalty: Number(
				settings['search_priority_weight_failure_penalty'] ??
					SEARCH_SETTINGS_DEFAULTS.search_priority_weight_failure_penalty
			),
			gapBonus: Number(
				settings['search_priority_weight_gap_bonus'] ??
					SEARCH_SETTINGS_DEFAULTS.search_priority_weight_gap_bonus
			)
		},
		seasonPackThresholds: {
			minMissingPercent: Number(
				settings['search_season_pack_min_missing_percent'] ??
					SEARCH_SETTINGS_DEFAULTS.search_season_pack_min_missing_percent
			),
			minMissingCount: Number(
				settings['search_season_pack_min_missing_count'] ??
					SEARCH_SETTINGS_DEFAULTS.search_season_pack_min_missing_count
			)
		},
		cooldownConfig: {
			baseDelayHours: Number(
				settings['search_cooldown_base_delay_hours'] ??
					SEARCH_SETTINGS_DEFAULTS.search_cooldown_base_delay_hours
			),
			maxDelayHours: Number(
				settings['search_cooldown_max_delay_hours'] ??
					SEARCH_SETTINGS_DEFAULTS.search_cooldown_max_delay_hours
			),
			multiplier: Number(
				settings['search_cooldown_multiplier'] ?? SEARCH_SETTINGS_DEFAULTS.search_cooldown_multiplier
			),
			jitter:
				(settings['search_cooldown_jitter'] ?? SEARCH_SETTINGS_DEFAULTS.search_cooldown_jitter) ===
				'true'
		},
		retryConfig: {
			maxAttempts: Number(
				settings['search_max_attempts'] ?? SEARCH_SETTINGS_DEFAULTS.search_max_attempts
			)
		}
	};
}

/**
 * Updates search behavior settings.
 *
 * Requirements: 21.4
 *
 * @param input - Settings to update
 */
export async function updateSearchSettings(input: SearchSettings): Promise<void> {
	const updates: Array<{ key: string; value: string }> = [
		// Priority Weights
		{ key: 'search_priority_weight_content_age', value: String(input.priorityWeights.contentAge) },
		{
			key: 'search_priority_weight_missing_duration',
			value: String(input.priorityWeights.missingDuration)
		},
		{ key: 'search_priority_weight_user_priority', value: String(input.priorityWeights.userPriority) },
		{
			key: 'search_priority_weight_failure_penalty',
			value: String(input.priorityWeights.failurePenalty)
		},
		{ key: 'search_priority_weight_gap_bonus', value: String(input.priorityWeights.gapBonus) },

		// Season Pack Thresholds
		{
			key: 'search_season_pack_min_missing_percent',
			value: String(input.seasonPackThresholds.minMissingPercent)
		},
		{
			key: 'search_season_pack_min_missing_count',
			value: String(input.seasonPackThresholds.minMissingCount)
		},

		// Cooldown Configuration
		{ key: 'search_cooldown_base_delay_hours', value: String(input.cooldownConfig.baseDelayHours) },
		{ key: 'search_cooldown_max_delay_hours', value: String(input.cooldownConfig.maxDelayHours) },
		{ key: 'search_cooldown_multiplier', value: String(input.cooldownConfig.multiplier) },
		{ key: 'search_cooldown_jitter', value: input.cooldownConfig.jitter ? 'true' : 'false' },

		// Retry Configuration
		{ key: 'search_max_attempts', value: String(input.retryConfig.maxAttempts) }
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

// =============================================================================
// Security Settings Types
// =============================================================================

/**
 * Valid authentication modes.
 */
export type AuthMode = 'full' | 'local_bypass';

/**
 * Represents the security settings.
 *
 * Requirements: 21.5
 */
export interface SecuritySettings {
	authMode: AuthMode;
}

// =============================================================================
// Security Settings Operations
// =============================================================================

/**
 * Gets security settings with defaults applied.
 *
 * Requirements: 21.5
 *
 * @returns Security settings object with all fields populated
 */
export async function getSecuritySettings(): Promise<SecuritySettings> {
	const value = await getSetting('auth_mode');

	return {
		authMode: (value ?? SECURITY_SETTINGS_DEFAULTS.auth_mode) as AuthMode
	};
}

/**
 * Updates security settings.
 *
 * Requirements: 21.5
 *
 * @param input - Settings to update
 */
export async function updateSecuritySettings(input: { authMode: AuthMode }): Promise<void> {
	await setSetting('auth_mode', input.authMode);
}
