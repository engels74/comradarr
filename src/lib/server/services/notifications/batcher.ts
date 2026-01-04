/**
 * Notification batching service.
 *
 * Processes pending notifications for batching-enabled channels, combining
 * similar events within the configured time window into digest notifications.
 * Also respects quiet hours configuration by deferring batch sends.
 *
 * @module services/notifications/batcher

 */

import type { NotificationChannel, NotificationHistory } from '$lib/server/db/schema';
import type {
	NotificationEventType,
	NotificationStatus
} from '$lib/server/db/queries/notifications';
import {
	getBatchingEnabledChannels,
	getPendingNotificationsForBatching,
	markNotificationsAsBatched,
	updateNotificationHistoryStatus,
	getDecryptedSensitiveConfig
} from '$lib/server/db/queries/notifications';
import { getSender, isSupportedChannelType } from './index';
import { buildAggregatePayload } from './aggregators';
import type { NotificationResult } from './types';
import { isInQuietHours } from './quiet-hours';
import { createLogger } from '$lib/server/logger';

const logger = createLogger('notification-batcher');

// =============================================================================
// Types
// =============================================================================

/**
 * Result of processing a single batch for a channel/event type.
 */
export interface BatchSendResult {
	channelId: number;
	eventType: NotificationEventType;
	notificationCount: number;
	batchId: string;
	success: boolean;
	error?: string;
}

/**
 * Result of processing batches for a single channel.
 */
export interface ChannelBatchResult {
	channelId: number;
	channelName: string;
	batchesSent: number;
	notificationsBatched: number;
	errors: number;
	results: BatchSendResult[];
}

/**
 * Overall result of batch processing.
 */
export interface BatchProcessingResult {
	channelsProcessed: number;
	batchesSent: number;
	notificationsBatched: number;
	errors: number;
	channelResults: ChannelBatchResult[];
}

// =============================================================================
// Constants
// =============================================================================

/** All event types that can be batched */
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

// =============================================================================
// NotificationBatcher Class
// =============================================================================

/**
 * Service for processing batched notifications.
 *
 * The batch processor runs periodically (via scheduler) and:
 * 1. Gets all channels with batching enabled
 * 2. For each channel, groups pending notifications by event type
 * 3. For event types where the oldest notification has waited beyond the window,
 *    builds an aggregate payload and sends it
 * 4. Marks processed notifications as 'batched' with a shared batchId
 *
 * @example
 * ```typescript
 * const batcher = new NotificationBatcher();
 * const result = await batcher.processBatches();
 *
 * console.log(`Processed ${result.batchesSent} batches`);
 * console.log(`Batched ${result.notificationsBatched} notifications`);
 * ```
 */
export class NotificationBatcher {
	/**
	 * Process all pending batches for all batching-enabled channels.
	 *
	 * @returns Processing result with statistics
	 */
	async processBatches(): Promise<BatchProcessingResult> {
		const result: BatchProcessingResult = {
			channelsProcessed: 0,
			batchesSent: 0,
			notificationsBatched: 0,
			errors: 0,
			channelResults: []
		};

		// Get all channels with batching enabled
		const channels = await getBatchingEnabledChannels();

		if (channels.length === 0) {
			return result;
		}

		// Process each channel
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

	/**
	 * Process pending batches for a single channel.
	 *
	 * @param channel - The channel to process
	 * @returns Channel processing result
	 */
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

		// Skip unsupported channel types
		if (!isSupportedChannelType(channel.type)) {
			return result;
		}

		// Process each event type
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

	/**
	 * Process a batch for a specific channel and event type.
	 *
	 * @param channel - The channel to send to
	 * @param eventType - The event type to batch
	 * @returns Batch send result, or null if no batch to process
	 */
	private async processBatchForEventType(
		channel: NotificationChannel,
		eventType: NotificationEventType
	): Promise<BatchSendResult | null> {
		const windowSeconds = channel.batchingWindowSeconds ?? 60;

		// Get pending notifications for this channel/event type
		const pending = await getPendingNotificationsForBatching(
			channel.id,
			eventType,
			// Fetch notifications older than window to include everything eligible
			// We use a large window to get all pending, then filter by age
			windowSeconds * 10 // Fetch up to 10x the window to catch old pending items
		);

		if (pending.length === 0) {
			return null;
		}

		// Check if the oldest notification has waited beyond the window
		const oldest = pending[0]!; // Already sorted by createdAt ASC
		const oldestAgeMs = Date.now() - new Date(oldest.createdAt).getTime();

		if (oldestAgeMs < windowSeconds * 1000) {
			// Not ready yet - still within the batching window
			return null;
		}

		// Check if currently in quiet hours (Requirement 9.4)
		// If so, defer sending until quiet hours end
		if (channel.quietHoursEnabled && isInQuietHours(channel)) {
			// Skip this batch - notifications will be sent when quiet hours end
			return null;
		}

		// Collect all pending notifications that should be included in this batch
		// Include all pending notifications for this event type
		const toBatch = pending;

		// Generate a unique batch ID
		const batchId = `batch_${channel.id}_${eventType}_${Date.now()}`;

		try {
			// Build aggregate payload
			const payload = buildAggregatePayload(eventType, toBatch);

			// Send the notification
			const sendResult = await this.sendBatchedNotification(channel, payload);

			if (sendResult.success) {
				// Mark all entries as batched
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
				// Mark notifications as failed (so they can be retried)
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

			// Mark notifications as failed
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

	/**
	 * Send a batched notification to a channel.
	 *
	 * @param channel - The channel to send to
	 * @param payload - The notification payload
	 * @returns Send result
	 */
	private async sendBatchedNotification(
		channel: NotificationChannel,
		payload: import('./types').NotificationPayload
	): Promise<NotificationResult> {
		const startTime = Date.now();

		try {
			// Decrypt sensitive configuration
			const sensitiveConfig = await getDecryptedSensitiveConfig(channel);

			// Get the appropriate sender
			const sender = getSender(channel.type);

			// Send the notification
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

// =============================================================================
// Singleton Instance
// =============================================================================

let batcherInstance: NotificationBatcher | null = null;

/**
 * Get the singleton NotificationBatcher instance.
 *
 * @returns The singleton batcher
 */
export function getNotificationBatcher(): NotificationBatcher {
	if (!batcherInstance) {
		batcherInstance = new NotificationBatcher();
	}
	return batcherInstance;
}

/**
 * Process all pending notification batches.
 *
 * Convenience function that uses the singleton batcher.
 *
 * @returns Processing result
 *
 * @example
 * ```typescript
 * const result = await processBatches();
 * if (result.errors > 0) {
 *   console.warn(`${result.errors} batch errors occurred`);
 * }
 * ```
 */
export async function processBatches(): Promise<BatchProcessingResult> {
	return getNotificationBatcher().processBatches();
}
