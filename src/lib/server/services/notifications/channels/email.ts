/**
 * Email notification sender via SMTP.
 *
 * Uses nodemailer for SMTP transport.
 *
 * @module services/notifications/channels/email

 */

import type { Transporter } from 'nodemailer';
import nodemailer from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import type { NotificationChannel } from '$lib/server/db/schema';
import type { NotificationSender } from '../base-channel';
import { DEFAULT_SENDER_CONFIG, getEventColor } from '../base-channel';
import {
	NotificationAuthenticationError,
	NotificationConfigurationError,
	NotificationNetworkError
} from '../errors';
import type {
	EmailConfig,
	EmailSensitiveConfig,
	NotificationPayload,
	NotificationResult
} from '../types';

// =============================================================================
// Email Sender Implementation
// =============================================================================

/**
 * Sends notifications via SMTP email.
 */
export class EmailSender implements NotificationSender {
	private readonly timeout: number;

	constructor(config?: Partial<typeof DEFAULT_SENDER_CONFIG>) {
		this.timeout = config?.timeout ?? DEFAULT_SENDER_CONFIG.timeout;
	}

	/**
	 * Send a notification via email.
	 */
	async send(
		channel: NotificationChannel,
		sensitiveConfig: Record<string, unknown>,
		payload: NotificationPayload
	): Promise<NotificationResult> {
		const startTime = Date.now();
		const config = channel.config as EmailConfig | null;
		const sensitive = sensitiveConfig as unknown as EmailSensitiveConfig;

		// Validate required configuration
		if (!config?.host) {
			throw new NotificationConfigurationError('SMTP host is required');
		}
		if (!config?.from) {
			throw new NotificationConfigurationError('From email address is required');
		}
		if (!config?.to) {
			throw new NotificationConfigurationError('To email address is required');
		}

		// Create transporter
		const transporter = this.createTransporter(config, sensitive);

		// Build subject line
		const subject = config.subjectPrefix
			? `${config.subjectPrefix} ${payload.title}`
			: payload.title;

		// Build email body
		const html = this.buildHtmlBody(payload);
		const text = this.buildTextBody(payload);

		try {
			await transporter.sendMail({
				from: config.from,
				to: config.to,
				subject,
				text,
				html
			});

			const durationMs = Date.now() - startTime;

			return {
				success: true,
				channelId: channel.id,
				channelType: 'email',
				sentAt: new Date(),
				durationMs
			};
		} catch (error) {
			const durationMs = Date.now() - startTime;
			const errorMessage = this.handleError(error);

			return {
				success: false,
				channelId: channel.id,
				channelType: 'email',
				error: errorMessage,
				durationMs
			};
		} finally {
			transporter.close();
		}
	}

	/**
	 * Send a test email to verify the SMTP configuration.
	 */
	async test(
		channel: NotificationChannel,
		sensitiveConfig: Record<string, unknown>
	): Promise<NotificationResult> {
		return this.send(channel, sensitiveConfig, {
			eventType: 'app_started',
			title: 'Comradarr Test Notification',
			message:
				'This is a test notification from Comradarr. If you can see this, your email configuration is working correctly!',
			timestamp: new Date(),
			fields: [
				{ name: 'Channel', value: channel.name, inline: true },
				{ name: 'Status', value: 'Connected', inline: true }
			]
		});
	}

	/**
	 * Create a nodemailer transporter with the given configuration.
	 */
	private createTransporter(
		config: EmailConfig,
		sensitive: EmailSensitiveConfig
	): Transporter<SMTPTransport.SentMessageInfo> {
		const transportOptions: SMTPTransport.Options = {
			host: config.host,
			port: config.port ?? 587,
			secure: config.secure ?? false,
			connectionTimeout: this.timeout,
			greetingTimeout: this.timeout,
			socketTimeout: this.timeout
		};

		// Add auth if password is provided
		if (sensitive.password) {
			transportOptions.auth = {
				user: config.username ?? config.from,
				pass: sensitive.password
			};
		}

		return nodemailer.createTransport(transportOptions);
	}

