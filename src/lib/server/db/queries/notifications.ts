/**
 * Database queries for notification channel operations.
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 36.1
 *
 * Sensitive credentials (API keys, tokens, passwords) are encrypted using AES-256-GCM
 * before storage. Decryption happens lazily, only when needed for sending notifications.
 */

import { db } from '$lib/server/db';
import {
	notificationChannels,
	notificationHistory,
	type NotificationChannel,
	type NewNotificationChannel,
	type NotificationHistory,
	type NewNotificationHistory
} from '$lib/server/db/schema';
import { and, count, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { decrypt, DecryptionError, encrypt, SecretKeyError } from '$lib/server/crypto';

// Re-export crypto errors for consumers
export { DecryptionError, SecretKeyError };

// =============================================================================
// Types
// =============================================================================

/**
 * Supported notification channel types.
 */
export type NotificationChannelType =
	| 'discord'
	| 'telegram'
	| 'slack'
	| 'pushover'
	| 'gotify'
	| 'ntfy'
	| 'email'
	| 'webhook';

/**
 * Supported notification event types.
 */
export type NotificationEventType =
	| 'sweep_started'
	| 'sweep_completed'
	| 'search_success'
	| 'search_exhausted'
	| 'connector_health_changed'
	| 'sync_completed'
	| 'sync_failed'
	| 'app_started'
	| 'update_available';

/**
 * Notification status values.
 */
export type NotificationStatus = 'pending' | 'sent' | 'failed' | 'batched';

/**
 * Input for creating a new notification channel.
 */
export interface CreateNotificationChannelInput {
	name: string;
	type: NotificationChannelType;
	config?: Record<string, unknown>; // Non-sensitive configuration
	sensitiveConfig?: Record<string, unknown>; // Sensitive credentials (will be encrypted)
	enabled?: boolean;
	enabledEvents?: NotificationEventType[];
	batchingEnabled?: boolean;
	batchingWindowSeconds?: number;
	quietHoursEnabled?: boolean;
	quietHoursStart?: string; // HH:MM format
	quietHoursEnd?: string; // HH:MM format
	quietHoursTimezone?: string;
}

/**
 * Input for updating an existing notification channel.
 */
export interface UpdateNotificationChannelInput {
	name?: string;
	config?: Record<string, unknown>;
	sensitiveConfig?: Record<string, unknown>; // Will be encrypted if provided
	enabled?: boolean;
	enabledEvents?: NotificationEventType[];
	batchingEnabled?: boolean;
	batchingWindowSeconds?: number;
	quietHoursEnabled?: boolean;
	quietHoursStart?: string;
	quietHoursEnd?: string;
	quietHoursTimezone?: string;
}

/**
 * Input for creating a notification history entry.
 */
export interface CreateNotificationHistoryInput {
	channelId: number;
	eventType: NotificationEventType;
	eventData?: Record<string, unknown>;
	status?: NotificationStatus;
	batchId?: string;
}

// =============================================================================
// Notification Channel Queries
// =============================================================================

/**
 * Creates a new notification channel with encrypted sensitive credentials.
 *
 * @param input - Channel configuration with optional sensitive credentials
 * @returns Created notification channel
 * @throws SecretKeyError if SECRET_KEY is not configured and sensitiveConfig is provided
 */
export async function createNotificationChannel(
	input: CreateNotificationChannelInput
): Promise<NotificationChannel> {
	let configEncrypted: string | null = null;

	// Encrypt sensitive configuration if provided
	if (input.sensitiveConfig && Object.keys(input.sensitiveConfig).length > 0) {
		configEncrypted = await encrypt(JSON.stringify(input.sensitiveConfig));
	}

	const result = await db
		.insert(notificationChannels)
		.values({
			name: input.name,
			type: input.type,
			config: input.config ?? null,
			configEncrypted,
			enabled: input.enabled ?? true,
			enabledEvents: input.enabledEvents ?? null,
			batchingEnabled: input.batchingEnabled ?? false,
			batchingWindowSeconds: input.batchingWindowSeconds ?? 60,
			quietHoursEnabled: input.quietHoursEnabled ?? false,
			quietHoursStart: input.quietHoursStart ?? null,
			quietHoursEnd: input.quietHoursEnd ?? null,
			quietHoursTimezone: input.quietHoursTimezone ?? 'UTC'
		})
		.returning();

	return result[0]!;
}

/**
 * Gets a notification channel by ID.
 * Note: Sensitive config remains encrypted. Use getDecryptedSensitiveConfig() when needed.
 *
 * @param id - Channel ID
 * @returns Notification channel if found, null otherwise
 */
export async function getNotificationChannel(id: number): Promise<NotificationChannel | null> {
	const result = await db
		.select()
		.from(notificationChannels)
		.where(eq(notificationChannels.id, id))
		.limit(1);

	return result[0] ?? null;
}

/**
 * Gets all notification channels.
 * Note: Sensitive config remains encrypted.
 *
 * @returns Array of all notification channels
 */
export async function getAllNotificationChannels(): Promise<NotificationChannel[]> {
	return db.select().from(notificationChannels).orderBy(notificationChannels.name);
}

/**
 * Gets all enabled notification channels.
 * Note: Sensitive config remains encrypted.
 *
 * @returns Array of enabled notification channels
 */
export async function getEnabledNotificationChannels(): Promise<NotificationChannel[]> {
	return db
		.select()
		.from(notificationChannels)
		.where(eq(notificationChannels.enabled, true))
		.orderBy(notificationChannels.name);
}

/**
 * Gets enabled notification channels that have a specific event type enabled.
 * Used to determine which channels should receive a particular notification.
 *
 * @param eventType - The event type to filter by
 * @returns Array of channels that should receive this event type
 */
export async function getChannelsForEventType(
	eventType: NotificationEventType
): Promise<NotificationChannel[]> {
	// Get all enabled channels and filter in-memory for JSONB array contains
	const channels = await getEnabledNotificationChannels();

	return channels.filter((channel) => {
		const events = channel.enabledEvents as NotificationEventType[] | null;
		// If no events configured, don't send any notifications
		if (!events || !Array.isArray(events)) return false;
		return events.includes(eventType);
	});
}

/**
 * Gets notification channels by type.
 *
 * @param type - Channel type to filter by
 * @returns Array of channels of the specified type
 */
export async function getNotificationChannelsByType(
	type: NotificationChannelType
): Promise<NotificationChannel[]> {
	return db
		.select()
		.from(notificationChannels)
		.where(eq(notificationChannels.type, type))
		.orderBy(notificationChannels.name);
}

/**
 * Decrypts the sensitive configuration from a notification channel.
 * Call this only when actually sending notifications.
 *
 * @param channel - Notification channel with encrypted config
 * @returns Decrypted sensitive configuration, or empty object if none
 * @throws DecryptionError if decryption fails
 * @throws SecretKeyError if SECRET_KEY is not configured
 */
export async function getDecryptedSensitiveConfig(
	channel: NotificationChannel
): Promise<Record<string, unknown>> {
	if (!channel.configEncrypted) {
		return {};
	}

	const decrypted = await decrypt(channel.configEncrypted);
	return JSON.parse(decrypted) as Record<string, unknown>;
}

/**
 * Updates a notification channel.
 * If sensitiveConfig is provided, it will be encrypted before storage.
 *
 * @param id - Channel ID to update
 * @param input - Fields to update
 * @returns Updated channel, or null if not found
 * @throws SecretKeyError if SECRET_KEY is not configured (when updating sensitiveConfig)
 */
export async function updateNotificationChannel(
	id: number,
	input: UpdateNotificationChannelInput
): Promise<NotificationChannel | null> {
	const updateData: Partial<NewNotificationChannel> & { updatedAt: Date } = {
		updatedAt: new Date()
	};

	if (input.name !== undefined) {
		updateData.name = input.name;
	}

	if (input.config !== undefined) {
		updateData.config = input.config;
	}

	if (input.sensitiveConfig !== undefined) {
		if (Object.keys(input.sensitiveConfig).length > 0) {
			updateData.configEncrypted = await encrypt(JSON.stringify(input.sensitiveConfig));
		} else {
			updateData.configEncrypted = null;
		}
	}

	if (input.enabled !== undefined) {
		updateData.enabled = input.enabled;
	}

	if (input.enabledEvents !== undefined) {
		updateData.enabledEvents = input.enabledEvents;
	}

	if (input.batchingEnabled !== undefined) {
		updateData.batchingEnabled = input.batchingEnabled;
	}

	if (input.batchingWindowSeconds !== undefined) {
		updateData.batchingWindowSeconds = input.batchingWindowSeconds;
	}

	if (input.quietHoursEnabled !== undefined) {
		updateData.quietHoursEnabled = input.quietHoursEnabled;
	}

	if (input.quietHoursStart !== undefined) {
		updateData.quietHoursStart = input.quietHoursStart;
	}

	if (input.quietHoursEnd !== undefined) {
		updateData.quietHoursEnd = input.quietHoursEnd;
	}

	if (input.quietHoursTimezone !== undefined) {
		updateData.quietHoursTimezone = input.quietHoursTimezone;
	}

	const result = await db
		.update(notificationChannels)
		.set(updateData)
		.where(eq(notificationChannels.id, id))
		.returning();

	return result[0] ?? null;
}

/**
 * Deletes a notification channel.
 * Cascades to related notification history.
 *
 * @param id - Channel ID to delete
 * @returns true if deleted, false if not found
 */
export async function deleteNotificationChannel(id: number): Promise<boolean> {
	const result = await db
		.delete(notificationChannels)
		.where(eq(notificationChannels.id, id))
		.returning({ id: notificationChannels.id });

	return result.length > 0;
}

/**
 * Checks if a notification channel exists with the given name.
 *
 * @param name - Channel name to check
 * @param excludeId - Optional ID to exclude (for updates)
 * @returns true if a channel with this name exists
 */
export async function notificationChannelNameExists(
	name: string,
	excludeId?: number
): Promise<boolean> {
	const result = await db
		.select({ id: notificationChannels.id })
		.from(notificationChannels)
		.where(eq(notificationChannels.name, name))
		.limit(1);

	if (result.length === 0) return false;
	if (excludeId !== undefined && result[0]?.id === excludeId) return false;

	return true;
}

// =============================================================================
// Notification History Queries
// =============================================================================

/**
 * Creates a notification history entry.
 *
 * @param input - History entry data
 * @returns Created notification history entry
 */
export async function createNotificationHistory(
	input: CreateNotificationHistoryInput
): Promise<NotificationHistory> {
	const result = await db
		.insert(notificationHistory)
		.values({
			channelId: input.channelId,
			eventType: input.eventType,
			eventData: input.eventData ?? null,
			status: input.status ?? 'pending',
			batchId: input.batchId ?? null
		})
		.returning();

	return result[0]!;
}

/**
 * Updates the status of a notification history entry.
 *
 * @param id - History entry ID
 * @param status - New status
 * @param errorMessage - Optional error message (for failed status)
 * @returns Updated entry, or null if not found
 */
export async function updateNotificationHistoryStatus(
	id: number,
	status: NotificationStatus,
	errorMessage?: string
): Promise<NotificationHistory | null> {
	const updateData: Partial<NewNotificationHistory> = {
		status
	};

	if (status === 'sent') {
		updateData.sentAt = new Date();
	}

	if (errorMessage !== undefined) {
		updateData.errorMessage = errorMessage;
	}

	const result = await db
		.update(notificationHistory)
		.set(updateData)
		.where(eq(notificationHistory.id, id))
		.returning();

	return result[0] ?? null;
}

/**
 * Gets notification history for a specific channel.
 *
 * @param channelId - Channel ID
 * @param limit - Maximum number of entries to return (default 50)
 * @returns Array of notification history entries
 */
export async function getNotificationHistoryForChannel(
	channelId: number,
	limit: number = 50
): Promise<NotificationHistory[]> {
	return db
		.select()
		.from(notificationHistory)
		.where(eq(notificationHistory.channelId, channelId))
		.orderBy(desc(notificationHistory.createdAt))
		.limit(limit);
}

/**
 * Gets recent notification history across all channels.
 *
 * @param limit - Maximum number of entries to return (default 50)
 * @returns Array of notification history entries
 */
export async function getRecentNotificationHistory(limit: number = 50): Promise<NotificationHistory[]> {
	return db
		.select()
		.from(notificationHistory)
		.orderBy(desc(notificationHistory.createdAt))
		.limit(limit);
}

/**
 * Gets pending notifications that are ready to be batched.
 * Returns entries with status 'pending' that are within the batching window.
 *
 * @param channelId - Channel ID
 * @param eventType - Event type to batch
 * @param windowSeconds - Batching window in seconds
 * @returns Array of pending notifications within the window
 */
export async function getPendingNotificationsForBatching(
	channelId: number,
	eventType: NotificationEventType,
	windowSeconds: number
): Promise<NotificationHistory[]> {
	const windowStart = new Date(Date.now() - windowSeconds * 1000);

	return db
		.select()
		.from(notificationHistory)
		.where(
			and(
				eq(notificationHistory.channelId, channelId),
				eq(notificationHistory.eventType, eventType),
				eq(notificationHistory.status, 'pending'),
				gte(notificationHistory.createdAt, windowStart)
			)
		)
		.orderBy(notificationHistory.createdAt);
}

/**
 * Marks multiple notification history entries as batched.
 *
 * @param ids - Array of history entry IDs
 * @param batchId - Batch ID to assign
 * @returns Number of entries updated
 */
export async function markNotificationsAsBatched(ids: number[], batchId: string): Promise<number> {
	if (ids.length === 0) return 0;

	const result = await db
		.update(notificationHistory)
		.set({
			status: 'batched',
			batchId
		})
		.where(inArray(notificationHistory.id, ids))
		.returning({ id: notificationHistory.id });

	return result.length;
}

/**
 * Gets notification history entries by batch ID.
 *
 * @param batchId - Batch ID
 * @returns Array of notification history entries in the batch
 */
export async function getNotificationsByBatchId(batchId: string): Promise<NotificationHistory[]> {
	return db
		.select()
		.from(notificationHistory)
		.where(eq(notificationHistory.batchId, batchId))
		.orderBy(notificationHistory.createdAt);
}

/**
 * Gets notification statistics for a channel.
 */
export interface NotificationChannelStats {
	channelId: number;
	totalSent: number;
	totalFailed: number;
	totalBatched: number;
	totalPending: number;
}

/**
 * Gets notification statistics for a channel.
 *
 * @param channelId - Channel ID
 * @returns Statistics for the channel
 */
export async function getNotificationChannelStats(
	channelId: number
): Promise<NotificationChannelStats> {
	const result = await db
		.select({
			status: notificationHistory.status,
			count: count()
		})
		.from(notificationHistory)
		.where(eq(notificationHistory.channelId, channelId))
		.groupBy(notificationHistory.status);

	const stats: NotificationChannelStats = {
		channelId,
		totalSent: 0,
		totalFailed: 0,
		totalBatched: 0,
		totalPending: 0
	};

	for (const row of result) {
		switch (row.status) {
			case 'sent':
				stats.totalSent = row.count;
				break;
			case 'failed':
				stats.totalFailed = row.count;
				break;
			case 'batched':
				stats.totalBatched = row.count;
				break;
			case 'pending':
				stats.totalPending = row.count;
				break;
		}
	}

	return stats;
}

/**
 * Deletes old notification history entries.
 * Used for database cleanup/maintenance.
 *
 * @param olderThanDays - Delete entries older than this many days
 * @returns Number of entries deleted
 */
export async function pruneNotificationHistory(olderThanDays: number): Promise<number> {
	const cutoffDate = new Date();
	cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

	const result = await db
		.delete(notificationHistory)
		.where(sql`${notificationHistory.createdAt} < ${cutoffDate}`)
		.returning({ id: notificationHistory.id });

	return result.length;
}
