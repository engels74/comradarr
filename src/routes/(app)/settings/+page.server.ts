/**
 * Unified settings page server load and actions.
 * Consolidates general, search, security, api-keys, backup, throttle, and notifications settings.
 */

import { fail } from '@sveltejs/kit';
import * as v from 'valibot';
import {
	BaseChannelSchema,
	DiscordConfigSchema,
	EmailConfigSchema,
	getSensitiveFields,
	isImplementedChannelType,
	SlackConfigSchema,
	TelegramConfigSchema,
	WebhookConfigSchema
} from '$lib/schemas/notification-channel';
import { SEARCH_SETTINGS_DEFAULTS, SearchSettingsSchema } from '$lib/schemas/search-settings';
// Schemas
import {
	type ApiKeyRateLimitPreset,
	AuthModeSchema,
	BackupSettingsSchema,
	CreateApiKeySchema,
	GeneralSettingsSchema,
	type LogLevel,
	PasswordChangeSchema,
	parseRateLimitValue,
	UpdateApiKeyRateLimitSchema
} from '$lib/schemas/settings';
import { ThrottleProfileSchema } from '$lib/schemas/throttle-profile';

// Auth
import { hashPassword, verifyPassword } from '$lib/server/auth';
import {
	type ApiKeyScope,
	apiKeyNameExists,
	createApiKey,
	deleteApiKey,
	getApiKeysByUser,
	revokeApiKey,
	updateApiKeyRateLimit
} from '$lib/server/db/queries/api-keys';
// Queries
import {
	deleteOtherUserSessions,
	deleteUserSession,
	getUserById,
	getUserSessions
} from '$lib/server/db/queries/auth';
import {
	createNotificationChannel,
	deleteNotificationChannel,
	getAllNotificationChannels,
	getDecryptedSensitiveConfig,
	getNotificationChannel,
	getNotificationChannelStats,
	type NotificationChannelStats,
	type NotificationChannelType,
	type NotificationEventType,
	notificationChannelNameExists,
	updateNotificationChannel
} from '$lib/server/db/queries/notifications';
import {
	getBackupSettings,
	getGeneralSettings,
	getMaintenanceSettings,
	getSearchSettings,
	getSecuritySettings,
	updateBackupSettings,
	updateGeneralSettings,
	updateMaintenanceSettings,
	updateSearchSettings,
	updateSecuritySettings
} from '$lib/server/db/queries/settings';
import {
	createThrottleProfile,
	deleteThrottleProfile,
	getAllThrottleProfiles,
	getConnectorCountUsingProfile,
	setDefaultThrottleProfile,
	throttleProfileNameExists,
	updateThrottleProfile
} from '$lib/server/db/queries/throttle';
import type { NotificationChannel } from '$lib/server/db/schema';
// Logger
import { createLogger, setLogLevel } from '$lib/server/logger';
// Services
import { getSchedulerStatus, refreshScheduledBackup } from '$lib/server/scheduler';
import { deleteBackup, listBackups } from '$lib/server/services/backup';
import { getSender, isSupportedChannelType } from '$lib/server/services/notifications';
import { invalidateSearchConfigCache } from '$lib/server/services/queue/config';

import type { Actions, PageServerLoad } from './$types';

const logger = createLogger('settings');

/**
 * Profile with connector usage count for display.
 */
export interface ProfileWithUsage {
	id: number;
	name: string;
	description: string | null;
	requestsPerMinute: number;
	dailyBudget: number | null;
	batchSize: number;
	batchCooldownSeconds: number;
	rateLimitPauseSeconds: number;
	isDefault: boolean;
	createdAt: Date;
	updatedAt: Date;
	connectorCount: number;
}

/**
 * Channel with statistics for display.
 */
export interface ChannelWithStats extends NotificationChannel {
	stats: NotificationChannelStats;
}

// =============================================================================
// Load Function
// =============================================================================

export const load: PageServerLoad = async ({ locals }) => {
	const [
		general,
		search,
		security,
		backupSettings,
		backupSchedulerStatus,
		throttleProfiles,
		maintenance,
		channels
	] = await Promise.all([
		getGeneralSettings(),
		getSearchSettings(),
		getSecuritySettings(),
		getBackupSettings(),
		Promise.resolve(getSchedulerStatus()),
		getAllThrottleProfiles(),
		getMaintenanceSettings(),
		getAllNotificationChannels()
	]);

	// Get sessions only for authenticated users (not bypass)
	let sessions: Awaited<ReturnType<typeof getUserSessions>> = [];
	if (locals.user && !locals.isLocalBypass && locals.sessionId) {
		sessions = await getUserSessions(locals.user.id, locals.sessionId);
	}

	// Get API keys only for authenticated users (not bypass)
	const apiKeys =
		locals.isLocalBypass || locals.user?.id === 0 ? [] : await getApiKeysByUser(locals.user!.id);

	// Get backups
	const backups = await listBackups();

	// Get throttle profiles with usage counts
	const profilesWithUsage: ProfileWithUsage[] = await Promise.all(
		throttleProfiles.map(async (profile) => ({
			...profile,
			connectorCount: await getConnectorCountUsingProfile(profile.id)
		}))
	);

	// Get notification channels with stats
	const channelsWithStats: ChannelWithStats[] = await Promise.all(
		channels.map(async (channel) => ({
			...channel,
			stats: await getNotificationChannelStats(channel.id)
		}))
	);

	return {
		general,
		search,
		security: {
			settings: security,
			sessions,
			currentSessionId: locals.sessionId ?? null,
			isLocalBypass: locals.isLocalBypass ?? false
		},
		apiKeys: {
			keys: apiKeys,
			isLocalBypass: locals.isLocalBypass ?? false
		},
		backup: {
			settings: backupSettings,
			backups: backups.map((backup) => ({
				id: backup.id,
				createdAt: backup.metadata.createdAt,
				description: backup.metadata.description,
				type: backup.metadata.type,
				tableCount: backup.metadata.tableCount,
				fileSizeBytes: backup.fileSizeBytes,
				schemaVersion: backup.metadata.schemaVersion
			})),
			nextBackupRun: backupSchedulerStatus.scheduledBackup?.nextRun?.toISOString() ?? null
		},
		throttle: {
			profiles: profilesWithUsage
		},
		maintenance,
		notifications: {
			channels: channelsWithStats
		}
	};
};

