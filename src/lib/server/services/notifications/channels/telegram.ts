/**
 * Telegram Bot API notification sender.
 *
 * Uses the sendMessage endpoint: POST https://api.telegram.org/bot{token}/sendMessage
 *
 * Reference: https://core.telegram.org/bots/api#sendmessage
 *
 * @module services/notifications/channels/telegram

 */

import type { NotificationChannel } from '$lib/server/db/schema';
import type {
	NotificationPayload,
	NotificationResult,
	TelegramConfig,
	TelegramSensitiveConfig
} from '../types';
import type { NotificationSender } from '../base-channel';
import { DEFAULT_SENDER_CONFIG } from '../base-channel';
import {
	NotificationConfigurationError,
	NotificationServerError,
	NotificationRateLimitError,
	NotificationAuthenticationError,
	NotificationNetworkError,
	NotificationTimeoutError
} from '../errors';

// =============================================================================
// Constants
// =============================================================================

const TELEGRAM_API_BASE = 'https://api.telegram.org';

// =============================================================================
// Telegram Sender Implementation
// =============================================================================

/**
 * Sends notifications via Telegram Bot API.
 */
export class TelegramSender implements NotificationSender {
	private readonly timeout: number;
	private readonly userAgent: string;

	constructor(config?: Partial<typeof DEFAULT_SENDER_CONFIG>) {
		this.timeout = config?.timeout ?? DEFAULT_SENDER_CONFIG.timeout;
		this.userAgent = config?.userAgent ?? DEFAULT_SENDER_CONFIG.userAgent;
	}

	/**
	 * Send a notification via Telegram.
	 */
	async send(
		channel: NotificationChannel,
		sensitiveConfig: Record<string, unknown>,
		payload: NotificationPayload
	): Promise<NotificationResult> {
		const startTime = Date.now();
		const config = channel.config as TelegramConfig | null;
		const sensitive = sensitiveConfig as unknown as TelegramSensitiveConfig;

		// Validate required configuration
		if (!sensitive.botToken) {
			throw new NotificationConfigurationError('Telegram bot token is required');
		}
		if (!config?.chatId) {
			throw new NotificationConfigurationError('Telegram chat ID is required');
		}

		// Build message text
		const parseMode = config.parseMode ?? 'HTML';
		const text = this.formatMessage(payload, parseMode);

		// Build Telegram API URL
		const url = `${TELEGRAM_API_BASE}/bot${sensitive.botToken}/sendMessage`;

		// Build request body
		const body: TelegramSendMessageRequest = {
			chat_id: config.chatId,
			text,
			parse_mode: parseMode,
			disable_web_page_preview: config.disableWebPagePreview ?? false,
			disable_notification: config.disableNotification ?? false
		};

		try {
			const response = await fetch(url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'User-Agent': this.userAgent
				},
				body: JSON.stringify(body),
				signal: AbortSignal.timeout(this.timeout)
			});

			const durationMs = Date.now() - startTime;
			const result = (await response.json()) as TelegramApiResponse;

			if (!response.ok || !result.ok) {
				const error = this.handleErrorResponse(response, result.description);
				return {
					success: false,
					channelId: channel.id,
					channelType: 'telegram',
					error: error.message,
					statusCode: response.status,
					durationMs
				};
			}

