/**
 * Sync services for content mirror maintenance.
 *
 * @module services/sync
 */

export { runIncrementalSync } from './incremental-sync';
export { runFullReconciliation } from './full-reconciliation';
export type { SyncResult, SyncOptions, SyncStats, ReconciliationResult } from './types';
export { mapSeriesToDb, mapSeasonToDb, mapEpisodeToDb, mapMovieToDb } from './mappers';
export {
	deleteSearchRegistryForContent,
	deleteSearchRegistryForEpisodes,
	deleteSearchRegistryForMovies
} from './search-state-cleanup';

// Sync failure handling (Requirement 2.6)
export { SYNC_CONFIG, type SyncConfig } from './config';
// Re-export pure utility functions (usable in unit tests without database)
export {
	determineHealthStatus,
	shouldRetrySync,
	calculateSyncBackoffDelay,
	type HealthStatus,
	type SyncFailureContext
} from './health-utils';
// Re-export database-dependent functions
export { updateHealthFromSyncResult } from './health';
export { withSyncRetry, type SyncAttemptResult, type SyncRetryOptions } from './with-sync-retry';
