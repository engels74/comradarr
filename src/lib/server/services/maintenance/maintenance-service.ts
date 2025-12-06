/**
 * Database maintenance service.
 *
 * Provides VACUUM and ANALYZE operations for PostgreSQL database optimization.
 *
 * VACUUM reclaims storage occupied by dead tuples and makes it available for reuse.
 * ANALYZE collects statistics about table contents for the query planner.
 *
 * @module services/maintenance/maintenance-service

 */

import { db } from '$lib/server/db';
import { sql } from 'drizzle-orm';
import type { MaintenanceOptions, MaintenanceResult } from './types';
import { createLogger } from '$lib/server/logger';

const logger = createLogger('maintenance');

// =============================================================================
// Public API
// =============================================================================

/**
 * Run database maintenance operations (VACUUM and ANALYZE).
 *
 * This function executes:
 * 1. VACUUM - Reclaims storage from dead tuples
 * 2. ANALYZE - Updates statistics for the query planner
 *
 * Uses regular VACUUM by default (not VACUUM FULL) because:
 * - Regular VACUUM doesn't lock tables
 * - Can run concurrently with normal database operations
 * - Sufficient for routine maintenance
 *
 * @param options - Optional configuration for maintenance operations
 * @returns Result with success status and timing metrics
 *
 * @example
 * ```typescript
 * const result = await runDatabaseMaintenance();
 * if (result.success) {
 *   console.log('Maintenance completed in', result.totalDurationMs, 'ms');
 * }
 * ```
 */
export async function runDatabaseMaintenance(
	options?: MaintenanceOptions
): Promise<MaintenanceResult> {
	const startTime = Date.now();
	let vacuumDurationMs = 0;
	let analyzeDurationMs = 0;

	try {
		logger.info('Starting database maintenance');

		// 1. Run VACUUM
		const vacuumStart = Date.now();
		if (options?.vacuumFull) {
			// VACUUM FULL rewrites the entire table - use with caution
			// This locks the table and can take significant time
			logger.info('Running VACUUM FULL');
			await db.execute(sql`VACUUM FULL`);
		} else {
			// Regular VACUUM - can run concurrently with normal operations
			logger.info('Running VACUUM');
			await db.execute(sql`VACUUM`);
		}
		vacuumDurationMs = Date.now() - vacuumStart;
		logger.info('VACUUM completed', { durationMs: vacuumDurationMs });

		// 2. Run ANALYZE
		const analyzeStart = Date.now();
		if (options?.analyzeTables && options.analyzeTables.length > 0) {
			// Analyze specific tables
			for (const table of options.analyzeTables) {
				logger.info('Running ANALYZE on table', { table });
				// Use sql.raw for table name since it can't be parameterized
				// Note: Table names should be validated/sanitized by caller
				await db.execute(sql.raw(`ANALYZE ${table}`));
			}
		} else {
			// Analyze all tables
			logger.info('Running ANALYZE on all tables');
			await db.execute(sql`ANALYZE`);
		}
		analyzeDurationMs = Date.now() - analyzeStart;
		logger.info('ANALYZE completed', { durationMs: analyzeDurationMs });

		const totalDurationMs = Date.now() - startTime;
		logger.info('Database maintenance completed successfully', {
			vacuumDurationMs,
			analyzeDurationMs,
			totalDurationMs
		});

		return {
			success: true,
			vacuumDurationMs,
			analyzeDurationMs,
			totalDurationMs
		};
	} catch (error) {
		const totalDurationMs = Date.now() - startTime;
		const errorMessage = error instanceof Error ? error.message : String(error);

		logger.error('Database maintenance failed', {
			error: errorMessage,
			vacuumDurationMs,
			analyzeDurationMs,
			totalDurationMs
		});

		return {
			success: false,
			vacuumDurationMs,
			analyzeDurationMs,
			totalDurationMs,
			error: errorMessage
		};
	}
}
