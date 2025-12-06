/**
 * Analytics service for tracking metrics and aggregating statistics.
 *
 * Provides:
 * - Event collection: records raw analytics events
 * - Aggregation: rolls up hourly and daily statistics
 * - Cleanup: removes old raw events
 *
 * Usage:
 * ```typescript
 * import {
 *   analyticsCollector,
 *   aggregateHourlyStats,
 *   aggregateDailyStats
 * } from '$lib/server/services/analytics';
 *
 * // Record gap discovery
 * await analyticsCollector.recordGapDiscovery(connectorId, result);
 *
 * // Sample queue depth for all connectors
 * const samples = await analyticsCollector.sampleQueueDepth();
 *
 * // Aggregate hourly stats
 * await aggregateHourlyStats(previousHour);
 * ```
 *
 * @module services/analytics

 */

// =============================================================================
// Types
// =============================================================================

export type {
	// Event types
	AnalyticsEventType,
	AnalyticsEventPayload,
	// Payload interfaces
	GapDiscoveredPayload,
	UpgradeDiscoveredPayload,
	SearchDispatchedPayload,
	SearchCompletedPayload,
	SearchFailedPayload,
	QueueDepthSampledPayload,
	SyncCompletedPayload,
	SyncFailedPayload,
	// Result types
	RecordEventResult,
	AggregationResult,
	QueueDepthSample
} from './types';

// =============================================================================
// Collector
// =============================================================================

export { analyticsCollector } from './collector';

// =============================================================================
// Aggregator
// =============================================================================

export { aggregateHourlyStats, aggregateDailyStats, cleanupOldEvents } from './aggregator';
