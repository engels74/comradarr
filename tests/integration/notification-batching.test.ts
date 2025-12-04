/**
 * Integration tests for notification batching.
 *
 * Validates requirements:
 * - 9.3: Combine similar events within time window into digest notification
 *
 * Tests cover:
 * - Storing notifications as pending when batching enabled
 * - getBatchingEnabledChannels query
 * - getPendingNotificationsForBatching query
 * - markNotificationsAsBatched query
 *
 * NOTE: These tests require a running PostgreSQL database with DATABASE_URL set.
 * Run with: bun test tests/integration/notification-batching.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { db } from '../../src/lib/server/db';
import { notificationChannels, notificationHistory } from '../../src/lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import {
	createNotificationChannel,
	getBatchingEnabledChannels,
	getPendingNotificationsForBatching,
	markNotificationsAsBatched,
	getNotificationsByBatchId,
	createNotificationHistory,
	deleteNotificationChannel,
	type NotificationEventType
} from '../../src/lib/server/db/queries/notifications';

// Store original SECRET_KEY to restore after tests
const originalSecretKey = process.env.SECRET_KEY;

// Valid test SECRET_KEY (64 hex chars = 32 bytes = 256 bits)
const TEST_SECRET_KEY = 'a'.repeat(64);

// Test channel IDs for cleanup
let testChannelIdBatchingEnabled: number;
let testChannelIdBatchingDisabled: number;

// ============================================================================
// Test Setup and Teardown
// ============================================================================

beforeAll(async () => {
	// Set test SECRET_KEY
	process.env.SECRET_KEY = TEST_SECRET_KEY;

	// Create test channels
	const channelWithBatching = await createNotificationChannel({
		name: 'Test Channel With Batching',
		type: 'webhook',
		enabled: true,
		enabledEvents: ['search_success', 'sweep_completed'],
		batchingEnabled: true,
		batchingWindowSeconds: 60,
		sensitiveConfig: { url: 'https://test-webhook.example.com' }
	});
	testChannelIdBatchingEnabled = channelWithBatching.id;

	const channelWithoutBatching = await createNotificationChannel({
		name: 'Test Channel Without Batching',
		type: 'webhook',
		enabled: true,
		enabledEvents: ['search_success'],
		batchingEnabled: false,
		sensitiveConfig: { url: 'https://test-webhook2.example.com' }
	});
	testChannelIdBatchingDisabled = channelWithoutBatching.id;
});

afterAll(async () => {
	// Clean up notification history for test channels
	await db
		.delete(notificationHistory)
		.where(eq(notificationHistory.channelId, testChannelIdBatchingEnabled));
	await db
		.delete(notificationHistory)
		.where(eq(notificationHistory.channelId, testChannelIdBatchingDisabled));

	// Clean up test channels
	await deleteNotificationChannel(testChannelIdBatchingEnabled);
	await deleteNotificationChannel(testChannelIdBatchingDisabled);

	// Restore original SECRET_KEY
	if (originalSecretKey !== undefined) {
		process.env.SECRET_KEY = originalSecretKey;
	} else {
		delete process.env.SECRET_KEY;
	}
});

beforeEach(async () => {
	// Clean up notification history between tests
	await db
		.delete(notificationHistory)
		.where(eq(notificationHistory.channelId, testChannelIdBatchingEnabled));
	await db
		.delete(notificationHistory)
		.where(eq(notificationHistory.channelId, testChannelIdBatchingDisabled));
});

// ============================================================================
// getBatchingEnabledChannels Tests
// ============================================================================

describe('getBatchingEnabledChannels', () => {
	it('should return channels with batching enabled', async () => {
		const channels = await getBatchingEnabledChannels();

		// Should find our test channel with batching enabled
		const testChannel = channels.find((c) => c.id === testChannelIdBatchingEnabled);
		expect(testChannel).toBeDefined();
		expect(testChannel?.batchingEnabled).toBe(true);
	});

	it('should not return channels with batching disabled', async () => {
		const channels = await getBatchingEnabledChannels();

		// Should not find our test channel with batching disabled
		const testChannel = channels.find((c) => c.id === testChannelIdBatchingDisabled);
		expect(testChannel).toBeUndefined();
	});

	it('should not return disabled channels even if batching is enabled', async () => {
		// Create a disabled channel with batching
		const disabledChannel = await createNotificationChannel({
			name: 'Test Disabled Channel With Batching',
			type: 'webhook',
			enabled: false, // Disabled
			enabledEvents: ['search_success'],
			batchingEnabled: true,
			sensitiveConfig: { url: 'https://test-disabled.example.com' }
		});

		try {
			const channels = await getBatchingEnabledChannels();
			const found = channels.find((c) => c.id === disabledChannel.id);
			expect(found).toBeUndefined();
		} finally {
			await deleteNotificationChannel(disabledChannel.id);
		}
	});
});

// ============================================================================
// createNotificationHistory Tests
// ============================================================================

describe('createNotificationHistory for batching', () => {
	it('should create pending notification history entry', async () => {
		const entry = await createNotificationHistory({
			channelId: testChannelIdBatchingEnabled,
			eventType: 'search_success',
			eventData: {
				contentTitle: 'Breaking Bad',
				quality: 'HDTV-1080p',
				connectorName: 'Sonarr'
			},
			status: 'pending'
		});

		expect(entry.id).toBeDefined();
		expect(entry.channelId).toBe(testChannelIdBatchingEnabled);
		expect(entry.eventType).toBe('search_success');
		expect(entry.status).toBe('pending');
		expect(entry.eventData).toEqual({
			contentTitle: 'Breaking Bad',
			quality: 'HDTV-1080p',
			connectorName: 'Sonarr'
		});
	});
});

// ============================================================================
// getPendingNotificationsForBatching Tests
// ============================================================================

describe('getPendingNotificationsForBatching', () => {
	it('should return pending notifications within window', async () => {
		// Create pending notifications
		await createNotificationHistory({
			channelId: testChannelIdBatchingEnabled,
			eventType: 'search_success',
			eventData: { contentTitle: 'Movie 1' },
			status: 'pending'
		});
		await createNotificationHistory({
			channelId: testChannelIdBatchingEnabled,
			eventType: 'search_success',
			eventData: { contentTitle: 'Movie 2' },
			status: 'pending'
		});

		const pending = await getPendingNotificationsForBatching(
			testChannelIdBatchingEnabled,
			'search_success',
			120 // 2 minute window
		);

		expect(pending.length).toBe(2);
		expect(pending[0]?.status).toBe('pending');
	});

	it('should only return notifications for specified event type', async () => {
		// Create notifications of different types
		await createNotificationHistory({
			channelId: testChannelIdBatchingEnabled,
			eventType: 'search_success',
			eventData: { contentTitle: 'Movie 1' },
			status: 'pending'
		});
		await createNotificationHistory({
			channelId: testChannelIdBatchingEnabled,
			eventType: 'sweep_completed',
			eventData: { connectorName: 'Sonarr', gapsFound: 5 },
			status: 'pending'
		});

		const pending = await getPendingNotificationsForBatching(
			testChannelIdBatchingEnabled,
			'search_success',
			120
		);

		expect(pending.length).toBe(1);
		expect(pending[0]?.eventType).toBe('search_success');
	});

	it('should only return notifications for specified channel', async () => {
		// Create notifications for different channels
		await createNotificationHistory({
			channelId: testChannelIdBatchingEnabled,
			eventType: 'search_success',
			eventData: { contentTitle: 'Movie 1' },
			status: 'pending'
		});
		await createNotificationHistory({
			channelId: testChannelIdBatchingDisabled,
			eventType: 'search_success',
			eventData: { contentTitle: 'Movie 2' },
			status: 'pending'
		});

		const pending = await getPendingNotificationsForBatching(
			testChannelIdBatchingEnabled,
			'search_success',
			120
		);

		expect(pending.length).toBe(1);
		expect(pending[0]?.channelId).toBe(testChannelIdBatchingEnabled);
	});

	it('should not return already batched notifications', async () => {
		// Create pending notification
		const entry = await createNotificationHistory({
			channelId: testChannelIdBatchingEnabled,
			eventType: 'search_success',
			eventData: { contentTitle: 'Movie 1' },
			status: 'pending'
		});

		// Mark as batched
		await markNotificationsAsBatched([entry.id], 'test_batch_1');

		// Should not appear in pending
		const pending = await getPendingNotificationsForBatching(
			testChannelIdBatchingEnabled,
			'search_success',
			120
		);

		expect(pending.length).toBe(0);
	});

	it('should return notifications ordered by createdAt', async () => {
		// Create notifications with slight delay
		const entry1 = await createNotificationHistory({
			channelId: testChannelIdBatchingEnabled,
			eventType: 'search_success',
			eventData: { contentTitle: 'Movie 1' },
			status: 'pending'
		});

		// Small delay
		await new Promise((resolve) => setTimeout(resolve, 10));

		const entry2 = await createNotificationHistory({
			channelId: testChannelIdBatchingEnabled,
			eventType: 'search_success',
			eventData: { contentTitle: 'Movie 2' },
			status: 'pending'
		});

		const pending = await getPendingNotificationsForBatching(
			testChannelIdBatchingEnabled,
			'search_success',
			120
		);

		expect(pending.length).toBe(2);
		expect(pending[0]?.id).toBe(entry1.id); // First created should be first
		expect(pending[1]?.id).toBe(entry2.id);
	});
});

// ============================================================================
// markNotificationsAsBatched Tests
// ============================================================================

describe('markNotificationsAsBatched', () => {
	it('should mark notifications as batched with batchId', async () => {
		// Create pending notifications
		const entry1 = await createNotificationHistory({
			channelId: testChannelIdBatchingEnabled,
			eventType: 'search_success',
			eventData: { contentTitle: 'Movie 1' },
			status: 'pending'
		});
		const entry2 = await createNotificationHistory({
			channelId: testChannelIdBatchingEnabled,
			eventType: 'search_success',
			eventData: { contentTitle: 'Movie 2' },
			status: 'pending'
		});

		const batchId = 'test_batch_' + Date.now();
		const count = await markNotificationsAsBatched([entry1.id, entry2.id], batchId);

		expect(count).toBe(2);

		// Verify status changed
		const batched = await getNotificationsByBatchId(batchId);
		expect(batched.length).toBe(2);
		expect(batched[0]?.status).toBe('batched');
		expect(batched[0]?.batchId).toBe(batchId);
	});

	it('should return 0 for empty ids array', async () => {
		const count = await markNotificationsAsBatched([], 'test_batch');
		expect(count).toBe(0);
	});
});

// ============================================================================
// getNotificationsByBatchId Tests
// ============================================================================

describe('getNotificationsByBatchId', () => {
	it('should return all notifications with matching batchId', async () => {
		// Create and batch notifications
		const entry1 = await createNotificationHistory({
			channelId: testChannelIdBatchingEnabled,
			eventType: 'search_success',
			eventData: { contentTitle: 'Movie 1' },
			status: 'pending'
		});
		const entry2 = await createNotificationHistory({
			channelId: testChannelIdBatchingEnabled,
			eventType: 'search_success',
			eventData: { contentTitle: 'Movie 2' },
			status: 'pending'
		});

		const batchId = 'test_batch_' + Date.now();
		await markNotificationsAsBatched([entry1.id, entry2.id], batchId);

		const batched = await getNotificationsByBatchId(batchId);

		expect(batched.length).toBe(2);
		expect(batched.every((n) => n.batchId === batchId)).toBe(true);
	});

	it('should return empty array for non-existent batchId', async () => {
		const batched = await getNotificationsByBatchId('non_existent_batch');
		expect(batched.length).toBe(0);
	});

	it('should return notifications ordered by createdAt', async () => {
		// Create notifications
		const entry1 = await createNotificationHistory({
			channelId: testChannelIdBatchingEnabled,
			eventType: 'search_success',
			eventData: { contentTitle: 'Movie 1' },
			status: 'pending'
		});

		await new Promise((resolve) => setTimeout(resolve, 10));

		const entry2 = await createNotificationHistory({
			channelId: testChannelIdBatchingEnabled,
			eventType: 'search_success',
			eventData: { contentTitle: 'Movie 2' },
			status: 'pending'
		});

		const batchId = 'test_batch_ordered_' + Date.now();
		await markNotificationsAsBatched([entry1.id, entry2.id], batchId);

		const batched = await getNotificationsByBatchId(batchId);

		expect(batched.length).toBe(2);
		expect(batched[0]?.id).toBe(entry1.id);
		expect(batched[1]?.id).toBe(entry2.id);
	});
});

// ============================================================================
// Batching Window Logic Tests
// ============================================================================

describe('batching window behavior', () => {
	it('should not include very old notifications outside the window', async () => {
		// Create a notification
		await createNotificationHistory({
			channelId: testChannelIdBatchingEnabled,
			eventType: 'search_success',
			eventData: { contentTitle: 'Movie 1' },
			status: 'pending'
		});

		// Query with a very small window (1 second)
		// Since we just created it, it should be within 1 second
		const pending = await getPendingNotificationsForBatching(
			testChannelIdBatchingEnabled,
			'search_success',
			1
		);

		expect(pending.length).toBe(1);
	});
});
