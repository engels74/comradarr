/**
 * Notification dispatcher service.
 * @module services/notifications/dispatcher
 */

import type { NotificationEventType } from '$lib/server/db/queries/notifications';
import {
	createNotificationHistory,
	getChannelsForEventType,
	getDecryptedSensitiveConfig,
	getNotificationChannel,
	updateNotificationHistoryStatus
} from '$lib/server/db/queries/notifications';
import type { NotificationChannel } from '$lib/server/db/schema';
import { createLogger } from '$lib/server/logger';
import { isRetryableNotificationError } from './errors';
import { getSender, isSupportedChannelType } from './index';
import { isInQuietHours } from './quiet-hours';
import { buildPayload, type EventDataMap } from './templates';
import type { NotificationPayload, NotificationResult } from './types';

const logger = createLogger('notifications');

export interface DispatchResult {
	/** The event type that was dispatched */
	eventType: NotificationEventType;
	/** Results from each channel */
	channelResults: NotificationResult[];
	/** Total number of channels that were targeted */
	totalChannels: number;
	/** Number of channels that received the notification successfully */
	successCount: number;
	/** Number of channels that failed to receive the notification */
	failureCount: number;
	/** Number of channels that were skipped (unsupported type) */
	skippedCount: number;
	/** Number of channels where notification was queued for batching */
	batchedCount: number;
	/** Number of channels where notification was suppressed due to quiet hours */
	quietHoursSuppressedCount: number;
}

/**
 * Options for the dispatch operation.
 */
export interface DispatchOptions {
	/** Skip recording history entries (for testing) */
	skipHistory?: boolean;
}

export class NotificationDispatcher {
	/** Dispatch a notification to all enabled channels configured for the event type. */
	async dispatch<T extends NotificationEventType>(
		eventType: T,
		eventData: EventDataMap[T],
		options?: DispatchOptions
	): Promise<DispatchResult> {
		const payload = buildPayload(eventType, eventData);
		const channels = await getChannelsForEventType(eventType);

		const result: DispatchResult = {
			eventType,
			channelResults: [],
			totalChannels: channels.length,
			successCount: 0,
			failureCount: 0,
			skippedCount: 0,
			batchedCount: 0,
			quietHoursSuppressedCount: 0
		};

		if (channels.length === 0) {
			return result;
		}

		const sendPromises = channels.map(async (channel) => {
			if (channel.quietHoursEnabled && isInQuietHours(channel)) {
				const stored = await this.storeForBatching(channel, eventType, eventData);
				return { type: 'quiet_hours' as const, success: stored };
			}

			if (channel.batchingEnabled) {
				const stored = await this.storeForBatching(channel, eventType, eventData);
				return { type: 'batched' as const, success: stored };
			}

			const sendResult = await this.sendToChannelInternal(channel, payload, options);
			return { type: 'sent' as const, result: sendResult };
		});

		const channelResults = await Promise.all(sendPromises);

		for (const channelResult of channelResults) {
			if (channelResult.type === 'quiet_hours') {
				if (channelResult.success) {
					result.quietHoursSuppressedCount++;
				} else {
					result.failureCount++;
				}
			} else if (channelResult.type === 'batched') {
				if (channelResult.success) {
					result.batchedCount++;
				} else {
					result.failureCount++;
				}
			} else {
				if (channelResult.result === null) {
					result.skippedCount++;
				} else {
					result.channelResults.push(channelResult.result);
					if (channelResult.result.success) {
						result.successCount++;
					} else {
						result.failureCount++;
					}
				}
			}
		}

		return result;
	}

	/** Store a notification for later batching instead of sending immediately. */
	private async storeForBatching<T extends NotificationEventType>(
		channel: NotificationChannel,
		eventType: T,
		eventData: EventDataMap[T]
	): Promise<boolean> {
		try {
			await createNotificationHistory({
				channelId: channel.id,
				eventType,
				eventData: eventData as Record<string, unknown>,
				status: 'pending'
			});
			return true;
		} catch (error) {
			logger.error('Failed to store notification for batching', {
				channelId: channel.id,
				channelName: channel.name,
				eventType,
				error: error instanceof Error ? error.message : String(error)
			});
			return false;
		}
	}

	/** Send a notification to a specific channel by ID. */
	async sendToChannel(
		channelId: number,
		payload: NotificationPayload,
		options?: DispatchOptions
	): Promise<NotificationResult> {
		const channel = await getNotificationChannel(channelId);

		if (!channel) {
			return {
				success: false,
				channelId,
				channelType: 'unknown',
				error: 'Channel not found',
				durationMs: 0
			};
		}

		const result = await this.sendToChannelInternal(channel, payload, options);

		if (result === null) {
			return {
				success: false,
				channelId,
				channelType: channel.type,
				error: `Channel type '${channel.type}' is not yet supported`,
				durationMs: 0
			};
		}

		return result;
	}

	private async sendToChannelInternal(
		channel: NotificationChannel,
		payload: NotificationPayload,
		options?: DispatchOptions
	): Promise<NotificationResult | null> {
		if (!isSupportedChannelType(channel.type)) {
			return null;
		}

		let historyId: number | undefined;
		if (!options?.skipHistory) {
			try {
				const historyInput: Parameters<typeof createNotificationHistory>[0] = {
					channelId: channel.id,
					eventType: payload.eventType,
					status: 'pending'
				};
				if (payload.eventData) {
					historyInput.eventData = payload.eventData;
				}
				const historyEntry = await createNotificationHistory(historyInput);
				historyId = historyEntry.id;
			} catch {
				// History creation failed, but continue with send
			}
		}

		try {
			const sensitiveConfig = await getDecryptedSensitiveConfig(channel);
			const sender = getSender(channel.type);
			const result = await sender.send(channel, sensitiveConfig, payload);

			if (historyId !== undefined) {
				await this.updateHistory(historyId, result);
			}

			return result;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : 'Unknown error';
			const isRetryable = isRetryableNotificationError(error);

			const result: NotificationResult = {
				success: false,
				channelId: channel.id,
				channelType: channel.type,
				error: errorMessage,
				durationMs: 0
			};

			if (historyId !== undefined) {
				await this.updateHistory(historyId, result);
			}

			if (isRetryable) {
				logger.warn('Retryable error sending notification', {
					channelName: channel.name,
					error: errorMessage
				});
			} else {
				logger.error('Failed to send notification', {
					channelName: channel.name,
					error: errorMessage
				});
			}

			return result;
		}
	}

	/**
	 * Update history entry with send result.
	 */
	private async updateHistory(historyId: number, result: NotificationResult): Promise<void> {
		try {
			await updateNotificationHistoryStatus(
				historyId,
				result.success ? 'sent' : 'failed',
				result.error
			);
		} catch {
			// History update failed, log but don't throw
			logger.warn('Failed to update history entry', { historyId });
		}
	}
}

let dispatcherInstance: NotificationDispatcher | null = null;

/** Get the singleton NotificationDispatcher instance. */
export function getNotificationDispatcher(): NotificationDispatcher {
	if (!dispatcherInstance) {
		dispatcherInstance = new NotificationDispatcher();
	}
	return dispatcherInstance;
}

/** Send a notification for an event to all configured channels. */
export async function notify<T extends NotificationEventType>(
	eventType: T,
	eventData: EventDataMap[T]
): Promise<DispatchResult> {
	return getNotificationDispatcher().dispatch(eventType, eventData);
}
