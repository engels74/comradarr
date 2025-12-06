/**
 * History pruning service for search history maintenance.
 *
 * Deletes search_history entries older than the configured retention period.
 * Aggregated statistics in analytics_hourly_stats and analytics_daily_stats
 * are preserved (stored in separate tables).
 *
 * @module services/maintenance/history-pruning

 */

import { db } from '$lib/server/db';
import { sql } from 'drizzle-orm';
import { getSettingWithDefault } from '$lib/server/db/queries/settings';
import type { HistoryPruningResult } from './types';

// =============================================================================
// Constants
// =============================================================================

/** Default retention period in days for search history */
const DEFAULT_RETENTION_DAYS = 90;

/** Maximum records to delete per batch to avoid long locks */
const BATCH_SIZE = 10000;

// =============================================================================
// Public API
// =============================================================================

/**
 * Prune search history entries older than the retention period.
 *
 * Deletes search_history entries where createdAt < (now - retentionDays).
 * Uses batched deletion to avoid long locks on large tables.
 *
 * Aggregated statistics in analytics_hourly_stats and analytics_daily_stats
 * are NOT affected - they live in separate tables.
 *
 * @param retentionDays - Number of days to retain history. If not provided,
 *                        uses the 'history_retention_days_search' setting or
 *                        DEFAULT_RETENTION_DAYS (90).
 * @returns Result with count of deleted entries and timing metrics
 *
 * @example
 * ```typescript
 * // Use configured retention period
 * const result = await pruneSearchHistory();
 *
 * // Override with specific retention period
 * const result = await pruneSearchHistory(30);
 *
 * if (result.success) {
 *   console.log(`Pruned ${result.searchHistoryDeleted} history entries`);
 * }
 * ```
 */
export async function pruneSearchHistory(retentionDays?: number): Promise<HistoryPruningResult> {
	const startTime = Date.now();
	let totalDeleted = 0;

	try {
		// Get retention period from settings if not explicitly provided
		const effectiveRetentionDays = retentionDays ?? (await getRetentionDaysFromSettings());

		console.log('[history-pruning] Starting history pruning...', {
			retentionDays: effectiveRetentionDays
		});

		// Calculate cutoff date
		const cutoffDate = new Date();
		cutoffDate.setDate(cutoffDate.getDate() - effectiveRetentionDays);

		// Delete in batches to avoid long locks
		// Using raw SQL because Drizzle delete doesn't support LIMIT
		let deletedInBatch: number;
		do {
			const result = await db.execute(sql`
				DELETE FROM search_history
				WHERE id IN (
					SELECT id FROM search_history
					WHERE created_at < ${cutoffDate}
					LIMIT ${BATCH_SIZE}
				)
				RETURNING id
			`);

			deletedInBatch = result.length;
			totalDeleted += deletedInBatch;

			if (deletedInBatch > 0) {
				console.log('[history-pruning] Batch deleted:', {
					batchSize: deletedInBatch,
					totalDeleted
				});
			}
		} while (deletedInBatch === BATCH_SIZE);

		const durationMs = Date.now() - startTime;

		if (totalDeleted > 0) {
			console.log('[history-pruning] History pruning completed:', {
				searchHistoryDeleted: totalDeleted,
				retentionDays: effectiveRetentionDays,
				cutoffDate: cutoffDate.toISOString(),
				durationMs
			});
		} else {
			console.log('[history-pruning] No history entries to prune');
		}

		return {
			success: true,
			searchHistoryDeleted: totalDeleted,
			durationMs
		};
	} catch (error) {
		const durationMs = Date.now() - startTime;
		const errorMessage = error instanceof Error ? error.message : String(error);

		console.error('[history-pruning] History pruning failed:', {
			error: errorMessage,
			searchHistoryDeleted: totalDeleted,
			durationMs
		});

		return {
			success: false,
			searchHistoryDeleted: totalDeleted,
			durationMs,
			error: errorMessage
		};
	}
}

// =============================================================================
// Internal Functions
// =============================================================================

/**
 * Get retention days from application settings.
 *
 * @returns Retention period in days from settings or DEFAULT_RETENTION_DAYS
 */
async function getRetentionDaysFromSettings(): Promise<number> {
	const value = await getSettingWithDefault('history_retention_days_search');
	const parsed = parseInt(value, 10);

	// Validate the parsed value
	if (isNaN(parsed) || parsed < 1) {
		console.warn('[history-pruning] Invalid retention days setting, using default:', {
			value,
			default: DEFAULT_RETENTION_DAYS
		});
		return DEFAULT_RETENTION_DAYS;
	}

	return parsed;
}
