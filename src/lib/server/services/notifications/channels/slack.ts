// Slack webhooks: POST JSON with text (fallback) and blocks (Block Kit)
// Reference: https://api.slack.com/messaging/webhooks

import type { NotificationChannel } from '$lib/server/db/schema';
import type { NotificationSender } from '../base-channel';
import { DEFAULT_SENDER_CONFIG } from '../base-channel';
import {
	NotificationConfigurationError,
	NotificationNetworkError,
	NotificationRateLimitError,
	NotificationServerError,
	NotificationTimeoutError
} from '../errors';
import type {
	NotificationPayload,
	NotificationResult,
	SlackConfig,
	SlackSensitiveConfig
} from '../types';

export class SlackSender implements NotificationSender {
	private readonly timeout: number;
	private readonly userAgent: string;

	constructor(config?: Partial<typeof DEFAULT_SENDER_CONFIG>) {
		this.timeout = config?.timeout ?? DEFAULT_SENDER_CONFIG.timeout;
		this.userAgent = config?.userAgent ?? DEFAULT_SENDER_CONFIG.userAgent;
	}

	async send(
		channel: NotificationChannel,
		sensitiveConfig: Record<string, unknown>,
		payload: NotificationPayload
	): Promise<NotificationResult> {
		const startTime = Date.now();
		const config = channel.config as SlackConfig | null;
		const sensitive = sensitiveConfig as unknown as SlackSensitiveConfig;

		// Validate required configuration
		if (!sensitive.webhookUrl) {
			throw new NotificationConfigurationError('Slack webhook URL is required');
		}

		// Build Slack blocks
		const blocks = this.buildBlocks(payload);

		// Build webhook payload
		const body: SlackWebhookPayload = {
			text: `${payload.title}: ${payload.message}`, // Fallback text for notifications
			blocks
		};

		// Add optional overrides from config
		if (config?.channel) {
			body.channel = config.channel;
		}
		if (config?.username) {
			body.username = config.username;
		}
		if (config?.iconEmoji) {
			body.icon_emoji = config.iconEmoji;
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
				const responseText = await response.text();
				const error = this.handleErrorResponse(response, responseText);
				return {
					success: false,
					channelId: channel.id,
					channelType: 'slack',
					error: error.message,
					statusCode: response.status,
					durationMs
				};
			}

			return {
				success: true,
				channelId: channel.id,
				channelType: 'slack',
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
				channelType: 'slack',
				error: errorMessage,
				durationMs
			};
		}
	}

	async test(
		channel: NotificationChannel,
		sensitiveConfig: Record<string, unknown>
	): Promise<NotificationResult> {
		return this.send(channel, sensitiveConfig, {
			eventType: 'app_started',
			title: 'Comradarr Test Notification',
			message:
				'This is a test notification from Comradarr. If you can see this, your Slack webhook is configured correctly!',
			timestamp: new Date(),
			fields: [
				{ name: 'Channel', value: channel.name, inline: true },
				{ name: 'Status', value: 'Connected', inline: true }
			]
		});
	}

	private buildBlocks(payload: NotificationPayload): SlackBlock[] {
		const blocks: SlackBlock[] = [];

		// Header block
		blocks.push({
			type: 'header',
			text: {
				type: 'plain_text',
				text: payload.title,
				emoji: true
			}
		});

		// Main message section
		blocks.push({
			type: 'section',
			text: {
				type: 'mrkdwn',
				text: payload.message
			}
		});

		// Fields section (if any)
		if (payload.fields && payload.fields.length > 0) {
			// Slack supports up to 10 fields per section, 2 per row when inline
			const fieldTexts = payload.fields.map((f) => ({
				type: 'mrkdwn' as const,
				text: `*${f.name}*\n${f.value}`
			}));

			blocks.push({
				type: 'section',
				fields: fieldTexts
			});
		}

		// Action button (if URL provided)
		if (payload.url) {
			blocks.push({
				type: 'actions',
				elements: [
					{
						type: 'button',
						text: {
							type: 'plain_text',
							text: 'View Details',
							emoji: true
						},
						url: payload.url,
						action_id: 'view_details'
					}
				]
			});
		}

		// Context with timestamp
		blocks.push({
			type: 'context',
			elements: [
				{
					type: 'mrkdwn',
					text: `Sent by Comradarr at ${(payload.timestamp ?? new Date()).toISOString()}`
				}
			]
		});

		return blocks;
	}

	// Slack webhook returns error codes as plain text (e.g., 'invalid_payload')
	private handleErrorResponse(response: Response, responseText: string): Error {
		if (responseText === 'invalid_payload' || responseText === 'invalid_token') {
			return new NotificationConfigurationError(
				`Invalid Slack webhook configuration: ${responseText}`
			);
		}

		if (responseText === 'channel_not_found') {
			return new NotificationConfigurationError('Slack channel not found');
		}

		if (response.status === 404) {
			return new NotificationConfigurationError(
				'Slack webhook not found - it may have been deleted'
			);
		}

		if (response.status === 429) {
			const retryAfter = response.headers.get('Retry-After');
			return new NotificationRateLimitError(retryAfter ? parseInt(retryAfter, 10) : undefined);
		}

		if (response.status >= 500) {
			return new NotificationServerError(response.status, response.statusText);
		}

		return new NotificationServerError(
			response.status,
			responseText || `HTTP ${response.status}: ${response.statusText}`
		);
	}

	private handleCatchError(error: unknown): string {
		if (error instanceof Error) {
			if (error.name === 'TimeoutError' || error.name === 'AbortError') {
				return new NotificationTimeoutError(this.timeout).message;
			}

			if (error.message.includes('fetch failed') || error.message.includes('ECONNREFUSED')) {
				return new NotificationNetworkError('Failed to connect to Slack', error.message).message;
			}

			return error.message;
		}

		return 'Unknown error occurred';
	}
}

interface SlackTextObject {
	type: 'plain_text' | 'mrkdwn';
	text: string;
	emoji?: boolean;
}

interface SlackBlock {
	type: 'header' | 'section' | 'actions' | 'context' | 'divider';
	text?: SlackTextObject;
	fields?: SlackTextObject[];
	elements?: SlackBlockElement[];
}

interface SlackBlockElement {
	type: 'button' | 'mrkdwn';
	text?: SlackTextObject | string;
	url?: string;
	action_id?: string;
}

interface SlackWebhookPayload {
	text: string;
	blocks?: SlackBlock[];
	channel?: string;
	username?: string;
	icon_emoji?: string;
}
