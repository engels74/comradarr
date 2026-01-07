import type { NotificationEventType } from '$lib/server/db/queries/notifications';

export type ImplementedChannelType = 'discord' | 'telegram' | 'slack' | 'email' | 'webhook';

export interface NotificationResult {
	success: boolean;
	channelId: number;
	channelType: string;
	sentAt?: Date;
	error?: string;
	statusCode?: number;
	durationMs: number;
}

export interface NotificationPayload {
	eventType: NotificationEventType;
	title: string;
	message: string;
	fields?: NotificationField[];
	color?: string;
	url?: string;
	eventData?: Record<string, unknown>;
	timestamp?: Date;
}

export interface NotificationField {
	name: string;
	value: string;
	inline?: boolean;
}

export interface NotificationSenderConfig {
	timeout?: number;
	userAgent?: string;
	retry?: {
		maxRetries?: number;
		baseDelay?: number;
		maxDelay?: number;
	};
}

export interface DiscordConfig {
	username?: string;
	avatarUrl?: string;
}

export interface DiscordSensitiveConfig {
	webhookUrl: string;
}

export interface TelegramConfig {
	chatId: string;
	parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
	disableWebPagePreview?: boolean;
	disableNotification?: boolean;
}

export interface TelegramSensitiveConfig {
	botToken: string;
}

export interface SlackConfig {
	channel?: string;
	username?: string;
	iconEmoji?: string;
}

export interface SlackSensitiveConfig {
	webhookUrl: string;
}

export interface EmailConfig {
	host: string;
	port: number;
	secure: boolean;
	from: string;
	to: string;
	username?: string;
	subjectPrefix?: string;
}

export interface EmailSensitiveConfig {
	password: string;
}

export interface WebhookConfig {
	method?: 'POST' | 'PUT';
	headers?: Record<string, string>;
	contentType?: string;
	includeTimestamp?: boolean;
	signatureHeader?: string;
	timestampHeader?: string;
}

export interface WebhookSensitiveConfig {
	url: string;
	signingSecret?: string;
}
