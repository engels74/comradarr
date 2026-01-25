import { getSettingWithDefault } from '$lib/server/db/queries/settings';
import { createLogger } from '$lib/server/logger';
import { deleteLogsBefore } from '$lib/server/services/log-persistence';
import type { LogPruningResult } from '$lib/server/services/log-persistence/types';

const logger = createLogger('log-pruning');

const DEFAULT_RETENTION_DAYS = 14;
const BATCH_SIZE = 10000;

export async function pruneApplicationLogs(retentionDays?: number): Promise<LogPruningResult> {
	const startTime = Date.now();
	let totalDeleted = 0;

	try {
		const effectiveRetentionDays = retentionDays ?? (await getRetentionDaysFromSettings());

		logger.info('Starting log pruning', {
			retentionDays: effectiveRetentionDays
		});

		const cutoffDate = new Date();
		cutoffDate.setDate(cutoffDate.getDate() - effectiveRetentionDays);

		let deletedInBatch: number;
		do {
			deletedInBatch = await deleteLogsBefore(cutoffDate, BATCH_SIZE);
			totalDeleted += deletedInBatch;

			if (deletedInBatch > 0) {
				logger.info('Log batch deleted', {
					batchSize: deletedInBatch,
					totalDeleted
				});
			}
		} while (deletedInBatch === BATCH_SIZE);

		const durationMs = Date.now() - startTime;

		if (totalDeleted > 0) {
			logger.info('Log pruning completed', {
				logsDeleted: totalDeleted,
				retentionDays: effectiveRetentionDays,
				cutoffDate: cutoffDate.toISOString(),
				durationMs
			});
		} else {
			logger.info('No logs to prune');
		}

		return {
			success: true,
			logsDeleted: totalDeleted,
			durationMs
		};
	} catch (error) {
		const durationMs = Date.now() - startTime;
		const errorMessage = error instanceof Error ? error.message : String(error);

		logger.error('Log pruning failed', {
			error: errorMessage,
			logsDeleted: totalDeleted,
			durationMs
		});

		return {
			success: false,
			logsDeleted: totalDeleted,
			durationMs,
			error: errorMessage
		};
	}
}

async function getRetentionDaysFromSettings(): Promise<number> {
	const value = await getSettingWithDefault('log_retention_days');
	const parsed = parseInt(value, 10);

	if (Number.isNaN(parsed) || parsed < 1) {
		logger.warn('Invalid log retention days setting, using default', {
			value,
			default: DEFAULT_RETENTION_DAYS
		});
		return DEFAULT_RETENTION_DAYS;
	}

	return parsed;
}
