import { eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { type AppSetting, appSettings } from '$lib/server/db/schema';

export const GENERAL_SETTINGS_DEFAULTS = {
	app_name: 'Comradarr',
	timezone: 'UTC',
	log_level: 'info',
	check_for_updates: 'true'
} as const;

export const SECURITY_SETTINGS_DEFAULTS = {
	auth_mode: 'full'
} as const;

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
	search_max_attempts: '5',

	// Backlog Configuration (for exhausted items)
	search_backlog_enabled: 'true',
	search_backlog_tier1_delay_days: '7',
	search_backlog_tier2_delay_days: '14',
	search_backlog_tier3_delay_days: '30',
	search_backlog_tier4_delay_days: '60',
	search_backlog_tier5_delay_days: '90'
} as const;

export const MAINTENANCE_SETTINGS_DEFAULTS = {
	// History retention in days (search_history table)
	history_retention_days_search: '90',
	// Log retention in days (application_logs table)
	log_retention_days: '14',
	// Whether log persistence is enabled
	log_persistence_enabled: 'true'
} as const;

export const BACKUP_SETTINGS_DEFAULTS = {
	// Whether scheduled backups are enabled
	backup_scheduled_enabled: 'false',
	// Cron expression for backup schedule (default: daily at 2 AM)
	backup_scheduled_cron: '0 2 * * *',
	// Number of scheduled backups to retain
	backup_retention_count: '7'
} as const;

export const SETTINGS_DEFAULTS = {
	...GENERAL_SETTINGS_DEFAULTS,
	...SECURITY_SETTINGS_DEFAULTS,
	...SEARCH_SETTINGS_DEFAULTS,
	...MAINTENANCE_SETTINGS_DEFAULTS,
	...BACKUP_SETTINGS_DEFAULTS
} as const;

export type SettingKey = keyof typeof SETTINGS_DEFAULTS;

export interface GeneralSettings {
	appName: string;
	timezone: string;
	logLevel: string;
	checkForUpdates: boolean;
}

export interface GeneralSettingsInput {
	appName: string;
	timezone: string;
	logLevel: string;
	checkForUpdates: boolean;
}

export async function getSetting(key: string): Promise<string | null> {
	const result = await db
		.select({ value: appSettings.value })
		.from(appSettings)
		.where(eq(appSettings.key, key))
		.limit(1);

	return result[0]?.value ?? null;
}

export async function getSettingWithDefault(key: SettingKey): Promise<string> {
	const value = await getSetting(key);
	return value ?? SETTINGS_DEFAULTS[key];
}

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

export async function getAllSettings(): Promise<AppSetting[]> {
	return db.select().from(appSettings).orderBy(appSettings.key);
}

export async function getGeneralSettings(): Promise<GeneralSettings> {
	const keys: SettingKey[] = ['app_name', 'timezone', 'log_level', 'check_for_updates'];
	const settings = await getSettings(keys);

	return {
		appName: settings.app_name ?? SETTINGS_DEFAULTS.app_name,
		timezone: settings.timezone ?? SETTINGS_DEFAULTS.timezone,
		logLevel: settings.log_level ?? SETTINGS_DEFAULTS.log_level,
		checkForUpdates: (settings.check_for_updates ?? SETTINGS_DEFAULTS.check_for_updates) === 'true'
	};
}

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

export async function deleteSetting(key: string): Promise<boolean> {
	const result = await db.delete(appSettings).where(eq(appSettings.key, key)).returning();

	return result.length > 0;
}

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
	backlogConfig: {
		enabled: boolean;
		tierDelaysDays: number[];
	};
}

