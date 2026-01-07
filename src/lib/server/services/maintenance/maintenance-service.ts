import { sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { createLogger } from '$lib/server/logger';
import type { MaintenanceOptions, MaintenanceResult } from './types';

const logger = createLogger('maintenance');

// Regular VACUUM (default) doesn't lock tables and runs concurrently with normal operations
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
