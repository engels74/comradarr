/**
 * Database maintenance service for PostgreSQL optimization.
 *
 * Provides:
 * - VACUUM: Reclaims storage from dead tuples
 * - ANALYZE: Updates statistics for the query planner
 * - Orphan cleanup: Removes search_registry entries without content mirror items
 * - History pruning: Removes search_history entries older than retention period
 *
 * Usage:
 * ```typescript
 * import { runDatabaseMaintenance, cleanupOrphanedSearchState, pruneSearchHistory } from '$lib/server/services/maintenance';
 *
 * // Run maintenance with default options
 * const result = await runDatabaseMaintenance();
 *
 * // Run with VACUUM FULL (more thorough but locks tables)
 * const result = await runDatabaseMaintenance({ vacuumFull: true });
 *
 * // Clean up orphaned search state entries
 * const orphanResult = await cleanupOrphanedSearchState();
 *
 * // Prune search history older than retention period
 * const historyResult = await pruneSearchHistory();
 * ```
 *
 * @module services/maintenance
 * @requirements 13.1, 13.2, 13.3
 */

// =============================================================================
// Types
// =============================================================================

export type {
	MaintenanceOptions,
	MaintenanceResult,
	OrphanCleanupResult,
	HistoryPruningResult
} from './types';

// =============================================================================
// Services
// =============================================================================

export { runDatabaseMaintenance } from './maintenance-service';
export { cleanupOrphanedSearchState } from './orphan-cleanup';
export { pruneSearchHistory } from './history-pruning';
