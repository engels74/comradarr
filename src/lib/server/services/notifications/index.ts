/**
 * Notification channels service.
 * @module services/notifications
 */

export type { NotificationSender } from './base-channel';
export { DEFAULT_SENDER_CONFIG, EVENT_COLORS, getEventColor, hexColorToInt } from './base-channel';
export { DiscordSender } from './channels/discord';
export { EmailSender } from './channels/email';
export { SlackSender } from './channels/slack';
export { TelegramSender } from './channels/telegram';
export { WebhookSender } from './channels/webhook';
export {
	isNotificationError,
	isRetryableNotificationError,
	NotificationAuthenticationError,
	NotificationConfigurationError,
	NotificationError,
	type NotificationErrorCategory,
	NotificationNetworkError,
	NotificationRateLimitError,
	NotificationServerError,
	NotificationTimeoutError,
	NotificationValidationError
} from './errors';
export type {
	// Channel-specific configs
	DiscordConfig,
	DiscordSensitiveConfig,
	EmailConfig,
	EmailSensitiveConfig,
	ImplementedChannelType,
	NotificationField,
	NotificationPayload,
	NotificationResult,
	NotificationSenderConfig,
	SlackConfig,
	SlackSensitiveConfig,
	TelegramConfig,
	TelegramSensitiveConfig,
	WebhookConfig,
	WebhookSensitiveConfig
} from './types';

import type { NotificationSender } from './base-channel';
import { DiscordSender } from './channels/discord';
import { EmailSender } from './channels/email';
import { SlackSender } from './channels/slack';
import { TelegramSender } from './channels/telegram';
import { WebhookSender } from './channels/webhook';
import { NotificationConfigurationError } from './errors';

const senderInstances = new Map<string, NotificationSender>();

/** Get the notification sender for a channel type. */
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

export function isSupportedChannelType(channelType: string): boolean {
	const supportedTypes = ['discord', 'telegram', 'slack', 'email', 'webhook'];
	return supportedTypes.includes(channelType);
}

export function getSupportedChannelTypes(): string[] {
	return ['discord', 'telegram', 'slack', 'email', 'webhook'];
}

/** Clear the sender cache (for testing). */
export function clearSenderCache(): void {
	senderInstances.clear();
}

export { type AggregatedPayloadMetadata, buildAggregatePayload } from './aggregators';
export {
	type BatchProcessingResult,
	type BatchSendResult,
	type ChannelBatchResult,
	getNotificationBatcher,
	NotificationBatcher,
	processBatches
} from './batcher';
export {
	type DispatchOptions,
	type DispatchResult,
	getNotificationDispatcher,
	NotificationDispatcher,
	notify
} from './dispatcher';
export {
	getCurrentTimeInTimezone,
	isInQuietHours,
	isTimeInRange,
	parseTimeString,
	type TimeOfDay,
	timeToMinutes
} from './quiet-hours';
export {
	type AppStartedData,
	buildPayload,
	type ConnectorHealthChangedData,
	type EventDataMap,
	type SearchExhaustedData,
	type SearchSuccessData,
	type SweepCompletedData,
	type SweepStartedData,
	type SyncCompletedData,
	type SyncFailedData,
	type UpdateAvailableData
} from './templates';