// =============================================================================
// Helper Functions
// =============================================================================

function calculateExpiration(expiresIn: string | undefined): Date | null {
	if (!expiresIn || expiresIn === 'never') return null;

	const now = new Date();
	switch (expiresIn) {
		case '30d':
			return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
		case '90d':
			return new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
		case '365d':
			return new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
		default:
			return null;
	}
}

function parseThrottleFormData(formData: FormData) {
	const dailyBudgetStr = formData.get('dailyBudget')?.toString();
	const dailyBudget =
		dailyBudgetStr === '' || dailyBudgetStr === undefined || dailyBudgetStr === null
			? null
			: Number(dailyBudgetStr);

	return {
		name: formData.get('name')?.toString() ?? '',
		description: formData.get('description')?.toString() || undefined,
		requestsPerMinute: Number(formData.get('requestsPerMinute')),
		dailyBudget,
		batchSize: Number(formData.get('batchSize')),
		batchCooldownSeconds: Number(formData.get('batchCooldownSeconds')),
		rateLimitPauseSeconds: Number(formData.get('rateLimitPauseSeconds')),
		isDefault: formData.get('isDefault') === 'on'
	};
}

function parseNotificationBaseFields(formData: FormData) {
	const batchingWindowStr = formData.get('batchingWindowSeconds')?.toString();
	const enabledField = formData.get('enabled');

	return {
		name: formData.get('name')?.toString() ?? '',
		enabled: enabledField === null ? undefined : enabledField !== 'false',
		enabledEvents: formData.getAll('enabledEvents').map((v) => v.toString()),
		batchingEnabled: formData.get('batchingEnabled') === 'on',
		batchingWindowSeconds: batchingWindowStr ? Number(batchingWindowStr) : 60,
		quietHoursEnabled: formData.get('quietHoursEnabled') === 'on',
		quietHoursStart: formData.get('quietHoursStart')?.toString() || undefined,
		quietHoursEnd: formData.get('quietHoursEnd')?.toString() || undefined,
		quietHoursTimezone: formData.get('quietHoursTimezone')?.toString() || 'UTC'
	};
}

function parseDiscordFields(formData: FormData) {
	return {
		webhookUrl: formData.get('webhookUrl')?.toString() ?? '',
		username: formData.get('username')?.toString() || undefined,
		avatarUrl: formData.get('avatarUrl')?.toString() || undefined
	};
}

function parseTelegramFields(formData: FormData) {
	return {
		botToken: formData.get('botToken')?.toString() ?? '',
		chatId: formData.get('chatId')?.toString() ?? '',
		parseMode:
			(formData.get('parseMode')?.toString() as 'HTML' | 'Markdown' | 'MarkdownV2') || 'HTML',
		disableWebPagePreview: formData.get('disableWebPagePreview') === 'on',
		disableNotification: formData.get('disableNotification') === 'on'
	};
}

function parseSlackFields(formData: FormData) {
	return {
		webhookUrl: formData.get('webhookUrl')?.toString() ?? '',
		channel: formData.get('channel')?.toString() || undefined,
		username: formData.get('username')?.toString() || undefined,
		iconEmoji: formData.get('iconEmoji')?.toString() || undefined
	};
}

function parseEmailFields(formData: FormData) {
	const portStr = formData.get('port')?.toString();

	return {
		host: formData.get('host')?.toString() ?? '',
		port: portStr ? Number(portStr) : 587,
		secure: formData.get('secure') === 'on',
		from: formData.get('from')?.toString() ?? '',
		to: formData.get('to')?.toString() ?? '',
		username: formData.get('username')?.toString() || undefined,
		password: formData.get('password')?.toString() || undefined,
		subjectPrefix: formData.get('subjectPrefix')?.toString() || undefined
	};
}

function parseWebhookFields(formData: FormData) {
	return {
		url: formData.get('url')?.toString() ?? '',
		method: (formData.get('method')?.toString() as 'POST' | 'PUT') || 'POST',
		signingSecret: formData.get('signingSecret')?.toString() || undefined,
		contentType: formData.get('contentType')?.toString() || 'application/json',
		includeTimestamp: formData.get('includeTimestamp') !== 'off',
		signatureHeader: formData.get('signatureHeader')?.toString() || 'X-Comradarr-Signature',
		timestampHeader: formData.get('timestampHeader')?.toString() || 'X-Comradarr-Timestamp'
	};
}

function getNotificationConfigSchema(type: string) {
	switch (type) {
		case 'discord':
			return DiscordConfigSchema;
		case 'telegram':
			return TelegramConfigSchema;
		case 'slack':
			return SlackConfigSchema;
		case 'email':
			return EmailConfigSchema;
		case 'webhook':
			return WebhookConfigSchema;
		default:
			return null;
	}
}

function parseNotificationChannelFields(formData: FormData, type: string) {
	switch (type) {
		case 'discord':
			return parseDiscordFields(formData);
		case 'telegram':
			return parseTelegramFields(formData);
		case 'slack':
			return parseSlackFields(formData);
		case 'email':
			return parseEmailFields(formData);
		case 'webhook':
			return parseWebhookFields(formData);
		default:
			return {};
	}
}

function splitNotificationConfig(
	type: string,
	fields: Record<string, unknown>
): { config: Record<string, unknown>; sensitiveConfig: Record<string, unknown> } {
	const sensitive = getSensitiveFields(type);
	const config: Record<string, unknown> = {};
	const sensitiveConfig: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(fields)) {
		if (value === undefined || value === '') continue;

		if (sensitive.includes(key)) {
			sensitiveConfig[key] = value;
		} else {
			config[key] = value;
		}
	}

	return { config, sensitiveConfig };
}

function isValidTimezone(timezone: string): boolean {
	try {
		Intl.DateTimeFormat(undefined, { timeZone: timezone });
		return true;
	} catch {
		return false;
	}
}

// =============================================================================
// Actions
// =============================================================================

