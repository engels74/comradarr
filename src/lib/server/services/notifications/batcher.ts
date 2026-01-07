// Combines similar events within configured time window into digest notifications

import type {
	NotificationEventType,
	NotificationStatus
} from '$lib/server/db/queries/notifications';
import {
	getBatchingEnabledChannels,
	getDecryptedSensitiveConfig,
	getPendingNotificationsForBatching,
	markNotificationsAsBatched,
	updateNotificationHistoryStatus
} from '$lib/server/db/queries/notifications';
import type { NotificationChannel } from '$lib/server/db/schema';
import { createLogger } from '$lib/server/logger';
import { buildAggregatePayload } from './aggregators';
import { getSender, isSupportedChannelType } from './index';
import { isInQuietHours } from './quiet-hours';
import type { NotificationResult } from './types';

const logger = createLogger('notification-batcher');

export interface BatchSendResult {
	channelId: number;
	eventType: NotificationEventType;
	notificationCount: number;
	batchId: string;
	success: boolean;
	error?: string;
}

export interface ChannelBatchResult {
	channelId: number;
	channelName: string;
	batchesSent: number;
	notificationsBatched: number;
	errors: number;
	results: BatchSendResult[];
}

export interface BatchProcessingResult {
	channelsProcessed: number;
	batchesSent: number;
	notificationsBatched: number;
	errors: number;
	channelResults: ChannelBatchResult[];
}

const BATCHABLE_EVENT_TYPES: NotificationEventType[] = [
	'sweep_started',
	'sweep_completed',
	'search_success',
	'search_exhausted',
	'connector_health_changed',
	'sync_completed',
	'sync_failed',
	'app_started',
	'update_available'
];

export class NotificationBatcher {
	async processBatches(): Promise<BatchProcessingResult> {
		const result: BatchProcessingResult = {
			channelsProcessed: 0,
			batchesSent: 0,
			notificationsBatched: 0,
			errors: 0,
			channelResults: []
		};

		const channels = await getBatchingEnabledChannels();

		if (channels.length === 0) {
			return result;
		}

		for (const channel of channels) {
			try {
				const channelResult = await this.processBatchesForChannel(channel);
				result.channelResults.push(channelResult);
				result.channelsProcessed++;
				result.batchesSent += channelResult.batchesSent;
				result.notificationsBatched += channelResult.notificationsBatched;
				result.errors += channelResult.errors;
			} catch (error) {
				result.errors++;
				logger.error('Error processing channel', {
					channelId: channel.id,
					channelName: channel.name,
					error: error instanceof Error ? error.message : String(error)
				});
			}
		}

		return result;
	}

	private async processBatchesForChannel(
		channel: NotificationChannel
	): Promise<ChannelBatchResult> {
		const result: ChannelBatchResult = {
			channelId: channel.id,
			channelName: channel.name,
			batchesSent: 0,
			notificationsBatched: 0,
			errors: 0,
			results: []
		};

		if (!isSupportedChannelType(channel.type)) {
			return result;
		}

		for (const eventType of BATCHABLE_EVENT_TYPES) {
			try {
				const batchResult = await this.processBatchForEventType(channel, eventType);

				if (batchResult) {
					result.results.push(batchResult);

					if (batchResult.success) {
						result.batchesSent++;
						result.notificationsBatched += batchResult.notificationCount;
					} else {
						result.errors++;
					}
				}
			} catch (error) {
				result.errors++;
				logger.error('Error processing event type', {
					channelId: channel.id,
					eventType,
					error: error instanceof Error ? error.message : String(error)
				});
			}
		}

		return result;
	}

	private async processBatchForEventType(
		channel: NotificationChannel,
		eventType: NotificationEventType
	): Promise<BatchSendResult | null> {
		const windowSeconds = channel.batchingWindowSeconds ?? 60;

		// Fetch up to 10x the window to catch old pending items
		const pending = await getPendingNotificationsForBatching(
			channel.id,
			eventType,
			windowSeconds * 10
		);

		if (pending.length === 0) {
			return null;
		}

		const oldest = pending[0]!;
		const oldestAgeMs = Date.now() - new Date(oldest.createdAt).getTime();

		if (oldestAgeMs < windowSeconds * 1000) {
			return null;
		}

		if (channel.quietHoursEnabled && isInQuietHours(channel)) {
			return null;
		}

		const toBatch = pending;
		const batchId = `batch_${channel.id}_${eventType}_${Date.now()}`;

		try {
			const payload = buildAggregatePayload(eventType, toBatch);
			const sendResult = await this.sendBatchedNotification(channel, payload);

			if (sendResult.success) {
				const ids = toBatch.map((n) => n.id);
				await markNotificationsAsBatched(ids, batchId);

				return {
					channelId: channel.id,
					eventType,
					notificationCount: toBatch.length,
					batchId,
					success: true
				};
			} else {
				const errorMsg = sendResult.error ?? 'Unknown error';
				for (const entry of toBatch) {
					await updateNotificationHistoryStatus(entry.id, 'failed' as NotificationStatus, errorMsg);
				}

				return {
					channelId: channel.id,
					eventType,
					notificationCount: toBatch.length,
					batchId,
					success: false,
					error: errorMsg
				};
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);

			for (const entry of toBatch) {
				await updateNotificationHistoryStatus(
					entry.id,
					'failed' as NotificationStatus,
					errorMessage
				);
			}

			return {
				channelId: channel.id,
				eventType,
				notificationCount: toBatch.length,
				batchId,
				success: false,
				error: errorMessage
			};
		}
	}

	private async sendBatchedNotification(
		channel: NotificationChannel,
		payload: import('./types').NotificationPayload
	): Promise<NotificationResult> {
		const startTime = Date.now();

		try {
			const sensitiveConfig = await getDecryptedSensitiveConfig(channel);
			const sender = getSender(channel.type);
			return await sender.send(channel, sensitiveConfig, payload);
		} catch (error) {
			return {
				success: false,
				channelId: channel.id,
				channelType: channel.type,
				error: error instanceof Error ? error.message : String(error),
				durationMs: Date.now() - startTime
			};
		}
	}
}

let batcherInstance: NotificationBatcher | null = null;

export function getNotificationBatcher(): NotificationBatcher {
	if (!batcherInstance) {
		batcherInstance = new NotificationBatcher();
	}
	return batcherInstance;
}

export async function processBatches(): Promise<BatchProcessingResult> {
	return getNotificationBatcher().processBatches();
}
