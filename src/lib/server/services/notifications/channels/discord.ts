/**
 * Discord webhook notification sender.
 *
 * Discord webhooks accept POST requests with JSON body containing:
 * - content: Plain text message
 * - embeds: Array of rich embed objects
 *
 * Reference: https://discord.com/developers/docs/resources/webhook
 *
 * @module services/notifications/channels/discord

 */

import type { NotificationChannel } from '$lib/server/db/schema';
import type { NotificationSender } from '../base-channel';
import { DEFAULT_SENDER_CONFIG, getEventColor, hexColorToInt } from '../base-channel';
import {
	NotificationConfigurationError,
	NotificationNetworkError,
	NotificationRateLimitError,
	NotificationServerError,
	NotificationTimeoutError
} from '../errors';
import type {
	DiscordConfig,
	DiscordSensitiveConfig,
	NotificationPayload,
	NotificationResult
} from '../types';

// =============================================================================
// Discord Sender Implementation
// =============================================================================

/**
 * Sends notifications via Discord webhooks.
 */
export class DiscordSender implements NotificationSender {
	private readonly timeout: number;
	private readonly userAgent: string;

	constructor(config?: Partial<typeof DEFAULT_SENDER_CONFIG>) {
		this.timeout = config?.timeout ?? DEFAULT_SENDER_CONFIG.timeout;
		this.userAgent = config?.userAgent ?? DEFAULT_SENDER_CONFIG.userAgent;
	}

	/**
	 * Send a notification to a Discord webhook.
	 */
	async send(
		channel: NotificationChannel,
		sensitiveConfig: Record<string, unknown>,
		payload: NotificationPayload
	): Promise<NotificationResult> {
		const startTime = Date.now();
		const config = channel.config as DiscordConfig | null;
		const sensitive = sensitiveConfig as unknown as DiscordSensitiveConfig;

		// Validate required configuration
		if (!sensitive.webhookUrl) {
			throw new NotificationConfigurationError('Discord webhook URL is required');
		}

		// Build Discord embed
		const embed: DiscordEmbed = {
			title: payload.title,
			description: payload.message,
			color: payload.color
				? hexColorToInt(payload.color)
				: hexColorToInt(getEventColor(payload.eventType)),
			timestamp: (payload.timestamp ?? new Date()).toISOString()
		};

		// Add fields if present
		if (payload.fields && payload.fields.length > 0) {
			embed.fields = payload.fields.map((f) => ({
				name: f.name,
				value: f.value,
				inline: f.inline ?? false
			}));
		}

		// Add URL if present
		if (payload.url) {
			embed.url = payload.url;
		}

		// Build webhook payload
		const body: DiscordWebhookPayload = {
			embeds: [embed]
		};

		// Add optional username/avatar from config
		if (config?.username) {
			body.username = config.username;
		}
		if (config?.avatarUrl) {
			body.avatar_url = config.avatarUrl;
		}

		try {
			const response = await fetch(sensitive.webhookUrl, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'User-Agent': this.userAgent
				},
				body: JSON.stringify(body),
				signal: AbortSignal.timeout(this.timeout)
			});

			const durationMs = Date.now() - startTime;

			if (!response.ok) {
				const error = this.handleErrorResponse(response);
				return {
					success: false,
					channelId: channel.id,
					channelType: 'discord',
					error: error.message,
					statusCode: response.status,
					durationMs
				};
			}

			return {
				success: true,
				channelId: channel.id,
				channelType: 'discord',
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
				channelType: 'discord',
				error: errorMessage,
				durationMs
			};
		}
	}

	/**
	 * Send a test notification to verify the Discord webhook configuration.
	 */
	async test(
		channel: NotificationChannel,
		sensitiveConfig: Record<string, unknown>
	): Promise<NotificationResult> {
		return this.send(channel, sensitiveConfig, {
			eventType: 'app_started',
			title: 'Comradarr Test Notification',
			message:
				'This is a test notification from Comradarr. If you can see this, your Discord webhook is configured correctly!',
			timestamp: new Date(),
			fields: [
				{ name: 'Channel', value: channel.name, inline: true },
				{ name: 'Status', value: 'Connected', inline: true }
			]
		});
	}

	/**
	 * Handle HTTP error responses from Discord.
	 */
	private handleErrorResponse(response: Response): Error {
		if (response.status === 429) {
			const retryAfter = response.headers.get('Retry-After');
			return new NotificationRateLimitError(retryAfter ? parseInt(retryAfter, 10) : undefined);
		}

		if (response.status === 401 || response.status === 403) {
			return new NotificationConfigurationError('Invalid Discord webhook URL or unauthorized');
		}

		if (response.status === 404) {
			return new NotificationConfigurationError(
				'Discord webhook not found - it may have been deleted'
			);
		}

		if (response.status >= 500) {
			return new NotificationServerError(response.status, response.statusText);
		}

		return new NotificationServerError(
			response.status,
			`HTTP ${response.status}: ${response.statusText}`
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
				return new NotificationNetworkError('Failed to connect to Discord', error.message).message;
			}

			return error.message;
		}

		return 'Unknown error occurred';
	}
}

// =============================================================================
// Discord API Types
// =============================================================================

interface DiscordEmbed {
	title?: string;
	description?: string;
	url?: string;
	timestamp?: string;
	color?: number;
	fields?: Array<{
		name: string;
		value: string;
		inline?: boolean;
	}>;
}

interface DiscordWebhookPayload {
	content?: string;
	username?: string;
	avatar_url?: string;
	embeds?: DiscordEmbed[];
}