	/**
	 * Build the HTML email body.
	 */
	private buildHtmlBody(payload: NotificationPayload): string {
		const color = payload.color ?? getEventColor(payload.eventType);
		const timestamp = (payload.timestamp ?? new Date()).toISOString();

		let fieldsHtml = '';
		if (payload.fields && payload.fields.length > 0) {
			fieldsHtml = payload.fields
				.map(
					(field) => `
						<tr>
							<td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; font-weight: 600; color: #334155; width: 30%;">
								${this.escapeHtml(field.name)}
							</td>
							<td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; color: #475569;">
								${this.escapeHtml(field.value)}
							</td>
						</tr>`
				)
				.join('');
		}

		let buttonHtml = '';
		if (payload.url) {
			buttonHtml = `
				<div style="margin-top: 20px;">
					<a href="${payload.url}"
					   style="display: inline-block; padding: 10px 20px; background-color: ${color};
					          color: white; text-decoration: none; border-radius: 4px; font-weight: 500;">
						View Details
					</a>
				</div>`;
		}

		return `
<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>${this.escapeHtml(payload.title)}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f1f5f9;">
	<div style="max-width: 600px; margin: 0 auto; padding: 20px;">
		<!-- Header -->
		<div style="background-color: ${color}; color: white; padding: 24px; border-radius: 8px 8px 0 0;">
			<h1 style="margin: 0; font-size: 24px; font-weight: 600;">
				${this.escapeHtml(payload.title)}
			</h1>
		</div>

		<!-- Content -->
		<div style="background-color: white; padding: 24px; border: 1px solid #e2e8f0; border-top: none;">
			<p style="margin: 0 0 16px 0; color: #334155; font-size: 16px; line-height: 1.5;">
				${this.escapeHtml(payload.message)}
			</p>

			${
				fieldsHtml
					? `
			<table style="width: 100%; border-collapse: collapse; margin-top: 16px;">
				${fieldsHtml}
			</table>`
					: ''
			}

			${buttonHtml}
		</div>

		<!-- Footer -->
		<div style="padding: 16px; text-align: center; color: #64748b; font-size: 12px; border-radius: 0 0 8px 8px; background-color: #f8fafc; border: 1px solid #e2e8f0; border-top: none;">
			Sent by Comradarr at ${timestamp}
		</div>
	</div>
</body>
</html>`;
	}

	/**
	 * Build the plain text email body.
	 */
	private buildTextBody(payload: NotificationPayload): string {
		const timestamp = (payload.timestamp ?? new Date()).toISOString();

		let text = `${payload.title}\n${'='.repeat(payload.title.length)}\n\n${payload.message}\n`;

		if (payload.fields && payload.fields.length > 0) {
			text += '\n';
			for (const field of payload.fields) {
				text += `${field.name}: ${field.value}\n`;
			}
		}

		if (payload.url) {
			text += `\nView Details: ${payload.url}`;
		}

		text += `\n\n---\nSent by Comradarr at ${timestamp}`;

		return text;
	}

	/**
	 * Escape HTML special characters.
	 */
	private escapeHtml(text: string): string {
		return text
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#039;');
	}

	/**
	 * Handle nodemailer errors and return appropriate error message.
	 */
	private handleError(error: unknown): string {
		if (error instanceof Error) {
			// Authentication errors
			if (
				error.message.includes('Invalid login') ||
				error.message.includes('authentication failed') ||
				error.message.includes('EAUTH')
			) {
				return new NotificationAuthenticationError(
					'SMTP authentication failed - check username and password'
				).message;
			}

			// Connection errors
			if (
				error.message.includes('ECONNREFUSED') ||
				error.message.includes('ETIMEDOUT') ||
				error.message.includes('ENOTFOUND')
			) {
				return new NotificationNetworkError('Failed to connect to SMTP server', error.message)
					.message;
			}

			// SSL/TLS errors
			if (
				error.message.includes('certificate') ||
				error.message.includes('SSL') ||
				error.message.includes('TLS')
			) {
				return new NotificationConfigurationError('SSL/TLS error - check secure setting and port')
					.message;
			}

			return error.message;
		}

		return 'Unknown SMTP error occurred';
	}
}
