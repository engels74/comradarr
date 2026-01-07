import * as v from 'valibot';

export const NOTIFICATION_CHANNEL_TYPES = [
	'discord',
	'telegram',
	'slack',
	'email',
	'webhook',
	'pushover',
	'gotify',
	'ntfy'
] as const;

export type NotificationChannelType = (typeof NOTIFICATION_CHANNEL_TYPES)[number];

// Subset of types that are fully implemented (others are coming soon)
export const IMPLEMENTED_CHANNEL_TYPES = [
	'discord',
	'telegram',
	'slack',
	'email',
	'webhook'
] as const;

export type ImplementedChannelType = (typeof IMPLEMENTED_CHANNEL_TYPES)[number];

export const NOTIFICATION_EVENT_TYPES = [
	'sweep_started',
	'sweep_completed',
	'search_success',
	'search_exhausted',
	'connector_health_changed',
	'sync_completed',
	'sync_failed',
	'app_started',
	'update_available'
] as const;

export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number];

export const BaseChannelSchema = v.object({
	name: v.pipe(
		v.string('Channel name is required'),
		v.trim(),
		v.minLength(1, 'Channel name is required'),
		v.maxLength(100, 'Channel name must be 100 characters or less')
	),
	enabled: v.optional(v.boolean(), true),
	enabledEvents: v.optional(v.array(v.string()), []),
	// Batching configuration
	batchingEnabled: v.optional(v.boolean(), false),
	batchingWindowSeconds: v.optional(
		v.pipe(
			v.number('Batching window must be a number'),
			v.integer('Batching window must be a whole number'),
			v.minValue(10, 'Batching window must be at least 10 seconds'),
			v.maxValue(3600, 'Batching window must be at most 3,600 seconds (1 hour)')
		),
		60
	),
	// Quiet hours configuration
	quietHoursEnabled: v.optional(v.boolean(), false),
	quietHoursStart: v.optional(
		v.pipe(v.string(), v.regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Invalid time format (use HH:MM)'))
	),
	quietHoursEnd: v.optional(
		v.pipe(v.string(), v.regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Invalid time format (use HH:MM)'))
	),
	quietHoursTimezone: v.optional(v.string(), 'UTC')
});

export type BaseChannelInput = v.InferInput<typeof BaseChannelSchema>;
export type BaseChannelOutput = v.InferOutput<typeof BaseChannelSchema>;

export const DiscordConfigSchema = v.object({
	webhookUrl: v.pipe(
		v.string('Webhook URL is required'),
		v.trim(),
		v.url('Invalid webhook URL'),
		v.startsWith('https://discord.com/api/webhooks/', 'Must be a Discord webhook URL')
	),
	username: v.optional(
		v.pipe(v.string(), v.trim(), v.maxLength(80, 'Username must be 80 characters or less'))
	),
	avatarUrl: v.optional(v.pipe(v.string(), v.trim(), v.url('Invalid avatar URL')))
});

export type DiscordConfigInput = v.InferInput<typeof DiscordConfigSchema>;
export type DiscordConfigOutput = v.InferOutput<typeof DiscordConfigSchema>;

export const TelegramConfigSchema = v.object({
	botToken: v.pipe(
		v.string('Bot token is required'),
		v.trim(),
		v.minLength(1, 'Bot token is required')
	),
	chatId: v.pipe(v.string('Chat ID is required'), v.trim(), v.minLength(1, 'Chat ID is required')),
	parseMode: v.optional(v.picklist(['HTML', 'Markdown', 'MarkdownV2']), 'HTML'),
	disableWebPagePreview: v.optional(v.boolean(), false),
	disableNotification: v.optional(v.boolean(), false)
});

export type TelegramConfigInput = v.InferInput<typeof TelegramConfigSchema>;
export type TelegramConfigOutput = v.InferOutput<typeof TelegramConfigSchema>;

export const SlackConfigSchema = v.object({
	webhookUrl: v.pipe(
		v.string('Webhook URL is required'),
		v.trim(),
		v.url('Invalid webhook URL'),
		v.startsWith('https://hooks.slack.com/', 'Must be a Slack webhook URL')
	),
	channel: v.optional(
		v.pipe(v.string(), v.trim(), v.maxLength(80, 'Channel must be 80 characters or less'))
	),
	username: v.optional(
		v.pipe(v.string(), v.trim(), v.maxLength(80, 'Username must be 80 characters or less'))
	),
	iconEmoji: v.optional(
		v.pipe(v.string(), v.trim(), v.maxLength(50, 'Icon emoji must be 50 characters or less'))
	)
});

export type SlackConfigInput = v.InferInput<typeof SlackConfigSchema>;
export type SlackConfigOutput = v.InferOutput<typeof SlackConfigSchema>;

export const EmailConfigSchema = v.object({
	host: v.pipe(
		v.string('SMTP host is required'),
		v.trim(),
		v.minLength(1, 'SMTP host is required'),
		v.maxLength(255, 'Host must be 255 characters or less')
	),
	port: v.pipe(
		v.number('Port must be a number'),
		v.integer('Port must be a whole number'),
		v.minValue(1, 'Port must be at least 1'),
		v.maxValue(65535, 'Port must be at most 65535')
	),
	secure: v.optional(v.boolean(), false),
	from: v.pipe(v.string('From email is required'), v.trim(), v.email('Invalid email address')),
	to: v.pipe(v.string('To email is required'), v.trim(), v.minLength(1, 'To email is required')),
	username: v.optional(v.pipe(v.string(), v.trim())),
	password: v.optional(v.pipe(v.string())),
	subjectPrefix: v.optional(
		v.pipe(v.string(), v.trim(), v.maxLength(50, 'Subject prefix must be 50 characters or less'))
	)
});

export type EmailConfigInput = v.InferInput<typeof EmailConfigSchema>;
export type EmailConfigOutput = v.InferOutput<typeof EmailConfigSchema>;

export const WebhookConfigSchema = v.object({
	url: v.pipe(v.string('Webhook URL is required'), v.trim(), v.url('Invalid webhook URL')),
	method: v.optional(v.picklist(['POST', 'PUT']), 'POST'),
	signingSecret: v.optional(v.pipe(v.string(), v.trim())),
	contentType: v.optional(v.pipe(v.string(), v.trim()), 'application/json'),
	includeTimestamp: v.optional(v.boolean(), true),
	signatureHeader: v.optional(v.pipe(v.string(), v.trim()), 'X-Comradarr-Signature'),
	timestampHeader: v.optional(v.pipe(v.string(), v.trim()), 'X-Comradarr-Timestamp')
});

export type WebhookConfigInput = v.InferInput<typeof WebhookConfigSchema>;
export type WebhookConfigOutput = v.InferOutput<typeof WebhookConfigSchema>;

export const channelTypeLabels: Record<NotificationChannelType, string> = {
	discord: 'Discord',
	telegram: 'Telegram',
	slack: 'Slack',
	email: 'Email (SMTP)',
	webhook: 'Webhook',
	pushover: 'Pushover',
	gotify: 'Gotify',
	ntfy: 'ntfy'
};

export const channelTypeDescriptions: Record<NotificationChannelType, string> = {
	discord: 'Send notifications to a Discord channel via webhook',
	telegram: 'Send notifications via Telegram bot',
	slack: 'Send notifications to a Slack channel via webhook',
	email: 'Send notifications via email (SMTP)',
	webhook: 'Send notifications to a custom HTTP endpoint',
	pushover: 'Send push notifications via Pushover (coming soon)',
	gotify: 'Send notifications to a Gotify server (coming soon)',
	ntfy: 'Send notifications via ntfy.sh (coming soon)'
};

export const eventTypeLabels: Record<NotificationEventType, string> = {
	sweep_started: 'Sweep Started',
	sweep_completed: 'Sweep Completed',
	search_success: 'Search Success',
	search_exhausted: 'Search Exhausted',
	connector_health_changed: 'Connector Health Changed',
	sync_completed: 'Sync Completed',
	sync_failed: 'Sync Failed',
	app_started: 'Application Started',
	update_available: 'Update Available'
};

export const eventTypeDescriptions: Record<NotificationEventType, string> = {
	sweep_started: 'When a sweep cycle begins scanning a connector',
	sweep_completed: 'When a sweep cycle finishes with discovered items',
	search_success: 'When a search finds and grabs content',
	search_exhausted: 'When a search has reached maximum retry attempts',
	connector_health_changed: 'When a connector health status changes',
	sync_completed: 'When a library sync completes successfully',
	sync_failed: 'When a library sync fails',
	app_started: 'When Comradarr starts up',
	update_available: 'When a new version is available'
};

export const baseChannelLabels = {
	name: 'Channel Name',
	enabled: 'Enabled',
	enabledEvents: 'Notification Events',
	batchingEnabled: 'Enable Batching',
	batchingWindowSeconds: 'Batching Window (seconds)',
	quietHoursEnabled: 'Enable Quiet Hours',
	quietHoursStart: 'Start Time',
	quietHoursEnd: 'End Time',
	quietHoursTimezone: 'Timezone'
};

export const baseChannelDescriptions = {
	name: 'A friendly name to identify this notification channel',
	enabled: 'Whether this channel should receive notifications',
	enabledEvents: 'Select which events should trigger notifications to this channel',
	batchingEnabled: 'Combine multiple notifications within a time window into a single digest',
	batchingWindowSeconds: 'How long to wait before sending batched notifications (10-3600)',
	quietHoursEnabled: 'Suppress notifications during specified hours',
	quietHoursStart: 'When quiet hours begin (24-hour format)',
	quietHoursEnd: 'When quiet hours end (24-hour format)',
	quietHoursTimezone: 'Timezone for quiet hours schedule'
};

export const discordFieldLabels = {
	webhookUrl: 'Webhook URL',
	username: 'Bot Username',
	avatarUrl: 'Avatar URL'
};

export const discordFieldDescriptions = {
	webhookUrl: 'Discord webhook URL from channel settings',
	username: 'Custom username for the bot (optional)',
	avatarUrl: 'Custom avatar image URL (optional)'
};

export const telegramFieldLabels = {
	botToken: 'Bot Token',
	chatId: 'Chat ID',
	parseMode: 'Parse Mode',
	disableWebPagePreview: 'Disable Link Previews',
	disableNotification: 'Silent Notifications'
};

export const telegramFieldDescriptions = {
	botToken: 'Bot token from @BotFather',
	chatId: 'Chat, group, or channel ID to send messages to',
	parseMode: 'Message formatting mode',
	disableWebPagePreview: 'Do not show link previews in messages',
	disableNotification: 'Send without notification sound'
};

export const slackFieldLabels = {
	webhookUrl: 'Webhook URL',
	channel: 'Channel Override',
	username: 'Bot Username',
	iconEmoji: 'Icon Emoji'
};

export const slackFieldDescriptions = {
	webhookUrl: 'Slack incoming webhook URL',
	channel: 'Override the default channel (e.g., #alerts)',
	username: 'Custom bot username (optional)',
	iconEmoji: 'Custom emoji icon (e.g., :robot:)'
};

export const emailFieldLabels = {
	host: 'SMTP Host',
	port: 'Port',
	secure: 'Use TLS/SSL',
	from: 'From Email',
	to: 'To Email(s)',
	username: 'Username',
	password: 'Password',
	subjectPrefix: 'Subject Prefix'
};

export const emailFieldDescriptions = {
	host: 'SMTP server hostname',
	port: 'SMTP server port (usually 587 for TLS or 465 for SSL)',
	secure: 'Use SSL/TLS connection (required for port 465)',
	from: 'Sender email address',
	to: 'Recipient email addresses (comma-separated for multiple)',
	username: 'SMTP username (if different from sender email)',
	password: 'SMTP password or app-specific password',
	subjectPrefix: 'Prefix for email subject lines'
};

export const webhookFieldLabels = {
	url: 'Webhook URL',
	method: 'HTTP Method',
	signingSecret: 'Signing Secret',
	contentType: 'Content Type',
	includeTimestamp: 'Include Timestamp',
	signatureHeader: 'Signature Header',
	timestampHeader: 'Timestamp Header'
};

export const webhookFieldDescriptions = {
	url: 'URL to send webhook requests to',
	method: 'HTTP method for the request',
	signingSecret: 'Secret key for HMAC-SHA256 signature verification (optional)',
	contentType: 'Content-Type header value',
	includeTimestamp: 'Include timestamp header for replay protection',
	signatureHeader: 'Name of the signature header',
	timestampHeader: 'Name of the timestamp header'
};

export function isImplementedChannelType(type: string): type is ImplementedChannelType {
	return IMPLEMENTED_CHANNEL_TYPES.includes(type as ImplementedChannelType);
}

export function getChannelConfigSchema(type: NotificationChannelType) {
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

export function getChannelFieldLabels(type: NotificationChannelType): Record<string, string> {
	switch (type) {
		case 'discord':
			return discordFieldLabels;
		case 'telegram':
			return telegramFieldLabels;
		case 'slack':
			return slackFieldLabels;
		case 'email':
			return emailFieldLabels;
		case 'webhook':
			return webhookFieldLabels;
		default:
			return {};
	}
}

export function getChannelFieldDescriptions(type: NotificationChannelType): Record<string, string> {
	switch (type) {
		case 'discord':
			return discordFieldDescriptions;
		case 'telegram':
			return telegramFieldDescriptions;
		case 'slack':
			return slackFieldDescriptions;
		case 'email':
			return emailFieldDescriptions;
		case 'webhook':
			return webhookFieldDescriptions;
		default:
			return {};
	}
}

// Fields requiring encryption for security
export const sensitiveFields: Record<ImplementedChannelType, string[]> = {
	discord: ['webhookUrl'],
	telegram: ['botToken'],
	slack: ['webhookUrl'],
	email: ['password'],
	webhook: ['url', 'signingSecret']
};

export function getSensitiveFields(type: string): string[] {
	return sensitiveFields[type as ImplementedChannelType] ?? [];
}
