/**
 * Types for the database maintenance service.
 *
 * @module services/maintenance/types

 */

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Options for database maintenance operations.
 */
export interface MaintenanceOptions {
	/**
	 * Use VACUUM FULL instead of regular VACUUM.
	 * More thorough but locks tables during operation.
	 * @default false
	 */
	vacuumFull?: boolean;

	/**
	 * Specific tables to analyze.
	 * If not provided, ANALYZE runs on all tables.
	 */
	analyzeTables?: string[];
}

// =============================================================================
// Result Types
// =============================================================================

/**
 * Result of a database maintenance operation.
 */
export interface MaintenanceResult {
	/** Whether the maintenance operation completed successfully */
	success: boolean;

	/** Time taken for VACUUM operation in milliseconds */
	vacuumDurationMs: number;

	/** Time taken for ANALYZE operation in milliseconds */
	analyzeDurationMs: number;

	/** Total time for all maintenance operations in milliseconds */
	totalDurationMs: number;

	/** Error message if maintenance failed */
	error?: string;
}

// =============================================================================
// Orphan Cleanup Types (Requirement 13.2)
// =============================================================================

/**
 * Result of an orphan cleanup operation.
 *
 * Orphan cleanup deletes search_registry entries that reference
 * content_id values that no longer exist in the episodes or movies tables.
 */
export interface OrphanCleanupResult {
	/** Whether the orphan cleanup operation completed successfully */
	success: boolean;

	/** Number of orphaned episode search registry entries deleted */
	episodeOrphansDeleted: number;

	/** Number of orphaned movie search registry entries deleted */
	movieOrphansDeleted: number;

	/** Total number of orphaned entries deleted */
	totalOrphansDeleted: number;

	/** Time taken for the cleanup operation in milliseconds */
	durationMs: number;

	/** Error message if cleanup failed */
	error?: string;
}

// =============================================================================
// History Pruning Types (Requirement 13.3)
// =============================================================================

/**
 * Result of a history pruning operation.
 *
 * History pruning deletes search_history entries older than the configured
 * retention period. Aggregated statistics in analytics_hourly_stats and
 * analytics_daily_stats are preserved.
 */
export interface HistoryPruningResult {
	/** Whether the history pruning operation completed successfully */
	success: boolean;

	/** Number of search_history entries deleted */
	searchHistoryDeleted: number;

	/** Time taken for the pruning operation in milliseconds */
	durationMs: number;

	/** Error message if pruning failed */
	error?: string;
}