export async function getSearchSettings(): Promise<SearchSettings> {
	const keys = Object.keys(SEARCH_SETTINGS_DEFAULTS) as Array<
		keyof typeof SEARCH_SETTINGS_DEFAULTS
	>;
	const settings = await getSettings(keys);

	return {
		priorityWeights: {
			contentAge: Number(
				settings.search_priority_weight_content_age ??
					SEARCH_SETTINGS_DEFAULTS.search_priority_weight_content_age
			),
			missingDuration: Number(
				settings.search_priority_weight_missing_duration ??
					SEARCH_SETTINGS_DEFAULTS.search_priority_weight_missing_duration
			),
			userPriority: Number(
				settings.search_priority_weight_user_priority ??
					SEARCH_SETTINGS_DEFAULTS.search_priority_weight_user_priority
			),
			failurePenalty: Number(
				settings.search_priority_weight_failure_penalty ??
					SEARCH_SETTINGS_DEFAULTS.search_priority_weight_failure_penalty
			),
			gapBonus: Number(
				settings.search_priority_weight_gap_bonus ??
					SEARCH_SETTINGS_DEFAULTS.search_priority_weight_gap_bonus
			)
		},
		seasonPackThresholds: {
			minMissingPercent: Number(
				settings.search_season_pack_min_missing_percent ??
					SEARCH_SETTINGS_DEFAULTS.search_season_pack_min_missing_percent
			),
			minMissingCount: Number(
				settings.search_season_pack_min_missing_count ??
					SEARCH_SETTINGS_DEFAULTS.search_season_pack_min_missing_count
			)
		},
		cooldownConfig: {
			baseDelayHours: Number(
				settings.search_cooldown_base_delay_hours ??
					SEARCH_SETTINGS_DEFAULTS.search_cooldown_base_delay_hours
			),
			maxDelayHours: Number(
				settings.search_cooldown_max_delay_hours ??
					SEARCH_SETTINGS_DEFAULTS.search_cooldown_max_delay_hours
			),
			multiplier: Number(
				settings.search_cooldown_multiplier ?? SEARCH_SETTINGS_DEFAULTS.search_cooldown_multiplier
			),
			jitter:
				(settings.search_cooldown_jitter ?? SEARCH_SETTINGS_DEFAULTS.search_cooldown_jitter) ===
				'true'
		},
		retryConfig: {
			maxAttempts: Number(
				settings.search_max_attempts ?? SEARCH_SETTINGS_DEFAULTS.search_max_attempts
			)
		},
		backlogConfig: {
			enabled:
				(settings.search_backlog_enabled ?? SEARCH_SETTINGS_DEFAULTS.search_backlog_enabled) ===
				'true',
			tierDelaysDays: [
				Number(
					settings.search_backlog_tier1_delay_days ??
						SEARCH_SETTINGS_DEFAULTS.search_backlog_tier1_delay_days
				),
				Number(
					settings.search_backlog_tier2_delay_days ??
						SEARCH_SETTINGS_DEFAULTS.search_backlog_tier2_delay_days
				),
				Number(
					settings.search_backlog_tier3_delay_days ??
						SEARCH_SETTINGS_DEFAULTS.search_backlog_tier3_delay_days
				),
				Number(
					settings.search_backlog_tier4_delay_days ??
						SEARCH_SETTINGS_DEFAULTS.search_backlog_tier4_delay_days
				),
				Number(
					settings.search_backlog_tier5_delay_days ??
						SEARCH_SETTINGS_DEFAULTS.search_backlog_tier5_delay_days
				)
			]
		}
	};
}

