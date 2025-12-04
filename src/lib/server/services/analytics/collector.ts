/**
 * Analytics Collector for recording raw events.
 *
 * Records analytics events to the analytics_events table for later aggregation.
 * Events are recorded with error handling to avoid blocking main operations.
 *
 * @module services/analytics/collector
 * @requirements 12.1
 */

import { db } from '$lib/server/db';
import { analyticsEvents, searchRegistry } from '$lib/server/db/schema';
import { inArray, sql } from 'drizzle-orm';
import type {
	AnalyticsEventType,
	AnalyticsEventPayload,
	RecordEventResult,
	GapDiscoveredPayload,
	UpgradeDiscoveredPayload,
	SearchDispatchedPayload,
	SearchFailedPayload,
	QueueDepthSampledPayload,
	QueueDepthSample
} from './types';
import type { GapDiscoveryResult, UpgradeDiscoveryResult } from '$lib/server/services/discovery';

// =============================================================================
// Analytics Collector Class
// =============================================================================

/**
 * Analytics Collector singleton class.
 *
 * Provides methods to record various analytics events to the database.
 * All recording operations are wrapped in try/catch to prevent blocking
 * main application flow on analytics failures.
 *
 * @example
 * ```typescript
 * import { analyticsCollector } from '$lib/server/services/analytics';
 *
 * // Record gap discovery
 * await analyticsCollector.recordGapDiscovery(connectorId, gapResult);
 *
 * // Sample queue depth
 * const samples = await analyticsCollector.sampleQueueDepth();
 * ```
 */
