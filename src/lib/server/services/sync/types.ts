/**
 * Type definitions for the sync service.
 *
 * @module services/sync/types
 * @requirements 2.1, 2.2, 2.6
 */

import type { HealthStatus } from './health';

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
	/** Number of attempts made (1 if no retries needed) */
	attempts?: number;
	/** Final connector health status after sync */
	healthStatus?: HealthStatus;
}

/**
 * Result of a full reconciliation operation.
 *
 * Full reconciliation differs from incremental sync by also deleting
 * items that no longer exist in the *arr application and cleaning up
 * associated search state.
 *
 * @requirements 2.2, 2.6
 */
export interface ReconciliationResult {
	/** Whether the reconciliation completed successfully */
	success: boolean;
	/** ID of the connector that was reconciled */
	connectorId: number;
	/** Type of the connector */
	connectorType: 'sonarr' | 'radarr' | 'whisparr';
	/** Number of new items created in content mirror */
	itemsCreated: number;
	/** Number of existing items updated */
	itemsUpdated: number;
	/** Number of items deleted from content mirror */
	itemsDeleted: number;
	/** Number of search registry entries deleted for removed content */
	searchStateDeleted: number;
	/** Duration of the reconciliation operation in milliseconds */
	durationMs: number;
	/** Error message if reconciliation failed */
	error?: string;
	/** Number of attempts made (1 if no retries needed) */
	attempts?: number;
	/** Final connector health status after reconciliation */
	healthStatus?: HealthStatus;
}

/**
 * Options for configuring sync behavior.
 */
export interface SyncOptions {
	/** Concurrency limit for parallel episode fetching (default: 5) */
	concurrency?: number;
	/** Delay between API requests in ms to avoid rate limits (default: 100) */
	requestDelayMs?: number;
	/** Skip retry wrapper and execute sync directly (useful for testing or forced sync) */
	skipRetry?: boolean;
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
