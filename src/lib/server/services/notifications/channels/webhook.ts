/**
 * Generic webhook notification sender with HMAC-SHA256 signature support.
 *
 * Supports customizable HTTP method, headers, and HMAC signature generation
 * for secure webhook verification.
 *
 * Requirement 9.5: The receiving webhook should use `request.text()` for raw body
 * access when verifying the signature (NOT request.json()).
 *
 * Signature Verification on Receiver Side:
 * 1. Get raw body: `const rawBody = await request.text()`
 * 2. Get timestamp: `const timestamp = request.headers.get('X-Comradarr-Timestamp')`
 * 3. Compute expected signature: `HMAC-SHA256(timestamp + '.' + rawBody, signingSecret)`
 * 4. Compare with header: `request.headers.get('X-Comradarr-Signature')`
 * 5. Optionally verify timestamp is recent (within 5 minutes)
 *
 * @module services/notifications/channels/webhook

 */

import type { NotificationChannel } from '$lib/server/db/schema';
import type {
	NotificationPayload,
	NotificationResult,
	WebhookConfig,
	WebhookSensitiveConfig
} from '../types';
import type { NotificationSender } from '../base-channel';
import { DEFAULT_SENDER_CONFIG } from '../base-channel';
import {
	NotificationConfigurationError,
	NotificationServerError,
	NotificationNetworkError,
	NotificationTimeoutError
} from '../errors';

// =============================================================================
// Constants
// =============================================================================

/** Default header name for the HMAC signature */
const DEFAULT_SIGNATURE_HEADER = 'X-Comradarr-Signature';

/** Default header name for the timestamp */
const DEFAULT_TIMESTAMP_HEADER = 'X-Comradarr-Timestamp';

// =============================================================================
// Webhook Sender Implementation
// =============================================================================

/**
 * Sends notifications via generic webhooks with optional HMAC signature.
 */
export class WebhookSender implements NotificationSender {
	private readonly timeout: number;
	private readonly userAgent: string;

	constructor(config?: Partial<typeof DEFAULT_SENDER_CONFIG>) {
		this.timeout = config?.timeout ?? DEFAULT_SENDER_CONFIG.timeout;
		this.userAgent = config?.userAgent ?? DEFAULT_SENDER_CONFIG.userAgent;
	}

	/**
	 * Send a notification to a generic webhook.
	 */
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

	/**
	 * Send a test notification to verify the webhook configuration.
	 */
	async test(
		channel: NotificationChannel,
		sensitiveConfig: Record<string, unknown>
	): Promise<NotificationResult> {
		return this.send(channel, sensitiveConfig, {
			eventType: 'app_started',
			title: 'Comradarr Test Notification',
			message: 'This is a test notification from Comradarr. If you receive this, your webhook is configured correctly!',
			timestamp: new Date(),
			fields: [
				{ name: 'Channel', value: channel.name, inline: true },
				{ name: 'Status', value: 'Connected', inline: true }
			]
		});
	}

	/**
	 * Generate HMAC-SHA256 signature using Web Crypto API.
	 *
	 * @param payload - The payload to sign
	 * @param secret - The signing secret
	 * @returns Hex-encoded signature
	 */
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

	/**
	 * Handle errors caught during fetch.
	 */
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

// =============================================================================
// Webhook Payload Type
// =============================================================================

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

// =============================================================================
// Signature Verification Helper (for documentation)
// =============================================================================

/**
 * Example signature verification code for the receiving webhook endpoint.
 *
 * This is provided as documentation for users implementing webhook receivers.
 *
 * ```typescript
 * // In your SvelteKit webhook endpoint (+server.ts)
 * import type { RequestHandler } from './$types';
 *
 * const SIGNING_SECRET = process.env.COMRADARR_WEBHOOK_SECRET;
 *
 * export const POST: RequestHandler = async ({ request }) => {
 *   // 1. Get raw body - IMPORTANT: use text(), not json()
 *   const rawBody = await request.text();
 *
 *   // 2. Get headers
 *   const signature = request.headers.get('X-Comradarr-Signature');
 *   const timestamp = request.headers.get('X-Comradarr-Timestamp');
 *
 *   if (!signature || !timestamp) {
 *     return new Response('Missing signature headers', { status: 401 });
 *   }
 *
 *   // 3. Verify timestamp is recent (within 5 minutes)
 *   const timestampAge = Math.floor(Date.now() / 1000) - parseInt(timestamp, 10);
 *   if (timestampAge > 300) {
 *     return new Response('Timestamp too old', { status: 401 });
 *   }
 *
 *   // 4. Compute expected signature
 *   const encoder = new TextEncoder();
 *   const key = await crypto.subtle.importKey(
 *     'raw',
 *     encoder.encode(SIGNING_SECRET),
 *     { name: 'HMAC', hash: 'SHA-256' },
 *     false,
 *     ['sign']
 *   );
 *
 *   const signaturePayload = `${timestamp}.${rawBody}`;
 *   const expectedSignature = await crypto.subtle.sign(
 *     'HMAC',
 *     key,
 *     encoder.encode(signaturePayload)
 *   );
 *
 *   const expectedHex = Array.from(new Uint8Array(expectedSignature))
 *     .map(b => b.toString(16).padStart(2, '0'))
 *     .join('');
 *
 *   // 5. Compare signatures (timing-safe comparison recommended)
 *   if (signature !== expectedHex) {
 *     return new Response('Invalid signature', { status: 401 });
 *   }
 *
 *   // 6. Parse and process the notification
 *   const notification = JSON.parse(rawBody);
 *   // ... handle notification ...
 *
 *   return new Response('OK', { status: 200 });
 * };
 * ```
 */
export const SIGNATURE_VERIFICATION_EXAMPLE = 'see-source-comment';
