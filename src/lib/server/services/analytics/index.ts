export { aggregateDailyStats, aggregateHourlyStats, cleanupOldEvents } from './aggregator';

export { analyticsCollector } from './collector';
export type {
	AggregationResult,
	AnalyticsEventPayload,
	AnalyticsEventType,
	GapDiscoveredPayload,
	QueueDepthSample,
	QueueDepthSampledPayload,
	RecordEventResult,
	SearchCompletedPayload,
	SearchDispatchedPayload,
	SearchFailedPayload,
	SyncCompletedPayload,
	SyncFailedPayload,
	UpgradeDiscoveredPayload
} from './types';
