/**
 * Type definitions for the sync service.
 *
 * @module services/sync/types
 * @requirements 2.1
 */

/**
 * Result of an incremental sync operation.
 */
export interface SyncResult {
	/** Whether the sync completed successfully */
	success: boolean;
	/** ID of the connector that was synced */
	connectorId: number;
	/** Type of the connector */
	connectorType: 'sonarr' | 'radarr' | 'whisparr';
	/** Number of items processed during sync */
	itemsSynced: number;
	/** Duration of the sync operation in milliseconds */
	durationMs: number;
	/** Error message if sync failed */
	error?: string;
}

/**
 * Options for configuring sync behavior.
 */
export interface SyncOptions {
	/** Concurrency limit for parallel episode fetching (default: 5) */
	concurrency?: number;
	/** Delay between API requests in ms to avoid rate limits (default: 100) */
	requestDelayMs?: number;
}

/**
 * Internal statistics tracked during sync.
 */
export interface SyncStats {
	seriesCount: number;
	seasonCount: number;
	episodeCount: number;
	movieCount: number;
}
