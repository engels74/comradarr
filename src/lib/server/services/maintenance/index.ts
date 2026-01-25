export type { LogPruningResult } from '$lib/server/services/log-persistence/types';
export { recoverExhaustedItems } from './backlog-recovery';
export { pruneSearchHistory } from './history-pruning';
export { pruneApplicationLogs } from './log-pruning';
export { runDatabaseMaintenance } from './maintenance-service';
export { cleanupOrphanedSearchState } from './orphan-cleanup';
export type {
	BacklogRecoveryResult,
	HistoryPruningResult,
	MaintenanceOptions,
	MaintenanceResult,
	OrphanCleanupResult
} from './types';
