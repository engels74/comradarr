export interface ProwlarrIndexerStatus {
	/** Internal status ID */
	readonly id: number;
	/** Indexer ID this status belongs to */
	readonly indexerId: number;
	/** ISO date when rate-limit expires, null if not rate-limited */
	readonly disabledTill: string | null;
	/** ISO date of most recent failure, null if none */
	readonly mostRecentFailure: string | null;
	/** ISO date of initial failure in current failure streak, null if none */
	readonly initialFailure: string | null;
}

export interface ProwlarrIndexer {
	/** Indexer ID */
	readonly id: number;
	/** Indexer display name */
	readonly name: string;
	/** Indexer implementation type (e.g., 'Torznab', 'Newznab') */
	readonly implementation: string;
	/** Whether indexer is enabled in Prowlarr */
	readonly enable: boolean;
	/** Protocol type ('usenet' or 'torrent') */
	readonly protocol: string;
	/** Priority for search ordering (1-50, lower is higher priority) */
	readonly priority: number;
}

export interface IndexerHealth {
	/** Indexer ID */
	readonly indexerId: number;
	/** Indexer display name */
	readonly name: string;
	/** Whether indexer is currently rate-limited (disabledTill > now) */
	readonly isRateLimited: boolean;
	/** When rate-limit expires (null if not rate-limited) */
	readonly rateLimitExpiresAt: Date | null;
	/** Most recent failure time (null if none) */
	readonly mostRecentFailure: Date | null;
	/** Whether indexer is enabled in Prowlarr */
	readonly enabled: boolean;
}

export interface ProwlarrClientConfig {
	/** Base URL of the Prowlarr instance (e.g., http://localhost:9696) */
	readonly baseUrl: string;
	/** API key for authentication (already decrypted) */
	readonly apiKey: string;
	/** Request timeout in milliseconds (default: 30000) */
	readonly timeout?: number;
	/** User-Agent header value (default: 'Comradarr/1.0') */
	readonly userAgent?: string;
}

export type ProwlarrHealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'offline' | 'unknown';

export interface HealthCheckResult {
	/** Prowlarr instance ID */
	readonly instanceId: number;
	/** Prowlarr instance display name */
	readonly instanceName: string;
	/** Overall health status after check */
	readonly status: ProwlarrHealthStatus;
	/** Number of indexers checked */
	readonly indexersChecked: number;
	/** Number of rate-limited indexers found */
	readonly indexersRateLimited: number;
	/** Error message if check failed */
	readonly error?: string;
	/** Timestamp of the health check */
	readonly checkedAt: Date;
}

export interface CachedIndexerHealth {
	/** Prowlarr instance ID */
	readonly instanceId: number;
	/** Indexer ID in Prowlarr */
	readonly indexerId: number;
	/** Indexer display name */
	readonly name: string;
	/** Whether indexer is enabled in Prowlarr */
	readonly enabled: boolean;
	/** Whether indexer is currently rate-limited */
	readonly isRateLimited: boolean;
	/** When rate-limit expires (null if not rate-limited) */
	readonly rateLimitExpiresAt: Date | null;
	/** Most recent failure time (null if none) */
	readonly mostRecentFailure: Date | null;
	/** When this cache entry was last updated */
	readonly lastUpdated: Date;
	/** True if cache is stale (exceeds stale threshold) */
	readonly isStale: boolean;
}

export interface HealthSummary {
	/** Total number of Prowlarr instances configured */
	readonly totalInstances: number;
	/** Number of instances in healthy status */
	readonly healthyInstances: number;
	/** Total number of indexers across all instances */
	readonly totalIndexers: number;
	/** Number of indexers currently rate-limited */
	readonly rateLimitedIndexers: number;
}

export interface HealthMonitorConfig {
	/** Health check interval in milliseconds (default: 5 minutes) */
	readonly checkIntervalMs?: number;
	/** Cache stale threshold in milliseconds (default: 10 minutes) */
	readonly staleThresholdMs?: number;
}
