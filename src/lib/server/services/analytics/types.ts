export type AnalyticsEventType =
	| 'gap_discovered'
	| 'upgrade_discovered'
	| 'search_dispatched'
	| 'search_completed'
	| 'search_failed'
	| 'search_no_results'
	| 'queue_depth_sampled'
	| 'sync_completed'
	| 'sync_failed';

export interface GapDiscoveredPayload {
	/** Total gaps found in content mirror */
	gapsFound: number;
	/** New search registry entries created */
	registriesCreated: number;
	/** Gap registries deleted (content now has file) */
	registriesResolved: number;
	/** Type of connector scanned */
	connectorType: 'sonarr' | 'radarr' | 'whisparr';
	/** Duration of discovery operation in milliseconds */
	durationMs: number;
}

export interface UpgradeDiscoveredPayload {
	/** Total upgrade candidates found */
	upgradesFound: number;
	/** New search registry entries created */
	registriesCreated: number;
	/** Upgrade registries deleted (quality cutoff now met) */
	registriesResolved: number;
	/** Type of connector scanned */
	connectorType: 'sonarr' | 'radarr' | 'whisparr';
	/** Duration of discovery operation in milliseconds */
	durationMs: number;
}

export interface SearchDispatchedPayload {
	/** ID of the search registry entry */
	searchRegistryId: number;
	/** Type of content searched */
	contentType: 'episode' | 'movie';
	/** Type of search (gap or upgrade) */
	searchType: 'gap' | 'upgrade';
	/** Command ID returned by *arr API */
	commandId: number;
	/** Response time for the API call in milliseconds */
	responseTimeMs?: number | undefined;
}

export interface SearchCompletedPayload {
	/** ID of the search registry entry */
	searchRegistryId: number;
	/** Type of content searched */
	contentType: 'episode' | 'movie';
	/** Type of search (gap or upgrade) */
	searchType: 'gap' | 'upgrade';
	/** Response time for the operation in milliseconds */
	responseTimeMs?: number | undefined;
}

export interface SearchFailedPayload {
	/** ID of the search registry entry */
	searchRegistryId: number;
	/** Type of content searched */
	contentType: 'episode' | 'movie';
	/** Type of search (gap or upgrade) */
	searchType: 'gap' | 'upgrade';
	/** Category of failure */
	failureCategory: 'no_results' | 'network_error' | 'rate_limited' | 'server_error' | 'timeout';
	/** Error message if applicable */
	error?: string | undefined;
	/** Response time for the API call in milliseconds */
	responseTimeMs?: number | undefined;
}

export interface QueueDepthSampledPayload {
	/** Total items in queue (pending + queued + searching + cooldown) */
	queueDepth: number;
	/** Items in pending or queued state */
	pendingCount: number;
	/** Items currently being searched */
	searchingCount: number;
	/** Items in cooldown state */
	cooldownCount: number;
}

export interface SyncCompletedPayload {
	/** Number of items synced */
	itemsSynced: number;
	/** Type of sync operation */
	syncType: 'incremental' | 'full';
	/** Duration of sync operation in milliseconds */
	durationMs: number;
}

export interface SyncFailedPayload {
	/** Type of sync operation that failed */
	syncType: 'incremental' | 'full';
	/** Error message */
	error: string;
	/** Duration before failure in milliseconds */
	durationMs: number;
}

export type AnalyticsEventPayload =
	| GapDiscoveredPayload
	| UpgradeDiscoveredPayload
	| SearchDispatchedPayload
	| SearchCompletedPayload
	| SearchFailedPayload
	| QueueDepthSampledPayload
	| SyncCompletedPayload
	| SyncFailedPayload;

export interface RecordEventResult {
	/** Whether the event was recorded successfully */
	success: boolean;
	/** ID of the inserted event (if successful) */
	eventId?: number | undefined;
	/** Error message (if failed) */
	error?: string | undefined;
}

export interface AggregationResult {
	/** Whether the aggregation completed successfully */
	success: boolean;
	/** Number of hourly stats rows upserted */
	hourlyStatsUpdated: number;
	/** Number of daily stats rows upserted */
	dailyStatsUpdated: number;
	/** Number of raw events processed */
	eventsProcessed: number;
	/** Duration of aggregation in milliseconds */
	durationMs: number;
	/** Error message (if failed) */
	error?: string | undefined;
}

export interface QueueDepthSample {
	/** Connector ID */
	connectorId: number;
	/** Total queue depth */
	queueDepth: number;
	/** Items pending or queued */
	pendingCount: number;
	/** Items being searched */
	searchingCount: number;
	/** Items in cooldown */
	cooldownCount: number;
}
