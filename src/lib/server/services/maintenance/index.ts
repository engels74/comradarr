export { recoverExhaustedItems } from './backlog-recovery';
export { pruneSearchHistory } from './history-pruning';
export { runDatabaseMaintenance } from './maintenance-service';
export { cleanupOrphanedSearchState } from './orphan-cleanup';
export type {
	BacklogRecoveryResult,
	HistoryPruningResult,
	MaintenanceOptions,
	MaintenanceResult,
	OrphanCleanupResult
} from './types';