export const actions: Actions = {
	// =========================================================================
	// General Settings Actions
	// =========================================================================
	generalUpdate: async ({ request }) => {
		const formData = await request.formData();

		const data = {
			appName: formData.get('appName'),
			timezone: formData.get('timezone'),
			logLevel: formData.get('logLevel'),
			checkForUpdates: formData.get('checkForUpdates') === 'on'
		};

		const formValues = {
			appName: data.appName?.toString() ?? '',
			timezone: data.timezone?.toString() ?? '',
			logLevel: data.logLevel?.toString() ?? '',
			checkForUpdates: data.checkForUpdates
		};

		const result = v.safeParse(GeneralSettingsSchema, data);
		if (!result.success) {
			const errors = result.issues.map((issue) => issue.message);
			return fail(400, {
				action: 'generalUpdate',
				error: errors[0] ?? 'Invalid input',
				...formValues
			});
		}

		const config = result.output;

		try {
			Intl.DateTimeFormat(undefined, { timeZone: config.timezone });
		} catch {
			return fail(400, {
				action: 'generalUpdate',
				error: 'Invalid timezone selected',
				...formValues
			});
		}

		try {
			await updateGeneralSettings({
				appName: config.appName,
				timezone: config.timezone,
				logLevel: config.logLevel,
				checkForUpdates: config.checkForUpdates
			});

			setLogLevel(config.logLevel as LogLevel);
		} catch (err) {
			logger.error('Failed to update general settings', {
				error: err instanceof Error ? err.message : String(err)
			});
			return fail(500, {
				action: 'generalUpdate',
				error: 'Failed to update settings. Please try again.',
				...formValues
			});
		}

		return {
			action: 'generalUpdate',
			success: true,
			message: 'Settings saved successfully',
			...formValues
		};
	},

	// =========================================================================
	// Search/Discovery Settings Actions
	// =========================================================================
	searchUpdate: async ({ request }) => {
		const formData = await request.formData();
		const currentSettings = await getSearchSettings();

		const data = {
			priorityWeights: {
				contentAge: Number(formData.get('contentAge')),
				missingDuration: Number(formData.get('missingDuration')),
				userPriority: Number(formData.get('userPriority')),
				failurePenalty: Number(formData.get('failurePenalty')),
				gapBonus: Number(formData.get('gapBonus'))
			},
			seasonPackThresholds: {
				minMissingPercent: Number(formData.get('minMissingPercent')),
				minMissingCount: Number(formData.get('minMissingCount'))
			},
			cooldownConfig: {
				baseDelayHours: Number(formData.get('baseDelayHours')),
				maxDelayHours: Number(formData.get('maxDelayHours')),
				multiplier: Number(formData.get('multiplier')),
				jitter: formData.get('jitter') === 'on'
			},
			retryConfig: {
				maxAttempts: Number(formData.get('maxAttempts'))
			},
			backlogConfig: currentSettings.backlogConfig
		};

		const result = v.safeParse(SearchSettingsSchema, data);
		if (!result.success) {
			const errors = result.issues.map((issue) => issue.message);
			return fail(400, {
				action: 'searchUpdate',
				error: errors[0] ?? 'Invalid input',
				values: data
			});
		}

		if (data.cooldownConfig.maxDelayHours < data.cooldownConfig.baseDelayHours) {
			return fail(400, {
				action: 'searchUpdate',
				error: 'Maximum delay must be greater than or equal to base delay',
				values: data
			});
		}

		try {
			await updateSearchSettings(result.output);
			invalidateSearchConfigCache();
		} catch (err) {
			logger.error('Failed to update search settings', {
				error: err instanceof Error ? err.message : String(err)
			});
			return fail(500, {
				action: 'searchUpdate',
				error: 'Failed to update settings. Please try again.',
				values: data
			});
		}

		return {
			action: 'searchUpdate',
			success: true,
			message: 'Search behavior settings saved successfully'
		};
	},

	searchReset: async () => {
		try {
			await updateSearchSettings(SEARCH_SETTINGS_DEFAULTS);
			invalidateSearchConfigCache();
		} catch (err) {
			logger.error('Failed to reset search settings', {
				error: err instanceof Error ? err.message : String(err)
			});
			return fail(500, {
				action: 'searchReset',
				error: 'Failed to reset settings. Please try again.'
			});
		}

		return {
			action: 'searchReset',
			success: true,
			message: 'Search behavior settings reset to defaults'
		};
	},

	// =========================================================================
	// Security Settings Actions
	// =========================================================================
	securityUpdateAuthMode: async ({ request }) => {
		const formData = await request.formData();

		const data = {
			authMode: formData.get('authMode')
		};

		const formValues = {
			authMode: data.authMode?.toString() ?? ''
		};

		const result = v.safeParse(AuthModeSchema, data);
		if (!result.success) {
			const errors = result.issues.map((issue) => issue.message);
			return fail(400, {
				action: 'securityUpdateAuthMode',
				error: errors[0] ?? 'Invalid input',
				...formValues
			});
		}

		const config = result.output;

		try {
			await updateSecuritySettings({ authMode: config.authMode });
		} catch (err) {
			logger.error('Failed to update auth mode', {
				error: err instanceof Error ? err.message : String(err)
			});
			return fail(500, {
				action: 'securityUpdateAuthMode',
				error: 'Failed to update authentication mode. Please try again.',
				...formValues
			});
		}

		return {
			action: 'securityUpdateAuthMode',
			success: true,
			message: 'Authentication mode updated successfully',
			...formValues
		};
	},

	securityChangePassword: async ({ request, locals }) => {
		if (locals.isLocalBypass || !locals.user || locals.user.id === 0) {
			return fail(403, {
				action: 'securityChangePassword',
				error: 'Cannot change password in local network bypass mode'
			});
		}

		const formData = await request.formData();

		const data = {
			currentPassword: formData.get('currentPassword')?.toString() ?? '',
			newPassword: formData.get('newPassword')?.toString() ?? '',
			confirmPassword: formData.get('confirmPassword')?.toString() ?? ''
		};

		const result = v.safeParse(PasswordChangeSchema, data);
		if (!result.success) {
			const errors = result.issues.map((issue) => issue.message);
			return fail(400, {
				action: 'securityChangePassword',
				error: errors[0] ?? 'Invalid input'
			});
		}

		const config = result.output;

		const user = await getUserById(locals.user.id);
		if (!user) {
			return fail(400, {
				action: 'securityChangePassword',
				error: 'User not found'
			});
		}

		const passwordValid = await verifyPassword(user.passwordHash, config.currentPassword);
		if (!passwordValid) {
			return fail(400, {
				action: 'securityChangePassword',
				error: 'Current password is incorrect'
			});
		}

		try {
			const { updateUserPassword } = await import('$lib/server/db/queries/auth');
			const newPasswordHash = await hashPassword(config.newPassword);
			await updateUserPassword(locals.user.id, newPasswordHash);
		} catch (err) {
			logger.error('Failed to update password', {
				error: err instanceof Error ? err.message : String(err)
			});
			return fail(500, {
				action: 'securityChangePassword',
				error: 'Failed to update password. Please try again.'
			});
		}

		return {
			action: 'securityChangePassword',
			success: true,
			message: 'Password changed successfully'
		};
	},

	securityRevokeSession: async ({ request, locals }) => {
		if (locals.isLocalBypass || !locals.user || locals.user.id === 0) {
			return fail(403, {
				action: 'securityRevokeSession',
				error: 'Cannot manage sessions in local network bypass mode'
			});
		}

		const formData = await request.formData();
		const sessionId = formData.get('sessionId')?.toString();

		if (!sessionId) {
			return fail(400, {
				action: 'securityRevokeSession',
				error: 'Session ID is required'
			});
		}

		if (sessionId === locals.sessionId) {
			return fail(400, {
				action: 'securityRevokeSession',
				error: 'Cannot revoke your current session. Use logout instead.'
			});
		}

		try {
			const deleted = await deleteUserSession(locals.user.id, sessionId);
			if (!deleted) {
				return fail(404, {
					action: 'securityRevokeSession',
					error: 'Session not found'
				});
			}
		} catch (err) {
			logger.error('Failed to revoke session', {
				error: err instanceof Error ? err.message : String(err)
			});
			return fail(500, {
				action: 'securityRevokeSession',
				error: 'Failed to revoke session. Please try again.'
			});
		}

		return {
			action: 'securityRevokeSession',
			success: true,
			message: 'Session revoked successfully'
		};
	},

	securityRevokeAllSessions: async ({ locals }) => {
		if (locals.isLocalBypass || !locals.user || locals.user.id === 0 || !locals.sessionId) {
			return fail(403, {
				action: 'securityRevokeAllSessions',
				error: 'Cannot manage sessions in local network bypass mode'
			});
		}

		try {
			const count = await deleteOtherUserSessions(locals.user.id, locals.sessionId);
			return {
				action: 'securityRevokeAllSessions',
				success: true,
				message:
					count > 0
						? `Revoked ${count} session${count === 1 ? '' : 's'}`
						: 'No other sessions to revoke'
			};
		} catch (err) {
			logger.error('Failed to revoke all sessions', {
				error: err instanceof Error ? err.message : String(err)
			});
			return fail(500, {
				action: 'securityRevokeAllSessions',
				error: 'Failed to revoke sessions. Please try again.'
			});
		}
	},

	// =========================================================================
	// API Keys Actions
	// =========================================================================
	apiKeysCreate: async ({ request, locals }) => {
		if (locals.isLocalBypass || !locals.user || locals.user.id === 0) {
			return fail(403, {
				action: 'apiKeysCreate',
				error: 'Cannot create API keys in local network bypass mode'
			});
		}

		const formData = await request.formData();
		const rateLimitCustomStr = formData.get('rateLimitCustom')?.toString();
		const rateLimitCustom = rateLimitCustomStr ? parseInt(rateLimitCustomStr, 10) : undefined;

		const data = {
			name: formData.get('name')?.toString() ?? '',
			description: formData.get('description')?.toString() || undefined,
			scope: formData.get('scope')?.toString() ?? 'read',
			expiresIn: formData.get('expiresIn')?.toString() || undefined,
			rateLimitPreset: formData.get('rateLimitPreset')?.toString() || undefined,
			rateLimitCustom:
				rateLimitCustom && !Number.isNaN(rateLimitCustom) ? rateLimitCustom : undefined
		};

		const result = v.safeParse(CreateApiKeySchema, data);
		if (!result.success) {
			const errors = result.issues.map((issue) => issue.message);
			return fail(400, {
				action: 'apiKeysCreate',
				error: errors[0] ?? 'Invalid input'
			});
		}

		const config = result.output;
		const nameExists = await apiKeyNameExists(locals.user.id, config.name);
		if (nameExists) {
			return fail(400, {
				action: 'apiKeysCreate',
				error: 'An API key with this name already exists'
			});
		}

		try {
			const expiresAt = calculateExpiration(config.expiresIn);
			const rateLimitPerMinute = parseRateLimitValue(
				config.rateLimitPreset as ApiKeyRateLimitPreset | undefined,
				config.rateLimitCustom
			);

			const created = await createApiKey({
				userId: locals.user.id,
				name: config.name,
				description: config.description ?? null,
				scope: config.scope as ApiKeyScope,
				rateLimitPerMinute,
				expiresAt
			});

			return {
				action: 'apiKeysCreate',
				success: true,
				message: 'API key created successfully',
				plainKey: created.plainKey
			};
		} catch (err) {
			logger.error('Failed to create API key', {
				error: err instanceof Error ? err.message : String(err)
			});
			return fail(500, {
				action: 'apiKeysCreate',
				error: 'Failed to create API key. Please try again.'
			});
		}
	},

	apiKeysDelete: async ({ request, locals }) => {
		if (locals.isLocalBypass || !locals.user || locals.user.id === 0) {
			return fail(403, {
				action: 'apiKeysDelete',
				error: 'Cannot manage API keys in local network bypass mode'
			});
		}

		const formData = await request.formData();
		const keyId = parseInt(formData.get('keyId')?.toString() ?? '', 10);

		if (Number.isNaN(keyId)) {
			return fail(400, {
				action: 'apiKeysDelete',
				error: 'Invalid key ID'
			});
		}

		try {
			const deleted = await deleteApiKey(keyId, locals.user.id);
			if (!deleted) {
				return fail(404, {
					action: 'apiKeysDelete',
					error: 'API key not found'
				});
			}
		} catch (err) {
			logger.error('Failed to delete API key', {
				error: err instanceof Error ? err.message : String(err)
			});
			return fail(500, {
				action: 'apiKeysDelete',
				error: 'Failed to delete API key. Please try again.'
			});
		}

		return {
			action: 'apiKeysDelete',
			success: true,
			message: 'API key deleted successfully'
		};
	},

	apiKeysUpdateRateLimit: async ({ request, locals }) => {
		if (locals.isLocalBypass || !locals.user || locals.user.id === 0) {
			return fail(403, {
				action: 'apiKeysUpdateRateLimit',
				error: 'Cannot manage API keys in local network bypass mode'
			});
		}

		const formData = await request.formData();
		const keyId = parseInt(formData.get('keyId')?.toString() ?? '', 10);

		if (Number.isNaN(keyId)) {
			return fail(400, {
				action: 'apiKeysUpdateRateLimit',
				error: 'Invalid key ID'
			});
		}

		const rateLimitCustomStr = formData.get('rateLimitCustom')?.toString();
		const rateLimitCustom = rateLimitCustomStr ? parseInt(rateLimitCustomStr, 10) : undefined;

		const data = {
			rateLimitPreset: formData.get('rateLimitPreset')?.toString() ?? 'unlimited',
			rateLimitCustom:
				rateLimitCustom && !Number.isNaN(rateLimitCustom) ? rateLimitCustom : undefined
		};

		const result = v.safeParse(UpdateApiKeyRateLimitSchema, data);
		if (!result.success) {
			const errors = result.issues.map((issue) => issue.message);
			return fail(400, {
				action: 'apiKeysUpdateRateLimit',
				error: errors[0] ?? 'Invalid input'
			});
		}

		const config = result.output;

		try {
			const rateLimitPerMinute = parseRateLimitValue(
				config.rateLimitPreset as ApiKeyRateLimitPreset,
				config.rateLimitCustom
			);

			const updated = await updateApiKeyRateLimit(keyId, locals.user.id, rateLimitPerMinute);
			if (!updated) {
				return fail(404, {
					action: 'apiKeysUpdateRateLimit',
					error: 'API key not found'
				});
			}
		} catch (err) {
			logger.error('Failed to update API key rate limit', {
				error: err instanceof Error ? err.message : String(err)
			});
			return fail(500, {
				action: 'apiKeysUpdateRateLimit',
				error: 'Failed to update rate limit. Please try again.'
			});
		}

		return {
			action: 'apiKeysUpdateRateLimit',
			success: true,
			message: 'Rate limit updated successfully'
		};
	},

	apiKeysRevoke: async ({ request, locals }) => {
		if (locals.isLocalBypass || !locals.user || locals.user.id === 0) {
			return fail(403, {
				action: 'apiKeysRevoke',
				error: 'Cannot manage API keys in local network bypass mode'
			});
		}

		const formData = await request.formData();
		const keyId = parseInt(formData.get('keyId')?.toString() ?? '', 10);

		if (Number.isNaN(keyId)) {
			return fail(400, {
				action: 'apiKeysRevoke',
				error: 'Invalid key ID'
			});
		}

		try {
			const revoked = await revokeApiKey(keyId, locals.user.id);
			if (!revoked) {
				return fail(404, {
					action: 'apiKeysRevoke',
					error: 'API key not found or already revoked'
				});
			}
		} catch (err) {
			logger.error('Failed to revoke API key', {
				error: err instanceof Error ? err.message : String(err)
			});
			return fail(500, {
				action: 'apiKeysRevoke',
				error: 'Failed to revoke API key. Please try again.'
			});
		}

		return {
			action: 'apiKeysRevoke',
			success: true,
			message: 'API key revoked successfully'
		};
	},

	// =========================================================================
	// Backup Settings Actions
	// =========================================================================
	backupUpdate: async ({ request }) => {
		const formData = await request.formData();

		const data = {
			scheduledEnabled: formData.get('scheduledEnabled') === 'on',
			scheduledCron: formData.get('scheduledCron'),
			retentionCount: Number(formData.get('retentionCount'))
		};

		const formValues = {
			scheduledEnabled: data.scheduledEnabled,
			scheduledCron: data.scheduledCron?.toString() ?? '',
			retentionCount: data.retentionCount
		};

		const result = v.safeParse(BackupSettingsSchema, data);
		if (!result.success) {
			const errors = result.issues.map((issue) => issue.message);
			return fail(400, {
				action: 'backupUpdate',
				error: errors[0] ?? 'Invalid input',
				...formValues
			});
		}

		const config = result.output;

		try {
			await updateBackupSettings({
				scheduledEnabled: config.scheduledEnabled,
				scheduledCron: config.scheduledCron,
				retentionCount: config.retentionCount
			});

			await refreshScheduledBackup();
		} catch (err) {
			logger.error('Failed to update backup settings', {
				error: err instanceof Error ? err.message : String(err)
			});
			return fail(500, {
				action: 'backupUpdate',
				error: 'Failed to update settings. Please try again.',
				...formValues
			});
		}

		return {
			action: 'backupUpdate',
			success: true,
			message: 'Backup settings saved successfully',
			...formValues
		};
	},

	backupDelete: async ({ request }) => {
		const formData = await request.formData();
		const backupId = formData.get('backupId')?.toString();

		if (!backupId) {
			return fail(400, {
				action: 'backupDelete',
				error: 'Backup ID is required'
			});
		}

		try {
			const deleted = await deleteBackup(backupId);
			if (!deleted) {
				return fail(404, {
					action: 'backupDelete',
					error: 'Backup not found'
				});
			}
		} catch (err) {
			logger.error('Failed to delete backup', {
				error: err instanceof Error ? err.message : String(err)
			});
			return fail(500, {
				action: 'backupDelete',
				error: 'Failed to delete backup. Please try again.'
			});
		}

		return {
			action: 'backupDelete',
			success: true,
			message: 'Backup deleted successfully'
		};
	},

	// =========================================================================
	// Throttle Profile Actions
	// =========================================================================
	throttleCreate: async ({ request }) => {
		const formData = await request.formData();
		const data = parseThrottleFormData(formData);

		const result = v.safeParse(ThrottleProfileSchema, data);
		if (!result.success) {
			const errors = result.issues.map((issue) => issue.message);
			return fail(400, {
				action: 'throttleCreate',
				error: errors[0] ?? 'Invalid input',
				values: data
			});
		}

		const config = result.output;

		const nameExists = await throttleProfileNameExists(config.name);
		if (nameExists) {
			return fail(400, {
				action: 'throttleCreate',
				error: 'A profile with this name already exists',
				values: data
			});
		}

		try {
			await createThrottleProfile({
				name: config.name,
				...(config.description !== undefined && { description: config.description }),
				requestsPerMinute: config.requestsPerMinute,
				dailyBudget: config.dailyBudget ?? null,
				batchSize: config.batchSize,
				batchCooldownSeconds: config.batchCooldownSeconds,
				rateLimitPauseSeconds: config.rateLimitPauseSeconds,
				isDefault: config.isDefault ?? false
			});
		} catch (err) {
			logger.error('Failed to create throttle profile', {
				error: err instanceof Error ? err.message : String(err)
			});
			return fail(500, {
				action: 'throttleCreate',
				error: 'Failed to create profile. Please try again.',
				values: data
			});
		}

		return {
			action: 'throttleCreate',
			success: true,
			message: 'Profile created successfully'
		};
	},

	throttleUpdate: async ({ request }) => {
		const formData = await request.formData();
		const id = Number(formData.get('id'));

		if (!id || Number.isNaN(id)) {
			return fail(400, {
				action: 'throttleUpdate',
				error: 'Invalid profile ID'
			});
		}

		const data = parseThrottleFormData(formData);

		const result = v.safeParse(ThrottleProfileSchema, data);
		if (!result.success) {
			const errors = result.issues.map((issue) => issue.message);
			return fail(400, {
				action: 'throttleUpdate',
				error: errors[0] ?? 'Invalid input',
				values: { ...data, id }
			});
		}

		const config = result.output;

		const nameExists = await throttleProfileNameExists(config.name, id);
		if (nameExists) {
			return fail(400, {
				action: 'throttleUpdate',
				error: 'A profile with this name already exists',
				values: { ...data, id }
			});
		}

		try {
			const updated = await updateThrottleProfile(id, {
				name: config.name,
				...(config.description !== undefined && { description: config.description }),
				requestsPerMinute: config.requestsPerMinute,
				dailyBudget: config.dailyBudget ?? null,
				batchSize: config.batchSize,
				batchCooldownSeconds: config.batchCooldownSeconds,
				rateLimitPauseSeconds: config.rateLimitPauseSeconds,
				isDefault: config.isDefault ?? false
			});

			if (!updated) {
				return fail(404, {
					action: 'throttleUpdate',
					error: 'Profile not found'
				});
			}
		} catch (err) {
			logger.error('Failed to update throttle profile', {
				error: err instanceof Error ? err.message : String(err)
			});
			return fail(500, {
				action: 'throttleUpdate',
				error: 'Failed to update profile. Please try again.',
				values: { ...data, id }
			});
		}

		return {
			action: 'throttleUpdate',
			success: true,
			message: 'Profile updated successfully'
		};
	},

	throttleDelete: async ({ request }) => {
		const formData = await request.formData();
		const id = Number(formData.get('id'));

		if (!id || Number.isNaN(id)) {
			return fail(400, {
				action: 'throttleDelete',
				error: 'Invalid profile ID'
			});
		}

		try {
			const deleted = await deleteThrottleProfile(id);
			if (!deleted) {
				return fail(404, {
					action: 'throttleDelete',
					error: 'Profile not found'
				});
			}
		} catch (err) {
			if (err instanceof Error && err.message.includes('assigned to')) {
				return fail(400, {
					action: 'throttleDelete',
					error: err.message
				});
			}
			logger.error('Failed to delete throttle profile', {
				error: err instanceof Error ? err.message : String(err)
			});
			return fail(500, {
				action: 'throttleDelete',
				error: 'Failed to delete profile. Please try again.'
			});
		}

		return {
			action: 'throttleDelete',
			success: true,
			message: 'Profile deleted successfully'
		};
	},

	throttleSetDefault: async ({ request }) => {
		const formData = await request.formData();
		const id = Number(formData.get('id'));

		if (!id || Number.isNaN(id)) {
			return fail(400, {
				action: 'throttleSetDefault',
				error: 'Invalid profile ID'
			});
		}

		try {
			const updated = await setDefaultThrottleProfile(id);
			if (!updated) {
				return fail(404, {
					action: 'throttleSetDefault',
					error: 'Profile not found'
				});
			}
		} catch (err) {
			logger.error('Failed to set default throttle profile', {
				error: err instanceof Error ? err.message : String(err)
			});
			return fail(500, {
				action: 'throttleSetDefault',
				error: 'Failed to set default profile. Please try again.'
			});
		}

		return {
			action: 'throttleSetDefault',
			success: true,
			message: 'Default profile updated successfully'
		};
	},

	// =========================================================================
	// Maintenance Settings Actions
	// =========================================================================
	maintenanceUpdate: async ({ request }) => {
		const formData = await request.formData();

		const data = {
			historyRetentionDaysSearch: Number(formData.get('historyRetentionDaysSearch')),
			logRetentionDays: Number(formData.get('logRetentionDays')),
			logPersistenceEnabled: formData.get('logPersistenceEnabled') === 'on'
		};

		if (
			Number.isNaN(data.historyRetentionDaysSearch) ||
			data.historyRetentionDaysSearch < 1 ||
			data.historyRetentionDaysSearch > 365
		) {
			return fail(400, {
				action: 'maintenanceUpdate',
				error: 'Search history retention must be between 1 and 365 days',
				values: data
			});
		}

		if (
			Number.isNaN(data.logRetentionDays) ||
			data.logRetentionDays < 1 ||
			data.logRetentionDays > 365
		) {
			return fail(400, {
				action: 'maintenanceUpdate',
				error: 'Log retention must be between 1 and 365 days',
				values: data
			});
		}

		try {
			await updateMaintenanceSettings(data);
		} catch (err) {
			logger.error('Failed to update maintenance settings', {
				error: err instanceof Error ? err.message : String(err)
			});
			return fail(500, {
				action: 'maintenanceUpdate',
				error: 'Failed to update settings. Please try again.',
				values: data
			});
		}

		return {
			action: 'maintenanceUpdate',
			success: true,
			message: 'Maintenance settings saved successfully',
			values: data
		};
	},

	// =========================================================================
	// Notification Channel Actions
	// =========================================================================
	notificationsCreate: async ({ request }) => {
		const formData = await request.formData();
		const type = formData.get('type')?.toString();

		if (!type) {
			return fail(400, {
				action: 'notificationsCreate',
				error: 'Channel type is required'
			});
		}

		if (!isImplementedChannelType(type)) {
			return fail(400, {
				action: 'notificationsCreate',
				error: `Channel type "${type}" is not yet supported`
			});
		}

		const baseData = parseNotificationBaseFields(formData);
		const channelData = parseNotificationChannelFields(formData, type);

		const baseResult = v.safeParse(BaseChannelSchema, baseData);
		if (!baseResult.success) {
			const errors = baseResult.issues.map((issue) => issue.message);
			return fail(400, {
				action: 'notificationsCreate',
				error: errors[0] ?? 'Invalid input',
				values: { type, ...baseData, ...channelData }
			});
		}

		const configSchema = getNotificationConfigSchema(type);
		if (configSchema) {
			const configResult = v.safeParse(configSchema, channelData);
			if (!configResult.success) {
				const errors = configResult.issues.map((issue) => issue.message);
				return fail(400, {
					action: 'notificationsCreate',
					error: errors[0] ?? 'Invalid input',
					values: { type, ...baseData, ...channelData }
				});
			}
		}

		if (baseData.quietHoursEnabled) {
			if (!baseData.quietHoursStart || !baseData.quietHoursEnd) {
				return fail(400, {
					action: 'notificationsCreate',
					error: 'Both start and end time are required when quiet hours are enabled',
					values: { type, ...baseData, ...channelData }
				});
			}
			if (baseData.quietHoursTimezone && !isValidTimezone(baseData.quietHoursTimezone)) {
				return fail(400, {
					action: 'notificationsCreate',
					error: 'Invalid timezone',
					values: { type, ...baseData, ...channelData }
				});
			}
		}

		const nameExists = await notificationChannelNameExists(baseData.name);
		if (nameExists) {
			return fail(400, {
				action: 'notificationsCreate',
				error: 'A channel with this name already exists',
				values: { type, ...baseData, ...channelData }
			});
		}

		const { config, sensitiveConfig } = splitNotificationConfig(type, channelData);

		const channelInput: Parameters<typeof createNotificationChannel>[0] = {
			name: baseData.name,
			type: type as NotificationChannelType,
			config,
			sensitiveConfig,
			enabled: baseData.enabled ?? true,
			enabledEvents: baseData.enabledEvents as NotificationEventType[],
			batchingEnabled: baseData.batchingEnabled,
			batchingWindowSeconds: baseData.batchingWindowSeconds,
			quietHoursEnabled: baseData.quietHoursEnabled,
			quietHoursTimezone: baseData.quietHoursTimezone
		};

		if (baseData.quietHoursStart) {
			channelInput.quietHoursStart = baseData.quietHoursStart;
		}
		if (baseData.quietHoursEnd) {
			channelInput.quietHoursEnd = baseData.quietHoursEnd;
		}

		try {
			await createNotificationChannel(channelInput);
		} catch (err) {
			logger.error('Failed to create notification channel', {
				error: err instanceof Error ? err.message : String(err)
			});
			return fail(500, {
				action: 'notificationsCreate',
				error: 'Failed to create channel. Please try again.',
				values: { type, ...baseData, ...channelData }
			});
		}

		return {
			action: 'notificationsCreate',
			success: true,
			message: 'Notification channel created successfully'
		};
	},

	notificationsUpdate: async ({ request }) => {
		const formData = await request.formData();
		const id = Number(formData.get('id'));
		const type = formData.get('type')?.toString();

		if (!id || Number.isNaN(id)) {
			return fail(400, {
				action: 'notificationsUpdate',
				error: 'Invalid channel ID'
			});
		}

		if (!type) {
			return fail(400, {
				action: 'notificationsUpdate',
				error: 'Channel type is required'
			});
		}

		const baseData = parseNotificationBaseFields(formData);
		const channelData = parseNotificationChannelFields(formData, type);

		const baseResult = v.safeParse(BaseChannelSchema, baseData);
		if (!baseResult.success) {
			const errors = baseResult.issues.map((issue) => issue.message);
			return fail(400, {
				action: 'notificationsUpdate',
				error: errors[0] ?? 'Invalid input',
				values: { id, type, ...baseData, ...channelData }
			});
		}

		const configSchema = getNotificationConfigSchema(type);
		if (configSchema) {
			const sensitiveFieldNames = getSensitiveFields(type);
			const hasSensitiveUpdate = sensitiveFieldNames.some((field) => {
				const value = channelData[field as keyof typeof channelData];
				return value !== undefined && value !== '';
			});

			if (hasSensitiveUpdate) {
				const configResult = v.safeParse(configSchema, channelData);
				if (!configResult.success) {
					const errors = configResult.issues.map((issue) => issue.message);
					return fail(400, {
						action: 'notificationsUpdate',
						error: errors[0] ?? 'Invalid input',
						values: { id, type, ...baseData, ...channelData }
					});
				}
			}
		}

		if (baseData.quietHoursEnabled) {
			if (!baseData.quietHoursStart || !baseData.quietHoursEnd) {
				return fail(400, {
					action: 'notificationsUpdate',
					error: 'Both start and end time are required when quiet hours are enabled',
					values: { id, type, ...baseData, ...channelData }
				});
			}
			if (baseData.quietHoursTimezone && !isValidTimezone(baseData.quietHoursTimezone)) {
				return fail(400, {
					action: 'notificationsUpdate',
					error: 'Invalid timezone',
					values: { id, type, ...baseData, ...channelData }
				});
			}
		}

		const nameExists = await notificationChannelNameExists(baseData.name, id);
		if (nameExists) {
			return fail(400, {
				action: 'notificationsUpdate',
				error: 'A channel with this name already exists',
				values: { id, type, ...baseData, ...channelData }
			});
		}

		const { config, sensitiveConfig } = splitNotificationConfig(type, channelData);

		const updateData: Parameters<typeof updateNotificationChannel>[1] = {
			name: baseData.name,
			enabledEvents: baseData.enabledEvents as NotificationEventType[],
			batchingEnabled: baseData.batchingEnabled,
			batchingWindowSeconds: baseData.batchingWindowSeconds,
			quietHoursEnabled: baseData.quietHoursEnabled,
			quietHoursTimezone: baseData.quietHoursTimezone
		};

		if (baseData.enabled !== undefined) {
			updateData.enabled = baseData.enabled;
		}

		if (baseData.quietHoursStart) {
			updateData.quietHoursStart = baseData.quietHoursStart;
		}
		if (baseData.quietHoursEnd) {
			updateData.quietHoursEnd = baseData.quietHoursEnd;
		}

		if (Object.keys(config).length > 0) {
			updateData.config = config;
		}

		if (Object.keys(sensitiveConfig).length > 0) {
			updateData.sensitiveConfig = sensitiveConfig;
		}

		try {
			const updated = await updateNotificationChannel(id, updateData);
			if (!updated) {
				return fail(404, {
					action: 'notificationsUpdate',
					error: 'Channel not found'
				});
			}
		} catch (err) {
			logger.error('Failed to update notification channel', {
				error: err instanceof Error ? err.message : String(err)
			});
			return fail(500, {
				action: 'notificationsUpdate',
				error: 'Failed to update channel. Please try again.',
				values: { id, type, ...baseData, ...channelData }
			});
		}

		return {
			action: 'notificationsUpdate',
			success: true,
			message: 'Notification channel updated successfully'
		};
	},

	notificationsDelete: async ({ request }) => {
		const formData = await request.formData();
		const id = Number(formData.get('id'));

		if (!id || Number.isNaN(id)) {
			return fail(400, {
				action: 'notificationsDelete',
				error: 'Invalid channel ID'
			});
		}

		try {
			const deleted = await deleteNotificationChannel(id);
			if (!deleted) {
				return fail(404, {
					action: 'notificationsDelete',
					error: 'Channel not found'
				});
			}
		} catch (err) {
			logger.error('Failed to delete notification channel', {
				error: err instanceof Error ? err.message : String(err)
			});
			return fail(500, {
				action: 'notificationsDelete',
				error: 'Failed to delete channel. Please try again.'
			});
		}

		return {
			action: 'notificationsDelete',
			success: true,
			message: 'Notification channel deleted successfully'
		};
	},

	notificationsToggle: async ({ request }) => {
		const formData = await request.formData();
		const id = Number(formData.get('id'));
		const enabled = formData.get('enabled') === 'true';

		if (!id || Number.isNaN(id)) {
			return fail(400, {
				action: 'notificationsToggle',
				error: 'Invalid channel ID'
			});
		}

		try {
			const updated = await updateNotificationChannel(id, { enabled });
			if (!updated) {
				return fail(404, {
					action: 'notificationsToggle',
					error: 'Channel not found'
				});
			}
		} catch (err) {
			logger.error('Failed to toggle notification channel', {
				error: err instanceof Error ? err.message : String(err)
			});
			return fail(500, {
				action: 'notificationsToggle',
				error: 'Failed to toggle channel. Please try again.'
			});
		}

		return {
			action: 'notificationsToggle',
			success: true
		};
	},

	notificationsTest: async ({ request }) => {
		const formData = await request.formData();
		const id = Number(formData.get('id'));

		if (!id || Number.isNaN(id)) {
			return fail(400, {
				action: 'notificationsTest',
				error: 'Invalid channel ID',
				channelId: id
			});
		}

		const channel = await getNotificationChannel(id);
		if (!channel) {
			return fail(404, {
				action: 'notificationsTest',
				error: 'Channel not found',
				channelId: id
			});
		}

		if (!isSupportedChannelType(channel.type)) {
			return fail(400, {
				action: 'notificationsTest',
				error: `Channel type "${channel.type}" is not yet supported`,
				channelId: id
			});
		}

		let sensitiveConfig: Record<string, unknown>;
		try {
			sensitiveConfig = await getDecryptedSensitiveConfig(channel);
		} catch (err) {
			logger.error('Failed to decrypt channel config', {
				error: err instanceof Error ? err.message : String(err)
			});
			return fail(500, {
				action: 'notificationsTest',
				error: 'Failed to decrypt channel configuration. Check your SECRET_KEY.',
				channelId: id
			});
		}

		const sender = getSender(channel.type);
		const startTime = Date.now();

		try {
			const result = await sender.test(channel, sensitiveConfig);
			const duration = Date.now() - startTime;

			if (!result.success) {
				return fail(400, {
					action: 'notificationsTest',
					error: result.error ?? 'Test notification failed',
					channelId: id,
					duration
				});
			}

			return {
				action: 'notificationsTest',
				success: true,
				message: `Test notification sent successfully (${duration}ms)`,
				channelId: id,
				duration
			};
		} catch (err) {
			const duration = Date.now() - startTime;
			logger.error('Test notification failed', {
				error: err instanceof Error ? err.message : String(err),
				channelId: id,
				duration
			});

			const errorMessage = err instanceof Error ? err.message : 'Unknown error';
			return fail(500, {
				action: 'notificationsTest',
				error: `Test failed: ${errorMessage}`,
				channelId: id,
				duration
			});
		}
	}
};
