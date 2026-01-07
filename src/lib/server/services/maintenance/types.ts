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
