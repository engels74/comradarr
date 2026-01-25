export {
	deleteLogsBefore,
	getDistinctModules,
	getLogCount,
	getOldestLogTimestamp,
	getPersistedLogLevelCounts,
	insertLogBatch,
	queryPersistedLogs
} from './queries';
export type {
	LogPersistenceFilter,
	LogPersistencePagination,
	LogPruningResult,
	PersistedLogEntry,
	PersistedLogQueryResult
} from './types';
export {
	add,
	disableLogPersistence,
	enableLogPersistence,
	flush,
	getBufferStats,
	isLogPersistenceEnabled,
	shutdown
} from './writer';
