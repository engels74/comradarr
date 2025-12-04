/**
 * Notification dispatcher service.
 *
 * Orchestrates sending notifications to all enabled channels for an event type.
 * Handles:
 * - Getting channels configured for the event type
 * - Building payloads from event data using templates
 * - Sending to each channel via channel senders
 * - Recording results in notification history
 * - Quiet hours suppression (Requirement 9.4)
 *
 * @module services/notifications/dispatcher
 * @requirements 9.2, 9.4, 36.3
 */

import type { NotificationChannel } from '$lib/server/db/schema';
import type { NotificationEventType } from '$lib/server/db/queries/notifications';
import {
	getChannelsForEventType,
	getNotificationChannel,
	getDecryptedSensitiveConfig,
	createNotificationHistory,
	updateNotificationHistoryStatus
} from '$lib/server/db/queries/notifications';
import { getSender, isSupportedChannelType } from './index';
import { buildPayload, type EventDataMap } from './templates';
import type { NotificationPayload, NotificationResult } from './types';
import { isRetryableNotificationError } from './errors';
import { isInQuietHours } from './quiet-hours';

// =============================================================================
// Types
// =============================================================================

/**
 * Result of dispatching a notification to all channels.
 */
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
	/** Number of channels where notification was suppressed due to quiet hours (Requirement 9.4) */
	quietHoursSuppressedCount: number;
}

/**
 * Options for the dispatch operation.
 */
export interface DispatchOptions {
	/** Skip recording history entries (for testing) */
	skipHistory?: boolean;
}

// =============================================================================
// Notification Dispatcher Class
// =============================================================================

/**
 * Dispatcher service for sending notifications to configured channels.
 *
 * @example
 * ```typescript
 * const dispatcher = new NotificationDispatcher();
 *
 * // Dispatch to all channels configured for sweep_completed
 * const result = await dispatcher.dispatch('sweep_completed', {
 *   connectorId: 1,
 *   connectorName: 'Sonarr',
 *   gapsFound: 15,
 *   itemsQueued: 10
 * });
 *
 * console.log(`Sent to ${result.successCount}/${result.totalChannels} channels`);
 * ```
 */
