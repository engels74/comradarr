/**
 * Unit tests for notification aggregators.
 *
 * Tests cover:
 * - buildAggregatePayload() for each event type
 * - Correct aggregation of multiple events
 * - Edge cases (single event, empty array)
 * - Title truncation for long lists
 * - Event data extraction
 *

 */

import { describe, it, expect } from 'vitest';
import { buildAggregatePayload } from '../../src/lib/server/services/notifications/aggregators';
import type { NotificationHistory } from '../../src/lib/server/db/schema';

/**
 * Helper to create a mock NotificationHistory entry.
 */
function createHistoryEntry(
	eventType: string,
	eventData: Record<string, unknown>,
	id: number = 1
): NotificationHistory {
	return {
		id,
		channelId: 1,
		eventType,
		eventData,
		status: 'pending',
		sentAt: null,
		errorMessage: null,
		batchId: null,
		createdAt: new Date()
	};
}

describe('buildAggregatePayload', () => {
	describe('search_success aggregation', () => {
		it('should aggregate multiple search success events', () => {
			const entries = [
				createHistoryEntry(
					'search_success',
					{
						contentTitle: 'Breaking Bad',
						contentYear: 2008,
						quality: 'HDTV-1080p',
						connectorName: 'Sonarr'
					},
					1
				),
				createHistoryEntry(
					'search_success',
					{
						contentTitle: 'The Office',
						contentYear: 2005,
						quality: 'HDTV-720p',
						connectorName: 'Sonarr'
					},
					2
				),
				createHistoryEntry(
					'search_success',
					{
						contentTitle: 'Game of Thrones',
						contentYear: 2011,
						quality: 'Bluray-1080p',
						connectorName: 'Sonarr'
					},
					3
				)
			];

			const payload = buildAggregatePayload('search_success', entries);

			expect(payload.eventType).toBe('search_success');
			expect(payload.title).toBe('3 Items Found');
			expect(payload.message).toContain('3 items found and grabbed');
			expect(payload.message).toContain('Breaking Bad');
			expect(payload.fields).toBeDefined();
			expect(payload.fields?.some((f) => f.name === 'Total Items' && f.value === '3')).toBe(true);
		});

		it('should handle single search success event', () => {
			const entries = [
				createHistoryEntry('search_success', {
					contentTitle: 'Breaking Bad',
					contentYear: 2008,
					quality: 'HDTV-1080p',
					connectorName: 'Sonarr'
				})
			];

			const payload = buildAggregatePayload('search_success', entries);

			expect(payload.title).toBe('1 Items Found');
			expect(payload.message).toContain('1 item found');
		});

		it('should handle episode content with season/episode numbers', () => {
			const entries = [
				createHistoryEntry('search_success', {
					contentTitle: 'Breaking Bad',
					contentYear: 2008,
					quality: 'HDTV-1080p',
					connectorName: 'Sonarr',
					contentType: 'episode',
					seasonNumber: 1,
					episodeNumber: 1
				})
			];

			const payload = buildAggregatePayload('search_success', entries);

			expect(payload.message).toContain('S01E01');
		});

		it('should list multiple qualities when different', () => {
			const entries = [
				createHistoryEntry(
					'search_success',
					{
						contentTitle: 'Breaking Bad',
						quality: 'HDTV-1080p',
						connectorName: 'Sonarr'
					},
					1
				),
				createHistoryEntry(
					'search_success',
					{
						contentTitle: 'The Office',
						quality: 'Bluray-720p',
						connectorName: 'Sonarr'
					},
					2
				)
			];

			const payload = buildAggregatePayload('search_success', entries);

			const qualitiesField = payload.fields?.find((f) => f.name === 'Qualities');
			expect(qualitiesField).toBeDefined();
			expect(qualitiesField?.value).toContain('HDTV-1080p');
			expect(qualitiesField?.value).toContain('Bluray-720p');
		});
	});

	describe('search_exhausted aggregation', () => {
		it('should aggregate multiple search exhausted events', () => {
			const entries = [
				createHistoryEntry(
					'search_exhausted',
					{
						contentTitle: 'Lost Episode',
						attempts: 5,
						connectorName: 'Sonarr'
					},
					1
				),
				createHistoryEntry(
					'search_exhausted',
					{
						contentTitle: 'Missing Movie',
						attempts: 3,
						connectorName: 'Radarr'
					},
					2
				)
			];

			const payload = buildAggregatePayload('search_exhausted', entries);

			expect(payload.eventType).toBe('search_exhausted');
			expect(payload.title).toBe('2 Searches Exhausted');
			expect(payload.message).toContain('2 items');
			expect(payload.message).toContain('8 total attempts');
			expect(payload.fields?.some((f) => f.name === 'Total Attempts' && f.value === '8')).toBe(
				true
			);
		});

		it('should include attempt counts in item list', () => {
			const entries = [
				createHistoryEntry('search_exhausted', {
					contentTitle: 'Lost Episode',
					attempts: 5,
					connectorName: 'Sonarr'
				})
			];

			const payload = buildAggregatePayload('search_exhausted', entries);

			const itemsField = payload.fields?.find((f) => f.name === 'Items');
			expect(itemsField?.value).toContain('5 attempts');
		});
	});

	describe('sweep_started aggregation', () => {
		it('should aggregate multiple sweep started events', () => {
			const entries = [
				createHistoryEntry(
					'sweep_started',
					{
						connectorId: 1,
						connectorName: 'Sonarr',
						sweepType: 'gap'
					},
					1
				),
				createHistoryEntry(
					'sweep_started',
					{
						connectorId: 2,
						connectorName: 'Radarr',
						sweepType: 'upgrade'
					},
					2
				)
			];

			const payload = buildAggregatePayload('sweep_started', entries);

			expect(payload.eventType).toBe('sweep_started');
			expect(payload.title).toBe('2 Sweeps Started');
			expect(payload.fields?.some((f) => f.name === 'Sweeps Started' && f.value === '2')).toBe(
				true
			);
		});

		it('should combine sweep types correctly', () => {
			const entries = [
				createHistoryEntry(
					'sweep_started',
					{
						connectorName: 'Sonarr',
						sweepType: 'gap'
					},
					1
				),
				createHistoryEntry(
					'sweep_started',
					{
						connectorName: 'Radarr',
						sweepType: 'upgrade'
					},
					2
				)
			];

			const payload = buildAggregatePayload('sweep_started', entries);

			// Should show "Gaps & Upgrades" since both types present
			const sweepTypeField = payload.fields?.find((f) => f.name === 'Sweep Type');
			expect(sweepTypeField?.value).toBe('Gaps & Upgrades');
		});
	});

	describe('sweep_completed aggregation', () => {
		it('should sum totals across multiple sweeps', () => {
			const entries = [
				createHistoryEntry(
					'sweep_completed',
					{
						connectorId: 1,
						connectorName: 'Sonarr',
						gapsFound: 10,
						upgradesFound: 5,
						itemsQueued: 8
					},
					1
				),
				createHistoryEntry(
					'sweep_completed',
					{
						connectorId: 2,
						connectorName: 'Radarr',
						gapsFound: 5,
						upgradesFound: 3,
						itemsQueued: 4
					},
					2
				)
			];

			const payload = buildAggregatePayload('sweep_completed', entries);

			expect(payload.eventType).toBe('sweep_completed');
			expect(payload.title).toBe('2 Sweeps Complete');
			expect(payload.fields?.some((f) => f.name === 'Gaps Found' && f.value === '15')).toBe(true);
			expect(payload.fields?.some((f) => f.name === 'Upgrades Found' && f.value === '8')).toBe(
				true
			);
			expect(payload.fields?.some((f) => f.name === 'Items Queued' && f.value === '12')).toBe(true);
		});
	});

	describe('sync_completed aggregation', () => {
		it('should sum processed items across syncs', () => {
			const entries = [
				createHistoryEntry(
					'sync_completed',
					{
						connectorId: 1,
						connectorName: 'Sonarr',
						itemsProcessed: 100,
						itemsCreated: 10,
						itemsUpdated: 20,
						itemsDeleted: 5
					},
					1
				),
				createHistoryEntry(
					'sync_completed',
					{
						connectorId: 2,
						connectorName: 'Radarr',
						itemsProcessed: 50,
						itemsCreated: 5,
						itemsUpdated: 10,
						itemsDeleted: 2
					},
					2
				)
			];

			const payload = buildAggregatePayload('sync_completed', entries);

			expect(payload.title).toBe('2 Syncs Complete');
			expect(payload.fields?.some((f) => f.name === 'Items Processed' && f.value === '150')).toBe(
				true
			);
			expect(payload.fields?.some((f) => f.name === 'Created' && f.value === '15')).toBe(true);
			expect(payload.fields?.some((f) => f.name === 'Updated' && f.value === '30')).toBe(true);
			expect(payload.fields?.some((f) => f.name === 'Deleted' && f.value === '7')).toBe(true);
		});
	});

	describe('sync_failed aggregation', () => {
		it('should list all failures with errors', () => {
			const entries = [
				createHistoryEntry(
					'sync_failed',
					{
						connectorId: 1,
						connectorName: 'Sonarr',
						error: 'Connection timeout'
					},
					1
				),
				createHistoryEntry(
					'sync_failed',
					{
						connectorId: 2,
						connectorName: 'Radarr',
						error: 'Authentication failed'
					},
					2
				)
			];

			const payload = buildAggregatePayload('sync_failed', entries);

			expect(payload.title).toBe('2 Sync Failures');
			expect(payload.fields?.some((f) => f.name === 'Total Failures' && f.value === '2')).toBe(
				true
			);
			const errorsField = payload.fields?.find((f) => f.name === 'Errors');
			expect(errorsField?.value).toContain('Sonarr');
			expect(errorsField?.value).toContain('Radarr');
		});
	});

	describe('connector_health_changed aggregation', () => {
		it('should list all health changes', () => {
			const entries = [
				createHistoryEntry(
					'connector_health_changed',
					{
						connectorId: 1,
						connectorName: 'Sonarr',
						connectorType: 'sonarr',
						oldStatus: 'healthy',
						newStatus: 'unhealthy'
					},
					1
				),
				createHistoryEntry(
					'connector_health_changed',
					{
						connectorId: 2,
						connectorName: 'Radarr',
						connectorType: 'radarr',
						oldStatus: 'offline',
						newStatus: 'healthy'
					},
					2
				)
			];

			const payload = buildAggregatePayload('connector_health_changed', entries);

			expect(payload.title).toBe('2 Health Changes');
			expect(payload.fields?.some((f) => f.name === 'Improvements' && f.value === '1')).toBe(true);
			expect(payload.fields?.some((f) => f.name === 'Degradations' && f.value === '1')).toBe(true);
		});

		it('should track improvements vs degradations correctly', () => {
			const entries = [
				createHistoryEntry(
					'connector_health_changed',
					{
						connectorName: 'Sonarr',
						oldStatus: 'offline',
						newStatus: 'healthy'
					},
					1
				),
				createHistoryEntry(
					'connector_health_changed',
					{
						connectorName: 'Radarr',
						oldStatus: 'unhealthy',
						newStatus: 'healthy'
					},
					2
				)
			];

			const payload = buildAggregatePayload('connector_health_changed', entries);

			expect(payload.fields?.some((f) => f.name === 'Improvements' && f.value === '2')).toBe(true);
			expect(payload.fields?.some((f) => f.name === 'Degradations' && f.value === '0')).toBe(true);
			expect(payload.message).toContain('improved');
		});
	});

	describe('app_started aggregation', () => {
		it('should handle app started event', () => {
			const entries = [
				createHistoryEntry('app_started', {
					version: '1.0.0',
					environment: 'production'
				})
			];

			const payload = buildAggregatePayload('app_started', entries);

			expect(payload.title).toBe('Comradarr Started');
			expect(payload.message).toContain('v1.0.0');
		});
	});

	describe('update_available aggregation', () => {
		it('should handle update available event', () => {
			const entries = [
				createHistoryEntry('update_available', {
					currentVersion: '1.0.0',
					newVersion: '1.1.0',
					releaseUrl: 'https://github.com/example/release'
				})
			];

			const payload = buildAggregatePayload('update_available', entries);

			expect(payload.title).toBe('Update Available');
			expect(payload.message).toContain('v1.1.0');
			expect(payload.url).toBe('https://github.com/example/release');
		});
	});

	describe('edge cases', () => {
		it('should handle empty entries array', () => {
			const payload = buildAggregatePayload('search_success', []);

			expect(payload.title).toBe('No Events');
			expect(payload.message).toBe('No events to aggregate');
		});

		it('should handle entries with missing eventData', () => {
			const entries = [
				{
					id: 1,
					channelId: 1,
					eventType: 'search_success',
					eventData: null,
					status: 'pending',
					sentAt: null,
					errorMessage: null,
					batchId: null,
					createdAt: new Date()
				} as NotificationHistory
			];

			// Should not throw
			const payload = buildAggregatePayload('search_success', entries);
			expect(payload.eventType).toBe('search_success');
		});

		it('should truncate long content titles', () => {
			const entries = [
				createHistoryEntry('search_success', {
					contentTitle:
						'This is a very very very long title that should be truncated for readability',
					quality: 'HDTV-1080p',
					connectorName: 'Sonarr'
				})
			];

			const payload = buildAggregatePayload('search_success', entries);

			// Title should be truncated (MAX_TITLE_LENGTH = 40)
			const itemsField = payload.fields?.find((f) => f.name === 'Items');
			expect(itemsField?.value.length).toBeLessThanOrEqual(100); // Some reasonable limit
			expect(itemsField?.value).toContain('...');
		});

		it('should handle more than MAX_LIST_ITEMS entries', () => {
			const entries = Array.from({ length: 10 }, (_, i) =>
				createHistoryEntry(
					'search_success',
					{
						contentTitle: `Movie ${i + 1}`,
						quality: 'HDTV-1080p',
						connectorName: 'Radarr'
					},
					i + 1
				)
			);

			const payload = buildAggregatePayload('search_success', entries);

			expect(payload.title).toBe('10 Items Found');
			const itemsField = payload.fields?.find((f) => f.name === 'Items');
			expect(itemsField?.value).toContain('and 5 more');
		});
	});

	describe('eventData in payload', () => {
		it('should include individualCount in eventData', () => {
			const entries = [
				createHistoryEntry(
					'search_success',
					{
						contentTitle: 'Breaking Bad',
						quality: 'HDTV-1080p',
						connectorName: 'Sonarr'
					},
					1
				),
				createHistoryEntry(
					'search_success',
					{
						contentTitle: 'The Office',
						quality: 'HDTV-720p',
						connectorName: 'Sonarr'
					},
					2
				)
			];

			const payload = buildAggregatePayload('search_success', entries);

			expect(payload.eventData).toBeDefined();
			expect((payload.eventData as Record<string, unknown>).individualCount).toBe(2);
		});
	});

	describe('timestamp', () => {
		it('should include timestamp in payload', () => {
			const entries = [
				createHistoryEntry('search_success', {
					contentTitle: 'Breaking Bad',
					quality: 'HDTV-1080p',
					connectorName: 'Sonarr'
				})
			];

			const before = new Date();
			const payload = buildAggregatePayload('search_success', entries);
			const after = new Date();

			expect(payload.timestamp).toBeDefined();
			expect(payload.timestamp!.getTime()).toBeGreaterThanOrEqual(before.getTime());
			expect(payload.timestamp!.getTime()).toBeLessThanOrEqual(after.getTime());
		});
	});

	describe('color', () => {
		it('should include correct color for event type', () => {
			const entries = [
				createHistoryEntry('search_success', {
					contentTitle: 'Breaking Bad',
					quality: 'HDTV-1080p',
					connectorName: 'Sonarr'
				})
			];

			const payload = buildAggregatePayload('search_success', entries);

			expect(payload.color).toBeDefined();
			// search_success should have a green-ish color
			expect(payload.color).toMatch(/^#[0-9a-fA-F]{6}$/);
		});
	});
});
