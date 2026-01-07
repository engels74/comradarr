export { pruneSearchHistory } from './history-pruning';
export { runDatabaseMaintenance } from './maintenance-service';
export { cleanupOrphanedSearchState } from './orphan-cleanup';
export type {
	HistoryPruningResult,
	MaintenanceOptions,
	MaintenanceResult,
	OrphanCleanupResult
} from './types';
