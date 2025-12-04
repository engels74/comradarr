/**
 * Notification channels service.
 *
 * Provides implementations for sending notifications through various channels:
 * - Discord webhooks
 * - Telegram bot API
 * - Slack webhooks
 * - Email via SMTP
 * - Generic webhooks with HMAC signature support
 *
 * @module services/notifications
 * @requirements 9.1, 9.2, 9.4, 9.5, 36.2, 36.3
 *
 * @example
 * ```typescript
 * // Simple usage with notify() convenience function
 * import { notify } from '$lib/server/services/notifications';
 *
 * await notify('sweep_completed', {
 *   connectorId: 1,
 *   connectorName: 'Sonarr',
 *   gapsFound: 15,
 *   itemsQueued: 10
 * });
 *
 * // Or use the dispatcher directly
 * import { getNotificationDispatcher } from '$lib/server/services/notifications';
 *
 * const dispatcher = getNotificationDispatcher();
 * const result = await dispatcher.dispatch('search_success', {
 *   contentTitle: 'Breaking Bad',
 *   contentYear: 2008,
 *   quality: 'HDTV-1080p',
 *   connectorName: 'Sonarr'
 * });
 *
 * if (result.failureCount > 0) {
 *   console.warn(`${result.failureCount} notification(s) failed`);
 * }
 * ```
 */

// =============================================================================
// Type Exports
// =============================================================================

export type {
	ImplementedChannelType,
	NotificationResult,
	NotificationPayload,
	NotificationField,
	NotificationSenderConfig,
	// Channel-specific configs
	DiscordConfig,
	DiscordSensitiveConfig,
	TelegramConfig,
	TelegramSensitiveConfig,
	SlackConfig,
	SlackSensitiveConfig,
	EmailConfig,
	EmailSensitiveConfig,
	WebhookConfig,
	WebhookSensitiveConfig
} from './types';

// =============================================================================
// Base Interface Exports
// =============================================================================

export type { NotificationSender } from './base-channel';
export { DEFAULT_SENDER_CONFIG, EVENT_COLORS, hexColorToInt, getEventColor } from './base-channel';

// =============================================================================
// Error Exports
// =============================================================================

export {
	NotificationError,
	NotificationNetworkError,
	NotificationAuthenticationError,
	NotificationRateLimitError,
	NotificationServerError,
	NotificationTimeoutError,
	NotificationConfigurationError,
	NotificationValidationError,
	isNotificationError,
	isRetryableNotificationError,
	type NotificationErrorCategory
} from './errors';

// =============================================================================
// Channel Implementation Exports
// =============================================================================

export { DiscordSender } from './channels/discord';
export { TelegramSender } from './channels/telegram';
export { SlackSender } from './channels/slack';
export { EmailSender } from './channels/email';
export { WebhookSender } from './channels/webhook';

// =============================================================================
// Factory Function
// =============================================================================

import type { NotificationSender } from './base-channel';
import { DiscordSender } from './channels/discord';
import { TelegramSender } from './channels/telegram';
import { SlackSender } from './channels/slack';
import { EmailSender } from './channels/email';
import { WebhookSender } from './channels/webhook';
import { NotificationConfigurationError } from './errors';

/**
 * Cache of sender instances.
 * Senders are instantiated once and reused for performance.
 */
const senderInstances = new Map<string, NotificationSender>();

/**
 * Get the notification sender for a channel type.
 *
 * Senders are instantiated once and reused for performance.
 * This function is safe to call repeatedly with the same channel type.
 *
 * @param channelType - The type of notification channel
 * @returns The appropriate sender instance
 * @throws NotificationConfigurationError if channel type is not supported
 *
 * @example
 * ```typescript
 * const sender = getSender('discord');
 * const result = await sender.send(channel, sensitiveConfig, payload);
 * ```
 */
export function getSender(channelType: string): NotificationSender {
	const existing = senderInstances.get(channelType);
	if (existing) {
		return existing;
	}

	let sender: NotificationSender;

	switch (channelType) {
		case 'discord':
			sender = new DiscordSender();
			break;
		case 'telegram':
			sender = new TelegramSender();
			break;
		case 'slack':
			sender = new SlackSender();
			break;
		case 'email':
			sender = new EmailSender();
			break;
		case 'webhook':
			sender = new WebhookSender();
			break;
		default:
			throw new NotificationConfigurationError(`Unsupported channel type: ${channelType}`);
	}

	senderInstances.set(channelType, sender);
	return sender;
}

/**
 * Check if a channel type is supported.
 *
 * @param channelType - The channel type to check
 * @returns true if the channel type is supported
 */
export function isSupportedChannelType(channelType: string): boolean {
	const supportedTypes = ['discord', 'telegram', 'slack', 'email', 'webhook'];
	return supportedTypes.includes(channelType);
}

/**
 * Get list of supported channel types.
 *
 * @returns Array of supported channel type strings
 */
export function getSupportedChannelTypes(): string[] {
	return ['discord', 'telegram', 'slack', 'email', 'webhook'];
}

/**
 * Clear the sender cache.
 * Primarily useful for testing.
 */
export function clearSenderCache(): void {
	senderInstances.clear();
}

// =============================================================================
// Dispatcher Exports (Task 36.3)
// =============================================================================

export {
	NotificationDispatcher,
	getNotificationDispatcher,
	notify,
	type DispatchResult,
	type DispatchOptions
} from './dispatcher';

// =============================================================================
// Template Exports (Task 36.3)
// =============================================================================

export {
	buildPayload,
	type EventDataMap,
	type SweepStartedData,
	type SweepCompletedData,
	type SearchSuccessData,
	type SearchExhaustedData,
	type ConnectorHealthChangedData,
	type SyncCompletedData,
	type SyncFailedData,
	type AppStartedData,
	type UpdateAvailableData
} from './templates';

// =============================================================================
// Batching Exports (Task 36.4, Requirement 9.3)
// =============================================================================

export {
	NotificationBatcher,
	getNotificationBatcher,
	processBatches,
	type BatchProcessingResult,
	type ChannelBatchResult,
	type BatchSendResult
} from './batcher';

export { buildAggregatePayload, type AggregatedPayloadMetadata } from './aggregators';

// =============================================================================
// Quiet Hours Exports (Task 36.5, Requirement 9.4)
// =============================================================================

export {
	isInQuietHours,
	parseTimeString,
	getCurrentTimeInTimezone,
	timeToMinutes,
	isTimeInRange,
	type TimeOfDay
} from './quiet-hours';
