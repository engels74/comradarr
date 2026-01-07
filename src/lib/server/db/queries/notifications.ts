import { and, count, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { DecryptionError, decrypt, encrypt, SecretKeyError } from '$lib/server/crypto';
import { db } from '$lib/server/db';
import {
	type NewNotificationChannel,
	type NewNotificationHistory,
	type NotificationChannel,
	type NotificationHistory,
	notificationChannels,
	notificationHistory
} from '$lib/server/db/schema';

export { DecryptionError, SecretKeyError };

export type NotificationChannelType =
	| 'discord'
	| 'telegram'
	| 'slack'
	| 'pushover'
	| 'gotify'
	| 'ntfy'
	| 'email'
	| 'webhook';

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

export type NotificationStatus = 'pending' | 'sent' | 'failed' | 'batched';

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

export interface CreateNotificationHistoryInput {
	channelId: number;
	eventType: NotificationEventType;
	eventData?: Record<string, unknown>;
	status?: NotificationStatus;
	batchId?: string;
}

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

export async function getNotificationChannel(id: number): Promise<NotificationChannel | null> {
	const result = await db
		.select()
		.from(notificationChannels)
		.where(eq(notificationChannels.id, id))
		.limit(1);

	return result[0] ?? null;
}

export async function getAllNotificationChannels(): Promise<NotificationChannel[]> {
	return db.select().from(notificationChannels).orderBy(notificationChannels.name);
}

export async function getEnabledNotificationChannels(): Promise<NotificationChannel[]> {
	return db
		.select()
		.from(notificationChannels)
		.where(eq(notificationChannels.enabled, true))
		.orderBy(notificationChannels.name);
}

export async function getBatchingEnabledChannels(): Promise<NotificationChannel[]> {
	return db
		.select()
		.from(notificationChannels)
		.where(
			and(eq(notificationChannels.enabled, true), eq(notificationChannels.batchingEnabled, true))
		)
		.orderBy(notificationChannels.id);
}

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

export async function getNotificationChannelsByType(
	type: NotificationChannelType
): Promise<NotificationChannel[]> {
	return db
		.select()
		.from(notificationChannels)
		.where(eq(notificationChannels.type, type))
		.orderBy(notificationChannels.name);
}

export async function getDecryptedSensitiveConfig(
	channel: NotificationChannel
): Promise<Record<string, unknown>> {
	if (!channel.configEncrypted) {
		return {};
	}

	const decrypted = await decrypt(channel.configEncrypted);
	return JSON.parse(decrypted) as Record<string, unknown>;
}

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

export async function deleteNotificationChannel(id: number): Promise<boolean> {
	const result = await db
		.delete(notificationChannels)
		.where(eq(notificationChannels.id, id))
		.returning({ id: notificationChannels.id });

	return result.length > 0;
}

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

export async function getRecentNotificationHistory(
	limit: number = 50
): Promise<NotificationHistory[]> {
	return db
		.select()
		.from(notificationHistory)
		.orderBy(desc(notificationHistory.createdAt))
		.limit(limit);
}

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

export async function getNotificationsByBatchId(batchId: string): Promise<NotificationHistory[]> {
	return db
		.select()
		.from(notificationHistory)
		.where(eq(notificationHistory.batchId, batchId))
		.orderBy(notificationHistory.createdAt);
}

export interface NotificationChannelStats {
	channelId: number;
	totalSent: number;
	totalFailed: number;
	totalBatched: number;
	totalPending: number;
}

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

export async function pruneNotificationHistory(olderThanDays: number): Promise<number> {
	const cutoffDate = new Date();
	cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

	const result = await db
		.delete(notificationHistory)
		.where(sql`${notificationHistory.createdAt} < ${cutoffDate}`)
		.returning({ id: notificationHistory.id });

	return result.length;
}
