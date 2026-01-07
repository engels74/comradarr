// Generic webhook with optional HMAC-SHA256 signature (timestamp.body format)
// Signature verification: HMAC-SHA256(timestamp + '.' + rawBody, signingSecret)

import type { NotificationChannel } from '$lib/server/db/schema';
import type { NotificationSender } from '../base-channel';
import { DEFAULT_SENDER_CONFIG } from '../base-channel';
import {
	NotificationConfigurationError,
	NotificationNetworkError,
	NotificationTimeoutError
} from '../errors';
import type {
	NotificationPayload,
	NotificationResult,
	WebhookConfig,
	WebhookSensitiveConfig
} from '../types';

const DEFAULT_SIGNATURE_HEADER = 'X-Comradarr-Signature';
const DEFAULT_TIMESTAMP_HEADER = 'X-Comradarr-Timestamp';

export class WebhookSender implements NotificationSender {
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
		const config = channel.config as WebhookConfig | null;
		const sensitive = sensitiveConfig as unknown as WebhookSensitiveConfig;

		// Validate required configuration
		if (!sensitive.url) {
			throw new NotificationConfigurationError('Webhook URL is required');
		}

		// Build the webhook body
		const body: WebhookPayload = {
			event_type: payload.eventType,
			title: payload.title,
			message: payload.message,
			timestamp: (payload.timestamp ?? new Date()).toISOString()
		};

		// Add optional fields
		if (payload.fields && payload.fields.length > 0) {
			body.fields = payload.fields.map((f) => {
				const field: { name: string; value: string; inline?: boolean } = {
					name: f.name,
					value: f.value
				};
				if (f.inline !== undefined) {
					field.inline = f.inline;
				}
				return field;
			});
		}

		if (payload.color) {
			body.color = payload.color;
		}

		if (payload.url) {
			body.url = payload.url;
		}

		if (payload.eventData) {
			body.event_data = payload.eventData;
		}

		// Serialize to JSON
		const rawBody = JSON.stringify(body);

		// Generate timestamp for signature
		const timestamp = Math.floor(Date.now() / 1000).toString();

		// Build headers
		const headers: Record<string, string> = {
			'Content-Type': config?.contentType ?? 'application/json',
			'User-Agent': this.userAgent
		};

		// Add custom headers from config
		if (config?.headers) {
			for (const [key, value] of Object.entries(config.headers)) {
				headers[key] = value;
			}
		}

		// Add signature headers if signing secret is configured
		if (sensitive.signingSecret) {
			const signatureHeader = config?.signatureHeader ?? DEFAULT_SIGNATURE_HEADER;
			const timestampHeader = config?.timestampHeader ?? DEFAULT_TIMESTAMP_HEADER;
			const includeTimestamp = config?.includeTimestamp !== false;

			// Generate signature payload
			// Format: timestamp.body (if includeTimestamp) or just body
			const signaturePayload = includeTimestamp ? `${timestamp}.${rawBody}` : rawBody;

			// Generate HMAC-SHA256 signature
			const signature = await this.generateHmacSignature(signaturePayload, sensitive.signingSecret);

			headers[signatureHeader] = signature;
			if (includeTimestamp) {
				headers[timestampHeader] = timestamp;
			}
		}

		try {
			const response = await fetch(sensitive.url, {
				method: config?.method ?? 'POST',
				headers,
				body: rawBody,
				signal: AbortSignal.timeout(this.timeout)
			});

			const durationMs = Date.now() - startTime;

			if (!response.ok) {
				const responseText = await response.text();
				return {
					success: false,
					channelId: channel.id,
					channelType: 'webhook',
					error: `HTTP ${response.status}: ${responseText || response.statusText}`,
					statusCode: response.status,
					durationMs
				};
			}

			return {
				success: true,
				channelId: channel.id,
				channelType: 'webhook',
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
				channelType: 'webhook',
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
				'This is a test notification from Comradarr. If you receive this, your webhook is configured correctly!',
			timestamp: new Date(),
			fields: [
				{ name: 'Channel', value: channel.name, inline: true },
				{ name: 'Status', value: 'Connected', inline: true }
			]
		});
	}

	private async generateHmacSignature(payload: string, secret: string): Promise<string> {
		const encoder = new TextEncoder();
		const keyData = encoder.encode(secret);
		const data = encoder.encode(payload);

		// Import the secret as an HMAC key
		const key = await crypto.subtle.importKey(
			'raw',
			keyData,
			{ name: 'HMAC', hash: 'SHA-256' },
			false,
			['sign']
		);

		// Sign the payload
		const signature = await crypto.subtle.sign('HMAC', key, data);

		// Convert to hex string
		const hashArray = Array.from(new Uint8Array(signature));
		return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
	}

	private handleCatchError(error: unknown): string {
		if (error instanceof Error) {
			if (error.name === 'TimeoutError' || error.name === 'AbortError') {
				return new NotificationTimeoutError(this.timeout).message;
			}

			if (error.message.includes('fetch failed') || error.message.includes('ECONNREFUSED')) {
				return new NotificationNetworkError('Failed to connect to webhook', error.message).message;
			}

			return error.message;
		}

		return 'Unknown error occurred';
	}
}

interface WebhookPayload {
	event_type: string;
	title: string;
	message: string;
	timestamp: string;
	fields?: Array<{
		name: string;
		value: string;
		inline?: boolean;
	}>;
	color?: string;
	url?: string;
	event_data?: Record<string, unknown>;
}

// Example signature verification for webhook receivers - see top comment for format
