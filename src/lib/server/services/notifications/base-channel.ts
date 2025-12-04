/**
 * Base interface and default configuration for notification channel implementations.
 *
 * @module services/notifications/base-channel
 * @requirements 36.2
 */

import type { NotificationChannel } from '$lib/server/db/schema';
import type { NotificationPayload, NotificationResult, NotificationSenderConfig } from './types';

// =============================================================================
// NotificationSender Interface
// =============================================================================

/**
 * Interface that all notification channel implementations must implement.
 */
export interface NotificationSender {
	/**
	 * Send a notification through this channel.
	 *
	 * @param channel - The channel configuration from database
	 * @param sensitiveConfig - Decrypted sensitive configuration
	 * @param payload - The notification payload to send
	 * @returns Result of the send operation
	 */
	send(
		channel: NotificationChannel,
		sensitiveConfig: Record<string, unknown>,
		payload: NotificationPayload
	): Promise<NotificationResult>;

	/**
	 * Test the channel configuration by sending a test notification.
	 *
	 * @param channel - The channel configuration
	 * @param sensitiveConfig - Decrypted sensitive configuration
	 * @returns Result indicating if the test was successful
	 */
	test(
		channel: NotificationChannel,
		sensitiveConfig: Record<string, unknown>
	): Promise<NotificationResult>;
}

// =============================================================================
// Default Configuration
// =============================================================================

/**
 * Default configuration for notification senders.
 */
export const DEFAULT_SENDER_CONFIG: Required<NotificationSenderConfig> = {
	timeout: 30000, // 30 seconds
	userAgent: 'Comradarr/1.0',
	retry: {
		maxRetries: 2,
		baseDelay: 1000, // 1 second
		maxDelay: 10000 // 10 seconds
	}
};

// =============================================================================
// Color Mapping
// =============================================================================

/**
 * Default colors for notification event types.
 * Used by channels that support colored notifications (Discord, Slack).
 */
export const EVENT_COLORS: Record<string, string> = {
	sweep_started: '#3498db', // Blue
	sweep_completed: '#2ecc71', // Green
	search_success: '#27ae60', // Dark green
	search_exhausted: '#e74c3c', // Red
	connector_health_changed: '#f39c12', // Orange
	sync_completed: '#9b59b6', // Purple
	sync_failed: '#e74c3c', // Red
	app_started: '#1abc9c', // Teal
	update_available: '#f1c40f' // Yellow
};

/**
 * Convert hex color string to integer (for Discord embeds).
 */
export function hexColorToInt(hex: string): number {
	return parseInt(hex.replace('#', ''), 16);
}

/**
 * Get the color for an event type.
 * Falls back to a default blue color if event type is unknown.
 */
export function getEventColor(eventType: string): string {
	return EVENT_COLORS[eventType] ?? '#7289da';
}
