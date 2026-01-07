import { inArray, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { analyticsEvents, searchRegistry } from '$lib/server/db/schema';
import { createLogger } from '$lib/server/logger';
import type { GapDiscoveryResult, UpgradeDiscoveryResult } from '$lib/server/services/discovery';
import type {
	AnalyticsEventPayload,
	AnalyticsEventType,
	GapDiscoveredPayload,
	QueueDepthSample,
	QueueDepthSampledPayload,
	RecordEventResult,
	SearchDispatchedPayload,
	SearchFailedPayload,
	UpgradeDiscoveredPayload
} from './types';

const logger = createLogger('analytics');

class AnalyticsCollector {
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
			logger.error('Failed to record event', {
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

	// Determines event type based on failure category: 'no_results' -> search_no_results, others -> search_failed
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
			logger.error('Failed to sample queue depth', {
				error: error instanceof Error ? error.message : String(error)
			});
		}

		return samples;
	}

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

export const analyticsCollector = new AnalyticsCollector();