export async function updateSearchSettings(input: SearchSettings): Promise<void> {
	const updates: Array<{ key: string; value: string }> = [
		// Priority Weights
		{ key: 'search_priority_weight_content_age', value: String(input.priorityWeights.contentAge) },
		{
			key: 'search_priority_weight_missing_duration',
			value: String(input.priorityWeights.missingDuration)
		},
		{
			key: 'search_priority_weight_user_priority',
			value: String(input.priorityWeights.userPriority)
		},
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
		{ key: 'search_max_attempts', value: String(input.retryConfig.maxAttempts) },

		// Backlog Configuration
		{ key: 'search_backlog_enabled', value: input.backlogConfig.enabled ? 'true' : 'false' },
		{
			key: 'search_backlog_tier1_delay_days',
			value: String(input.backlogConfig.tierDelaysDays[0])
		},
		{
			key: 'search_backlog_tier2_delay_days',
			value: String(input.backlogConfig.tierDelaysDays[1])
		},
		{
			key: 'search_backlog_tier3_delay_days',
			value: String(input.backlogConfig.tierDelaysDays[2])
		},
		{
			key: 'search_backlog_tier4_delay_days',
			value: String(input.backlogConfig.tierDelaysDays[3])
		},
		{ key: 'search_backlog_tier5_delay_days', value: String(input.backlogConfig.tierDelaysDays[4]) }
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

export type AuthMode = 'full' | 'local_bypass';

export interface SecuritySettings {
	authMode: AuthMode;
}

export async function getSecuritySettings(): Promise<SecuritySettings> {
	const value = await getSetting('auth_mode');

	return {
		authMode: (value ?? SECURITY_SETTINGS_DEFAULTS.auth_mode) as AuthMode
	};
}

export async function updateSecuritySettings(input: { authMode: AuthMode }): Promise<void> {
	await setSetting('auth_mode', input.authMode);
}

export interface BackupSettings {
	/** Whether scheduled backups are enabled */
	scheduledEnabled: boolean;
	/** Cron expression for backup schedule */
	scheduledCron: string;
	/** Number of scheduled backups to retain */
	retentionCount: number;
}

export async function getBackupSettings(): Promise<BackupSettings> {
	const keys = Object.keys(BACKUP_SETTINGS_DEFAULTS) as Array<
		keyof typeof BACKUP_SETTINGS_DEFAULTS
	>;
	const settings = await getSettings(keys);

	return {
		scheduledEnabled:
			(settings.backup_scheduled_enabled ?? BACKUP_SETTINGS_DEFAULTS.backup_scheduled_enabled) ===
			'true',
		scheduledCron: settings.backup_scheduled_cron ?? BACKUP_SETTINGS_DEFAULTS.backup_scheduled_cron,
		retentionCount: Number(
			settings.backup_retention_count ?? BACKUP_SETTINGS_DEFAULTS.backup_retention_count
		)
	};
}

export async function updateBackupSettings(input: BackupSettings): Promise<void> {
	const updates: Array<{ key: string; value: string }> = [
		{ key: 'backup_scheduled_enabled', value: input.scheduledEnabled ? 'true' : 'false' },
		{ key: 'backup_scheduled_cron', value: input.scheduledCron },
		{ key: 'backup_retention_count', value: String(input.retentionCount) }
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

export interface MaintenanceSettings {
	historyRetentionDaysSearch: number;
	logRetentionDays: number;
	logPersistenceEnabled: boolean;
}

export async function getMaintenanceSettings(): Promise<MaintenanceSettings> {
	const keys = Object.keys(MAINTENANCE_SETTINGS_DEFAULTS) as Array<
		keyof typeof MAINTENANCE_SETTINGS_DEFAULTS
	>;
	const settings = await getSettings(keys);

	return {
		historyRetentionDaysSearch: Number(
			settings.history_retention_days_search ??
				MAINTENANCE_SETTINGS_DEFAULTS.history_retention_days_search
		),
		logRetentionDays: Number(
			settings.log_retention_days ?? MAINTENANCE_SETTINGS_DEFAULTS.log_retention_days
		),
		logPersistenceEnabled:
			(settings.log_persistence_enabled ??
				MAINTENANCE_SETTINGS_DEFAULTS.log_persistence_enabled) === 'true'
	};
}

export async function updateMaintenanceSettings(input: MaintenanceSettings): Promise<void> {
	const updates: Array<{ key: string; value: string }> = [
		{ key: 'history_retention_days_search', value: String(input.historyRetentionDaysSearch) },
		{ key: 'log_retention_days', value: String(input.logRetentionDays) },
		{ key: 'log_persistence_enabled', value: input.logPersistenceEnabled ? 'true' : 'false' }
	];

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
