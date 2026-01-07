import { sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { getSettingWithDefault } from '$lib/server/db/queries/settings';
import { createLogger } from '$lib/server/logger';
import type { HistoryPruningResult } from './types';

const logger = createLogger('history-pruning');

const DEFAULT_RETENTION_DAYS = 90;
const BATCH_SIZE = 10000;

// Uses batched deletion to avoid long locks; analytics tables are not affected
export async function pruneSearchHistory(retentionDays?: number): Promise<HistoryPruningResult> {
	const startTime = Date.now();
	let totalDeleted = 0;

	try {
		// Get retention period from settings if not explicitly provided
		const effectiveRetentionDays = retentionDays ?? (await getRetentionDaysFromSettings());

		logger.info('Starting history pruning', {
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
				logger.info('Batch deleted', {
					batchSize: deletedInBatch,
					totalDeleted
				});
			}
		} while (deletedInBatch === BATCH_SIZE);

		const durationMs = Date.now() - startTime;

		if (totalDeleted > 0) {
			logger.info('History pruning completed', {
				searchHistoryDeleted: totalDeleted,
				retentionDays: effectiveRetentionDays,
				cutoffDate: cutoffDate.toISOString(),
				durationMs
			});
		} else {
			logger.info('No history entries to prune');
		}

		return {
			success: true,
			searchHistoryDeleted: totalDeleted,
			durationMs
		};
	} catch (error) {
		const durationMs = Date.now() - startTime;
		const errorMessage = error instanceof Error ? error.message : String(error);

		logger.error('History pruning failed', {
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

async function getRetentionDaysFromSettings(): Promise<number> {
	const value = await getSettingWithDefault('history_retention_days_search');
	const parsed = parseInt(value, 10);

	// Validate the parsed value
	if (Number.isNaN(parsed) || parsed < 1) {
		logger.warn('Invalid retention days setting, using default', {
			value,
			default: DEFAULT_RETENTION_DAYS
		});
		return DEFAULT_RETENTION_DAYS;
	}

	return parsed;
}
