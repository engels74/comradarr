/**
 * Notification settings page server load and actions.
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
import type { NotificationChannel } from '$lib/server/db/schema';
import { createLogger } from '$lib/server/logger';
import { getSender, isSupportedChannelType } from '$lib/server/services/notifications';
import type { Actions, PageServerLoad } from './$types';

const logger = createLogger('notifications');

/**
 * Channel with statistics for display.
 */
export interface ChannelWithStats extends NotificationChannel {
	stats: NotificationChannelStats;
}

export const load: PageServerLoad = async () => {
	const channels = await getAllNotificationChannels();

	const channelsWithStats: ChannelWithStats[] = await Promise.all(
		channels.map(async (channel) => ({
			...channel,
			stats: await getNotificationChannelStats(channel.id)
		}))
	);

	return { channels: channelsWithStats };
};

function parseBaseFields(formData: FormData) {
	const batchingWindowStr = formData.get('batchingWindowSeconds')?.toString();

	return {
		name: formData.get('name')?.toString() ?? '',
		enabled: formData.get('enabled') !== 'false',
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

function getConfigSchema(type: string) {
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

function parseChannelFields(formData: FormData, type: string) {
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

function splitConfig(
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

export const actions: Actions = {
	create: async ({ request }) => {
		const formData = await request.formData();
		const type = formData.get('type')?.toString();

		if (!type) {
			return fail(400, {
				action: 'create',
				error: 'Channel type is required'
			});
		}

		if (!isImplementedChannelType(type)) {
			return fail(400, {
				action: 'create',
				error: `Channel type "${type}" is not yet supported`
			});
		}

		// Parse base and channel-specific fields
		const baseData = parseBaseFields(formData);
		const channelData = parseChannelFields(formData, type);

		// Validate base fields
		const baseResult = v.safeParse(BaseChannelSchema, baseData);
		if (!baseResult.success) {
			const errors = baseResult.issues.map((issue) => issue.message);
			return fail(400, {
				action: 'create',
				error: errors[0] ?? 'Invalid input',
				values: { type, ...baseData, ...channelData }
			});
		}

		// Validate channel-specific fields
		const configSchema = getConfigSchema(type);
		if (configSchema) {
			const configResult = v.safeParse(configSchema, channelData);
			if (!configResult.success) {
				const errors = configResult.issues.map((issue) => issue.message);
				return fail(400, {
					action: 'create',
					error: errors[0] ?? 'Invalid input',
					values: { type, ...baseData, ...channelData }
				});
			}
		}

		// Validate quiet hours if enabled
		if (baseData.quietHoursEnabled) {
			if (!baseData.quietHoursStart || !baseData.quietHoursEnd) {
				return fail(400, {
					action: 'create',
					error: 'Both start and end time are required when quiet hours are enabled',
					values: { type, ...baseData, ...channelData }
				});
			}
			if (baseData.quietHoursTimezone && !isValidTimezone(baseData.quietHoursTimezone)) {
				return fail(400, {
					action: 'create',
					error: 'Invalid timezone',
					values: { type, ...baseData, ...channelData }
				});
			}
		}

		// Check name uniqueness
		const nameExists = await notificationChannelNameExists(baseData.name);
		if (nameExists) {
			return fail(400, {
				action: 'create',
				error: 'A channel with this name already exists',
				values: { type, ...baseData, ...channelData }
			});
		}

		// Split config into plain and sensitive
		const { config, sensitiveConfig } = splitConfig(type, channelData);

		// Build channel input, only including optional fields when defined
		const channelInput: Parameters<typeof createNotificationChannel>[0] = {
			name: baseData.name,
			type: type as NotificationChannelType,
			config,
			sensitiveConfig,
			enabled: baseData.enabled,
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

		// Create the channel
		try {
			await createNotificationChannel(channelInput);
		} catch (err) {
			logger.error('Failed to create channel', {
				error: err instanceof Error ? err.message : String(err)
			});
			return fail(500, {
				action: 'create',
				error: 'Failed to create channel. Please try again.',
				values: { type, ...baseData, ...channelData }
			});
		}

		return { success: true, message: 'Notification channel created successfully' };
	},

	update: async ({ request }) => {
		const formData = await request.formData();
		const id = Number(formData.get('id'));
		const type = formData.get('type')?.toString();

		if (!id || Number.isNaN(id)) {
			return fail(400, {
				action: 'update',
				error: 'Invalid channel ID'
			});
		}

		if (!type) {
			return fail(400, {
				action: 'update',
				error: 'Channel type is required'
			});
		}

		// Parse base and channel-specific fields
		const baseData = parseBaseFields(formData);
		const channelData = parseChannelFields(formData, type);

		// Validate base fields
		const baseResult = v.safeParse(BaseChannelSchema, baseData);
		if (!baseResult.success) {
			const errors = baseResult.issues.map((issue) => issue.message);
			return fail(400, {
				action: 'update',
				error: errors[0] ?? 'Invalid input',
				values: { id, type, ...baseData, ...channelData }
			});
		}

		// For updates, we need to handle sensitive fields specially
		// Only validate required fields if they're provided
		const configSchema = getConfigSchema(type);
		if (configSchema) {
			// Check if sensitive fields have values (not empty means user wants to update)
			const sensitiveFieldNames = getSensitiveFields(type);
			const hasSensitiveUpdate = sensitiveFieldNames.some((field) => {
				const value = channelData[field as keyof typeof channelData];
				return value !== undefined && value !== '';
			});

			// Only validate if we have sensitive field updates
			if (hasSensitiveUpdate) {
				const configResult = v.safeParse(configSchema, channelData);
				if (!configResult.success) {
					const errors = configResult.issues.map((issue) => issue.message);
					return fail(400, {
						action: 'update',
						error: errors[0] ?? 'Invalid input',
						values: { id, type, ...baseData, ...channelData }
					});
				}
			}
		}

		// Validate quiet hours if enabled
		if (baseData.quietHoursEnabled) {
			if (!baseData.quietHoursStart || !baseData.quietHoursEnd) {
				return fail(400, {
					action: 'update',
					error: 'Both start and end time are required when quiet hours are enabled',
					values: { id, type, ...baseData, ...channelData }
				});
			}
			if (baseData.quietHoursTimezone && !isValidTimezone(baseData.quietHoursTimezone)) {
				return fail(400, {
					action: 'update',
					error: 'Invalid timezone',
					values: { id, type, ...baseData, ...channelData }
				});
			}
		}

		// Check name uniqueness (excluding current channel)
		const nameExists = await notificationChannelNameExists(baseData.name, id);
		if (nameExists) {
			return fail(400, {
				action: 'update',
				error: 'A channel with this name already exists',
				values: { id, type, ...baseData, ...channelData }
			});
		}

		// Split config into plain and sensitive
		const { config, sensitiveConfig } = splitConfig(type, channelData);

		// Build update data, only including optional fields when defined
		const updateData: Parameters<typeof updateNotificationChannel>[1] = {
			name: baseData.name,
			config,
			enabled: baseData.enabled,
			enabledEvents: baseData.enabledEvents as NotificationEventType[],
			batchingEnabled: baseData.batchingEnabled,
			batchingWindowSeconds: baseData.batchingWindowSeconds,
			quietHoursEnabled: baseData.quietHoursEnabled,
			quietHoursTimezone: baseData.quietHoursTimezone
		};

		if (baseData.quietHoursStart) {
			updateData.quietHoursStart = baseData.quietHoursStart;
		}
		if (baseData.quietHoursEnd) {
			updateData.quietHoursEnd = baseData.quietHoursEnd;
		}

		// Only update sensitive config if new values were provided
		if (Object.keys(sensitiveConfig).length > 0) {
			updateData.sensitiveConfig = sensitiveConfig;
		}

		// Update the channel
		try {
			const updated = await updateNotificationChannel(id, updateData);
			if (!updated) {
				return fail(404, {
					action: 'update',
					error: 'Channel not found'
				});
			}
		} catch (err) {
			logger.error('Failed to update channel', {
				error: err instanceof Error ? err.message : String(err)
			});
			return fail(500, {
				action: 'update',
				error: 'Failed to update channel. Please try again.',
				values: { id, type, ...baseData, ...channelData }
			});
		}

		return { success: true, message: 'Notification channel updated successfully' };
	},

	delete: async ({ request }) => {
		const formData = await request.formData();
		const id = Number(formData.get('id'));

		if (!id || Number.isNaN(id)) {
			return fail(400, {
				action: 'delete',
				error: 'Invalid channel ID'
			});
		}

		try {
			const deleted = await deleteNotificationChannel(id);
			if (!deleted) {
				return fail(404, {
					action: 'delete',
					error: 'Channel not found'
				});
			}
		} catch (err) {
			logger.error('Failed to delete channel', {
				error: err instanceof Error ? err.message : String(err)
			});
			return fail(500, {
				action: 'delete',
				error: 'Failed to delete channel. Please try again.'
			});
		}

		return { success: true, message: 'Notification channel deleted successfully' };
	},

	toggle: async ({ request }) => {
		const formData = await request.formData();
		const id = Number(formData.get('id'));
		const enabled = formData.get('enabled') === 'true';

		if (!id || Number.isNaN(id)) {
			return fail(400, {
				action: 'toggle',
				error: 'Invalid channel ID'
			});
		}

		try {
			const updated = await updateNotificationChannel(id, { enabled });
			if (!updated) {
				return fail(404, {
					action: 'toggle',
					error: 'Channel not found'
				});
			}
		} catch (err) {
			logger.error('Failed to toggle channel', {
				error: err instanceof Error ? err.message : String(err)
			});
			return fail(500, {
				action: 'toggle',
				error: 'Failed to toggle channel. Please try again.'
			});
		}

		return { success: true };
	},

	test: async ({ request }) => {
		const formData = await request.formData();
		const id = Number(formData.get('id'));

		if (!id || Number.isNaN(id)) {
			return fail(400, {
				action: 'test',
				error: 'Invalid channel ID',
				channelId: id
			});
		}

		// Get channel
		const channel = await getNotificationChannel(id);
		if (!channel) {
			return fail(404, {
				action: 'test',
				error: 'Channel not found',
				channelId: id
			});
		}

		// Check if channel type is supported
		if (!isSupportedChannelType(channel.type)) {
			return fail(400, {
				action: 'test',
				error: `Channel type "${channel.type}" is not yet supported`,
				channelId: id
			});
		}

		// Get decrypted sensitive config
		let sensitiveConfig: Record<string, unknown>;
		try {
			sensitiveConfig = await getDecryptedSensitiveConfig(channel);
		} catch (err) {
			logger.error('Failed to decrypt channel config', {
				error: err instanceof Error ? err.message : String(err)
			});
			return fail(500, {
				action: 'test',
				error: 'Failed to decrypt channel configuration. Check your SECRET_KEY.',
				channelId: id
			});
		}

		// Get sender and send test
		const sender = getSender(channel.type);
		const startTime = Date.now();

		try {
			const result = await sender.test(channel, sensitiveConfig);
			const duration = Date.now() - startTime;

			if (!result.success) {
				return fail(400, {
					action: 'test',
					error: result.error ?? 'Test notification failed',
					channelId: id,
					duration
				});
			}

			return {
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
				action: 'test',
				error: `Test failed: ${errorMessage}`,
				channelId: id,
				duration
			});
		}
	}
};
