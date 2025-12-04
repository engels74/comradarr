/**
 * Types for notification channel implementations.
 *
 * @module services/notifications/types
 * @requirements 9.1, 9.5, 36.2
 */

import type { NotificationEventType } from '$lib/server/db/queries/notifications';

// =============================================================================
// Common Types
// =============================================================================

/**
 * Supported notification channel types for Task 36.2.
 */
export type ImplementedChannelType = 'discord' | 'telegram' | 'slack' | 'email' | 'webhook';

/**
 * Result of sending a notification.
 */
export interface NotificationResult {
	/** Whether the notification was sent successfully */
	success: boolean;
	/** ID of the channel used */
	channelId: number;
	/** Type of the channel */
	channelType: string;
	/** Timestamp when notification was sent */
	sentAt?: Date;
	/** Error message if failed */
	error?: string;
	/** HTTP status code if applicable */
	statusCode?: number;
	/** Duration in milliseconds */
	durationMs: number;
}

/**
 * Notification payload to be sent.
 */
export interface NotificationPayload {
	/** Type of event that triggered the notification */
	eventType: NotificationEventType;
	/** Notification title */
	title: string;
	/** Notification message body */
	message: string;
	/** Optional fields for rich notifications */
	fields?: NotificationField[];
	/** Optional color (hex string, e.g., '#00FF00') */
	color?: string;
	/** Optional URL for the notification */
	url?: string;
	/** Original event data for custom formatting */
	eventData?: Record<string, unknown>;
	/** Timestamp of the event */
	timestamp?: Date;
}

/**
 * A key-value field for rich notifications.
 */
export interface NotificationField {
	/** Field name/label */
	name: string;
	/** Field value */
	value: string;
	/** Whether to display inline (for Discord/Slack) */
	inline?: boolean;
}

/**
 * Configuration options for notification senders.
 */
export interface NotificationSenderConfig {
	/** Request timeout in milliseconds (default: 30000) */
	timeout?: number;
	/** User-Agent header value */
	userAgent?: string;
	/** Retry configuration */
	retry?: {
		maxRetries?: number;
		baseDelay?: number;
		maxDelay?: number;
	};
}

// =============================================================================
// Discord Channel Types
// =============================================================================

/**
 * Discord channel non-sensitive configuration.
 * Stored in `config` column.
 */
export interface DiscordConfig {
	/** Username to display (optional, defaults to webhook default) */
	username?: string;
	/** Avatar URL (optional) */
	avatarUrl?: string;
}

/**
 * Discord channel sensitive configuration.
 * Stored encrypted in `configEncrypted` column.
 */
export interface DiscordSensitiveConfig {
	/** Discord webhook URL */
	webhookUrl: string;
}

// =============================================================================
// Telegram Channel Types
// =============================================================================

/**
 * Telegram channel non-sensitive configuration.
 * Stored in `config` column.
 */
export interface TelegramConfig {
	/** Telegram chat ID (can be user, group, or channel ID) */
	chatId: string;
	/** Parse mode: 'HTML' | 'Markdown' | 'MarkdownV2' (default: 'HTML') */
	parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
	/** Disable link previews */
	disableWebPagePreview?: boolean;
	/** Send silently without notification sound */
	disableNotification?: boolean;
}

/**
 * Telegram channel sensitive configuration.
 * Stored encrypted in `configEncrypted` column.
 */
export interface TelegramSensitiveConfig {
	/** Telegram bot token from @BotFather */
	botToken: string;
}

// =============================================================================
// Slack Channel Types
// =============================================================================

/**
 * Slack channel non-sensitive configuration.
 * Stored in `config` column.
 */
export interface SlackConfig {
	/** Channel override (optional, uses webhook default) */
	channel?: string;
	/** Username to display (optional) */
	username?: string;
	/** Emoji icon (e.g., ':robot:') */
	iconEmoji?: string;
}

/**
 * Slack channel sensitive configuration.
 * Stored encrypted in `configEncrypted` column.
 */
export interface SlackSensitiveConfig {
	/** Slack incoming webhook URL */
	webhookUrl: string;
}

// =============================================================================
// Email Channel Types
// =============================================================================

/**
 * Email (SMTP) channel non-sensitive configuration.
 * Stored in `config` column.
 */
export interface EmailConfig {
	/** SMTP server hostname */
	host: string;
	/** SMTP server port (default: 587) */
	port: number;
	/** Use TLS/SSL (true for port 465, false for other ports) */
	secure: boolean;
	/** From email address */
	from: string;
	/** To email address(es), comma-separated for multiple recipients */
	to: string;
	/** Optional username if different from 'from' address */
	username?: string;
	/** Subject line prefix */
	subjectPrefix?: string;
}

/**
 * Email channel sensitive configuration.
 * Stored encrypted in `configEncrypted` column.
 */
export interface EmailSensitiveConfig {
	/** SMTP password or app password */
	password: string;
}

// =============================================================================
// Generic Webhook Channel Types
// =============================================================================

/**
 * Generic webhook channel non-sensitive configuration.
 * Stored in `config` column.
 */
export interface WebhookConfig {
	/** HTTP method (default: POST) */
	method?: 'POST' | 'PUT';
	/** Custom headers (non-sensitive only) */
	headers?: Record<string, string>;
	/** Content type (default: application/json) */
	contentType?: string;
	/** Include timestamp header for signature verification (default: true) */
	includeTimestamp?: boolean;
	/** Name of the signature header (default: X-Comradarr-Signature) */
	signatureHeader?: string;
	/** Name of the timestamp header (default: X-Comradarr-Timestamp) */
	timestampHeader?: string;
}

/**
 * Generic webhook channel sensitive configuration.
 * Stored encrypted in `configEncrypted` column.
 */
export interface WebhookSensitiveConfig {
	/** Webhook URL to POST to */
	url: string;
	/** Optional HMAC-SHA256 signing secret for signature verification */
	signingSecret?: string;
}