export class NotificationDispatcher {
	/**
	 * Dispatch a notification to all enabled channels configured for the event type.
	 *
	 * @param eventType - The type of event
	 * @param eventData - Event-specific data for building the payload
	 * @param options - Optional dispatch configuration
	 * @returns Aggregated results from all channels
	 */
	async dispatch<T extends NotificationEventType>(
		eventType: T,
		eventData: EventDataMap[T],
		options?: DispatchOptions
	): Promise<DispatchResult> {
		// Build the notification payload from event data
		const payload = buildPayload(eventType, eventData);

		// Get all channels configured to receive this event type
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

		// No channels configured for this event type
		if (channels.length === 0) {
			return result;
		}

		// Process each channel - check quiet hours, batching, or send immediately
		const sendPromises = channels.map(async (channel) => {
			// Check if in quiet hours for this channel (Requirement 9.4)
			if (channel.quietHoursEnabled && isInQuietHours(channel)) {
				// Store as pending for later (will be sent when quiet hours end)
				const stored = await this.storeForBatching(channel, eventType, eventData);
				return { type: 'quiet_hours' as const, success: stored };
			}

			// Check if batching is enabled for this channel (Requirement 9.3)
			if (channel.batchingEnabled) {
				// Store as pending for later batching
				const stored = await this.storeForBatching(channel, eventType, eventData);
				return { type: 'batched' as const, success: stored };
			}

			// Send immediately
			const sendResult = await this.sendToChannelInternal(channel, payload, options);
			return { type: 'sent' as const, result: sendResult };
		});

		const channelResults = await Promise.all(sendPromises);

		// Aggregate results
		for (const channelResult of channelResults) {
			if (channelResult.type === 'quiet_hours') {
				// Notification was suppressed due to quiet hours (Requirement 9.4)
				if (channelResult.success) {
					result.quietHoursSuppressedCount++;
				} else {
					result.failureCount++;
				}
			} else if (channelResult.type === 'batched') {
				// Notification was stored for batching
				if (channelResult.success) {
					result.batchedCount++;
				} else {
					result.failureCount++;
				}
			} else {
				// Notification was sent immediately
				if (channelResult.result === null) {
					// Channel was skipped (unsupported type)
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

	/**
	 * Store a notification for batching (Requirement 9.3).
	 *
	 * Instead of sending immediately, store the notification as pending
	 * in notification history. The batch processor will send it later.
	 *
	 * @param channel - The channel to store for
	 * @param eventType - The event type
	 * @param eventData - The event data
	 * @returns true if stored successfully
	 */
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
			console.error('[Notifications] Failed to store notification for batching:', {
				channelId: channel.id,
				channelName: channel.name,
				eventType,
				error: error instanceof Error ? error.message : String(error)
			});
			return false;
		}
	}

	/**
	 * Send a notification to a specific channel by ID.
	 *
	 * Useful for testing channel configuration or manual sends.
	 *
	 * @param channelId - The channel ID to send to
	 * @param payload - The notification payload to send
	 * @param options - Optional dispatch configuration
	 * @returns The result of the send operation
	 * @throws Error if channel is not found
	 */
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

		// If channel was skipped, return a failure result
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

	/**
	 * Internal method to send to a single channel.
	 *
	 * @param channel - The channel to send to
	 * @param payload - The notification payload
	 * @param options - Optional dispatch configuration
	 * @returns NotificationResult or null if channel type is not supported
	 */
	private async sendToChannelInternal(
		channel: NotificationChannel,
		payload: NotificationPayload,
		options?: DispatchOptions
	): Promise<NotificationResult | null> {
		// Check if channel type is supported
		if (!isSupportedChannelType(channel.type)) {
			// Skip unsupported channel types gracefully
			return null;
		}

		// Create history entry before sending (unless skipped)
		let historyId: number | undefined;
		if (!options?.skipHistory) {
			try {
				const historyInput: Parameters<typeof createNotificationHistory>[0] = {
					channelId: channel.id,
					eventType: payload.eventType,
					status: 'pending'
				};
				// Only include eventData if it exists
				if (payload.eventData) {
					historyInput.eventData = payload.eventData;
				}
				const historyEntry = await createNotificationHistory(historyInput);
				historyId = historyEntry.id;
			} catch {
				// History creation failed, but continue with send
				// This shouldn't block notification delivery
			}
		}

		try {
			// Decrypt sensitive configuration
			const sensitiveConfig = await getDecryptedSensitiveConfig(channel);

			// Get the appropriate sender
			const sender = getSender(channel.type);

			// Send the notification
			const result = await sender.send(channel, sensitiveConfig, payload);

			// Update history entry with result
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

			// Update history entry with failure
			if (historyId !== undefined) {
				await this.updateHistory(historyId, result);
			}

			// Log for debugging (retryable errors are less severe)
			if (isRetryable) {
				console.warn(`[Notifications] Retryable error sending to ${channel.name}: ${errorMessage}`);
			} else {
				console.error(`[Notifications] Failed to send to ${channel.name}: ${errorMessage}`);
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
			console.warn(`[Notifications] Failed to update history entry ${historyId}`);
		}
	}
}

// =============================================================================
// Singleton Instance
// =============================================================================

/**
 * Singleton dispatcher instance for convenience.
 */
let dispatcherInstance: NotificationDispatcher | null = null;

/**
 * Get the singleton NotificationDispatcher instance.
 *
 * @returns The shared dispatcher instance
 */
export function getNotificationDispatcher(): NotificationDispatcher {
	if (!dispatcherInstance) {
		dispatcherInstance = new NotificationDispatcher();
	}
	return dispatcherInstance;
}

// =============================================================================
// Convenience Function
// =============================================================================

/**
 * Send a notification for an event to all configured channels.
 *
 * This is a convenience function that uses the singleton dispatcher.
 *
 * @param eventType - The type of event
 * @param eventData - Event-specific data for building the payload
 * @returns Aggregated results from all channels
 *
 * @example
 * ```typescript
 * import { notify } from '$lib/server/services/notifications';
 *
 * // Simple notification
 * await notify('sweep_completed', {
 *   connectorId: 1,
 *   connectorName: 'Sonarr',
 *   gapsFound: 15,
 *   itemsQueued: 10
 * });
 *
 * // With result handling
 * const result = await notify('search_success', {
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
export async function notify<T extends NotificationEventType>(
	eventType: T,
	eventData: EventDataMap[T]
): Promise<DispatchResult> {
	return getNotificationDispatcher().dispatch(eventType, eventData);
}
