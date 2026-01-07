import type { NotificationChannel } from '$lib/server/db/schema';
import type { NotificationPayload, NotificationResult, NotificationSenderConfig } from './types';

export interface NotificationSender {
	send(
		channel: NotificationChannel,
		sensitiveConfig: Record<string, unknown>,
		payload: NotificationPayload
	): Promise<NotificationResult>;

	test(
		channel: NotificationChannel,
		sensitiveConfig: Record<string, unknown>
	): Promise<NotificationResult>;
}

export const DEFAULT_SENDER_CONFIG: Required<NotificationSenderConfig> = {
	timeout: 30000, // 30 seconds
	userAgent: 'Comradarr/1.0',
	retry: {
		maxRetries: 2,
		baseDelay: 1000, // 1 second
		maxDelay: 10000 // 10 seconds
	}
};

// Used by Discord and Slack for embed colors
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

export function hexColorToInt(hex: string): number {
	return parseInt(hex.replace('#', ''), 16);
}

export function getEventColor(eventType: string): string {
	return EVENT_COLORS[eventType] ?? '#7289da';
}
