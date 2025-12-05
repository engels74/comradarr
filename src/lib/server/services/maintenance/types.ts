/**
 * Types for the database maintenance service.
 *
 * @module services/maintenance/types
 * @requirements 13.1
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
