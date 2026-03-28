export {
	deleteLogsBefore,
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
	enableLogPersistence,
	flush,
	isLogPersistenceEnabled,
	shutdown
} from './writer';
