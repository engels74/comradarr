/**
 * Sync services for content mirror maintenance.
 *
 * @module services/sync
 */

// Sync configuration
export { SYNC_CONFIG, type SyncConfig } from './config';
export { runFullReconciliation } from './full-reconciliation';
// Re-export database-dependent functions
export { updateHealthFromSyncResult } from './health';
// Re-export pure utility functions (usable in unit tests without database)
export {
	calculateSyncBackoffDelay,
	determineHealthStatus,
	type HealthStatus,
	type SyncFailureContext,
	shouldRetrySync
} from './health-utils';
export { runIncrementalSync } from './incremental-sync';
export { mapEpisodeToDb, mapMovieToDb, mapSeasonToDb, mapSeriesToDb } from './mappers';
export {
	deleteSearchRegistryForContent,
	deleteSearchRegistryForEpisodes,
	deleteSearchRegistryForMovies
} from './search-state-cleanup';
export type { ReconciliationResult, SyncOptions, SyncResult, SyncStats } from './types';
export { type SyncAttemptResult, type SyncRetryOptions, withSyncRetry } from './with-sync-retry';