			return {
				success: true,
				channelId: channel.id,
				channelType: 'telegram',
				sentAt: new Date(),
				statusCode: response.status,
				durationMs
			};
		} catch (error) {
			const durationMs = Date.now() - startTime;
			const errorMessage = this.handleCatchError(error);

			return {
				success: false,
				channelId: channel.id,
				channelType: 'telegram',
				error: errorMessage,
				durationMs
			};
		}
	}

	/**
	 * Send a test notification to verify the Telegram configuration.
	 */
	async test(
		channel: NotificationChannel,
		sensitiveConfig: Record<string, unknown>
	): Promise<NotificationResult> {
		return this.send(channel, sensitiveConfig, {
			eventType: 'app_started',
			title: 'Comradarr Test Notification',
			message: 'This is a test notification from Comradarr. If you can see this, your Telegram bot is configured correctly!',
			timestamp: new Date(),
			fields: [
				{ name: 'Channel', value: channel.name, inline: true },
				{ name: 'Status', value: 'Connected', inline: true }
			]
		});
	}

	/**
	 * Format the notification message based on parse mode.
	 */
	private formatMessage(payload: NotificationPayload, parseMode: string): string {
		if (parseMode === 'HTML') {
			return this.formatHtmlMessage(payload);
		}

		if (parseMode === 'MarkdownV2') {
			return this.formatMarkdownV2Message(payload);
		}

		// Plain Markdown fallback
		return this.formatMarkdownMessage(payload);
	}

	/**
	 * Format message as HTML (recommended for Telegram).
	 */
	private formatHtmlMessage(payload: NotificationPayload): string {
		let text = `<b>${this.escapeHtml(payload.title)}</b>\n\n${this.escapeHtml(payload.message)}`;

		if (payload.fields && payload.fields.length > 0) {
			text += '\n\n';
			for (const field of payload.fields) {
				text += `<b>${this.escapeHtml(field.name)}:</b> ${this.escapeHtml(field.value)}\n`;
			}
		}

		if (payload.url) {
			text += `\n<a href="${payload.url}">View Details</a>`;
		}

		return text;
	}

	/**
	 * Format message as MarkdownV2.
	 */
	private formatMarkdownV2Message(payload: NotificationPayload): string {
		let text = `*${this.escapeMarkdownV2(payload.title)}*\n\n${this.escapeMarkdownV2(payload.message)}`;

		if (payload.fields && payload.fields.length > 0) {
			text += '\n\n';
			for (const field of payload.fields) {
				text += `*${this.escapeMarkdownV2(field.name)}:* ${this.escapeMarkdownV2(field.value)}\n`;
			}
		}

		if (payload.url) {
			text += `\n[View Details](${payload.url})`;
		}

		return text;
	}

	/**
	 * Format message as legacy Markdown.
	 */
	private formatMarkdownMessage(payload: NotificationPayload): string {
		let text = `*${payload.title}*\n\n${payload.message}`;

		if (payload.fields && payload.fields.length > 0) {
			text += '\n\n';
			for (const field of payload.fields) {
				text += `*${field.name}:* ${field.value}\n`;
			}
		}

		if (payload.url) {
			text += `\n[View Details](${payload.url})`;
		}

		return text;
	}

	/**
	 * Escape HTML special characters.
	 */
	private escapeHtml(text: string): string {
		return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	}

	/**
	 * Escape MarkdownV2 special characters.
	 */
	private escapeMarkdownV2(text: string): string {
		// Characters that need escaping in MarkdownV2
		const specialChars = ['_', '*', '[', ']', '(', ')', '~', '`', '>', '#', '+', '-', '=', '|', '{', '}', '.', '!'];
		let escaped = text;
		for (const char of specialChars) {
			escaped = escaped.split(char).join(`\\${char}`);
		}
		return escaped;
	}

	/**
	 * Handle HTTP error responses from Telegram API.
	 */
	private handleErrorResponse(response: Response, description?: string): Error {
		if (response.status === 401) {
			return new NotificationAuthenticationError('Invalid Telegram bot token');
		}

		if (response.status === 400 && description?.includes('chat not found')) {
			return new NotificationConfigurationError('Telegram chat not found - verify the chat ID');
		}

		if (response.status === 403) {
			return new NotificationConfigurationError(
				'Bot was blocked by the user or cannot send messages to this chat'
			);
		}

		if (response.status === 429) {
			return new NotificationRateLimitError();
		}

		if (response.status >= 500) {
			return new NotificationServerError(response.status, response.statusText);
		}

		return new NotificationServerError(
			response.status,
			description ?? `HTTP ${response.status}: ${response.statusText}`
		);
	}

	/**
	 * Handle errors caught during fetch.
	 */
	private handleCatchError(error: unknown): string {
		if (error instanceof Error) {
			if (error.name === 'TimeoutError' || error.name === 'AbortError') {
				return new NotificationTimeoutError(this.timeout).message;
			}

			if (error.message.includes('fetch failed') || error.message.includes('ECONNREFUSED')) {
				return new NotificationNetworkError('Failed to connect to Telegram API', error.message).message;
			}

			return error.message;
		}

		return 'Unknown error occurred';
	}
}

// =============================================================================
// Telegram API Types
// =============================================================================

interface TelegramSendMessageRequest {
	chat_id: string;
	text: string;
	parse_mode?: string;
	disable_web_page_preview?: boolean;
	disable_notification?: boolean;
}

interface TelegramApiResponse {
	ok: boolean;
	description?: string;
	result?: unknown;
}
