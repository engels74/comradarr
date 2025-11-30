/**
 * TypeScript interfaces for Prowlarr API responses and client configuration.
 *
 * Prowlarr is an indexer manager that tracks indexer health and rate-limiting status.
 * These types represent data from Prowlarr's API v1.
 *
 * @module services/prowlarr/types
 * @requirements 38.2, 38.3
 */

/**
 * Indexer status response from Prowlarr API.
 * Retrieved via GET /api/v1/indexerstatus
 *
 * This endpoint returns the current operational status of indexers,
 * including rate-limiting information.
 *
 * @requirements 38.2
 */
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

/**
 * Indexer definition from Prowlarr API.
 * Retrieved via GET /api/v1/indexer
 *
 * Contains the indexer configuration and metadata.
 */
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

/**
 * Combined indexer health information for Comradarr consumption.
 *
 * Joins indexer definitions with status to provide a unified view
 * of indexer availability and rate-limiting.
 *
 * @requirements 38.3
 */
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

/**
 * Configuration for ProwlarrClient.
 *
 * @requirements 38.1
 */
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

/**
 * Health status values for Prowlarr instances in Comradarr.
 */
export type ProwlarrHealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'offline' | 'unknown';