class AnalyticsCollector {
	/**
	 * Records a raw analytics event to the database.
	 *
	 * @param connectorId - Connector ID (null for system-wide events)
	 * @param eventType - Type of analytics event
	 * @param eventData - Event-specific payload data
	 * @returns Result indicating success or failure
	 */
	async recordEvent(
		connectorId: number | null,
		eventType: AnalyticsEventType,
		eventData: AnalyticsEventPayload
	): Promise<RecordEventResult> {
		try {
			const result = await db
				.insert(analyticsEvents)
				.values({
					connectorId,
					eventType,
					eventData
				})
				.returning({ id: analyticsEvents.id });

			return {
				success: true,
				eventId: result[0]?.id
			};
		} catch (error) {
			console.error('[analytics] Failed to record event:', {
				eventType,
				connectorId,
				error: error instanceof Error ? error.message : String(error)
			});
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error)
			};
		}
	}

	/**
	 * Records a gap discovery event from discoverGaps() result.
	 *
	 * Only records if the discovery was successful.
	 *
	 * @param connectorId - ID of the connector that was scanned
	 * @param result - Result from discoverGaps()
	 * @returns Result indicating success or failure
	 */
	async recordGapDiscovery(
		connectorId: number,
		result: GapDiscoveryResult
	): Promise<RecordEventResult> {
		if (!result.success) {
			// Don't record failed discoveries
			return { success: true };
		}

		const payload: GapDiscoveredPayload = {
			gapsFound: result.gapsFound,
			registriesCreated: result.registriesCreated,
			registriesResolved: result.registriesResolved,
			connectorType: result.connectorType,
			durationMs: result.durationMs
		};

		return this.recordEvent(connectorId, 'gap_discovered', payload);
	}

	/**
	 * Records an upgrade discovery event from discoverUpgrades() result.
	 *
	 * Only records if the discovery was successful.
	 *
	 * @param connectorId - ID of the connector that was scanned
	 * @param result - Result from discoverUpgrades()
	 * @returns Result indicating success or failure
	 */
	async recordUpgradeDiscovery(
		connectorId: number,
		result: UpgradeDiscoveryResult
	): Promise<RecordEventResult> {
		if (!result.success) {
			// Don't record failed discoveries
			return { success: true };
		}

		const payload: UpgradeDiscoveredPayload = {
			upgradesFound: result.upgradesFound,
			registriesCreated: result.registriesCreated,
			registriesResolved: result.registriesResolved,
			connectorType: result.connectorType,
			durationMs: result.durationMs
		};

		return this.recordEvent(connectorId, 'upgrade_discovered', payload);
	}

	/**
	 * Records a successful search dispatch event.
	 *
	 * @param connectorId - ID of the connector used
	 * @param searchRegistryId - ID of the search registry entry
	 * @param contentType - Type of content searched
	 * @param searchType - Type of search (gap or upgrade)
	 * @param commandId - Command ID returned by *arr API
	 * @param responseTimeMs - Optional response time in milliseconds
	 * @returns Result indicating success or failure
	 */
	async recordSearchDispatched(
		connectorId: number,
		searchRegistryId: number,
		contentType: 'episode' | 'movie',
		searchType: 'gap' | 'upgrade',
		commandId: number,
		responseTimeMs?: number
	): Promise<RecordEventResult> {
		const payload: SearchDispatchedPayload = {
			searchRegistryId,
			contentType,
			searchType,
			commandId,
			responseTimeMs
		};

		return this.recordEvent(connectorId, 'search_dispatched', payload);
	}

	/**
	 * Records a search failure event.
	 *
	 * Determines the appropriate event type based on failure category:
	 * - 'no_results' → search_no_results event
	 * - Other failures → search_failed event
	 *
	 * @param connectorId - ID of the connector used
	 * @param searchRegistryId - ID of the search registry entry
	 * @param contentType - Type of content searched
	 * @param searchType - Type of search (gap or upgrade)
	 * @param failureCategory - Category of failure
	 * @param error - Optional error message
	 * @param responseTimeMs - Optional response time in milliseconds
	 * @returns Result indicating success or failure
	 */
	async recordSearchFailed(
		connectorId: number,
		searchRegistryId: number,
		contentType: 'episode' | 'movie',
		searchType: 'gap' | 'upgrade',
		failureCategory: SearchFailedPayload['failureCategory'],
		error?: string,
		responseTimeMs?: number
	): Promise<RecordEventResult> {
		// Use appropriate event type based on failure category
		const eventType: AnalyticsEventType =
			failureCategory === 'no_results' ? 'search_no_results' : 'search_failed';

		const payload: SearchFailedPayload = {
			searchRegistryId,
			contentType,
			searchType,
			failureCategory,
			error,
			responseTimeMs
		};

		return this.recordEvent(connectorId, eventType, payload);
	}

	/**
	 * Samples queue depth for all connectors.
	 *
	 * Queries the search_registry table to count items in each state,
	 * grouped by connector. Records a queue_depth_sampled event for
	 * each connector with items in the queue.
	 *
	 * @returns Array of queue depth samples, one per connector
	 */
	async sampleQueueDepth(): Promise<QueueDepthSample[]> {
		const samples: QueueDepthSample[] = [];

		try {
			// Get queue depth per connector with state breakdown
			const result = await db
				.select({
					connectorId: searchRegistry.connectorId,
					state: searchRegistry.state,
					count: sql<number>`count(*)::int`
				})
				.from(searchRegistry)
				.where(inArray(searchRegistry.state, ['pending', 'queued', 'searching', 'cooldown']))
				.groupBy(searchRegistry.connectorId, searchRegistry.state);

			// Aggregate by connector
			const connectorMap = new Map<number, QueueDepthSample>();

			for (const row of result) {
				if (!connectorMap.has(row.connectorId)) {
					connectorMap.set(row.connectorId, {
						connectorId: row.connectorId,
						queueDepth: 0,
						pendingCount: 0,
						searchingCount: 0,
						cooldownCount: 0
					});
				}

				const sample = connectorMap.get(row.connectorId)!;
				sample.queueDepth += row.count;

				switch (row.state) {
					case 'pending':
					case 'queued':
						sample.pendingCount += row.count;
						break;
					case 'searching':
						sample.searchingCount += row.count;
						break;
					case 'cooldown':
						sample.cooldownCount += row.count;
						break;
				}
			}

			// Record events for each connector
			for (const sample of connectorMap.values()) {
				const payload: QueueDepthSampledPayload = {
					queueDepth: sample.queueDepth,
					pendingCount: sample.pendingCount,
					searchingCount: sample.searchingCount,
					cooldownCount: sample.cooldownCount
				};

				await this.recordEvent(sample.connectorId, 'queue_depth_sampled', payload);
				samples.push(sample);
			}
		} catch (error) {
			console.error('[analytics] Failed to sample queue depth:', error);
		}

		return samples;
	}

	/**
	 * Records a successful sync completion event.
	 *
	 * @param connectorId - ID of the connector that was synced
	 * @param itemsSynced - Number of items synced
	 * @param syncType - Type of sync operation
	 * @param durationMs - Duration of sync in milliseconds
	 * @returns Result indicating success or failure
	 */
	async recordSyncCompleted(
		connectorId: number,
		itemsSynced: number,
		syncType: 'incremental' | 'full',
		durationMs: number
	): Promise<RecordEventResult> {
		return this.recordEvent(connectorId, 'sync_completed', {
			itemsSynced,
			syncType,
			durationMs
		});
	}

	/**
	 * Records a sync failure event.
	 *
	 * @param connectorId - ID of the connector that failed to sync
	 * @param syncType - Type of sync operation that failed
	 * @param error - Error message
	 * @param durationMs - Duration before failure in milliseconds
	 * @returns Result indicating success or failure
	 */
	async recordSyncFailed(
		connectorId: number,
		syncType: 'incremental' | 'full',
		error: string,
		durationMs: number
	): Promise<RecordEventResult> {
		return this.recordEvent(connectorId, 'sync_failed', {
			syncType,
			error,
			durationMs
		});
	}
}

// =============================================================================
// Singleton Export
// =============================================================================

/**
 * Singleton instance of the AnalyticsCollector.
 *
 * Use this exported instance throughout the application to record
 * analytics events.
 */
export const analyticsCollector = new AnalyticsCollector();
