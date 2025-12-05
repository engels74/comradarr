/**
 * Database maintenance service for PostgreSQL optimization.
 *
 * Provides:
 * - VACUUM: Reclaims storage from dead tuples
 * - ANALYZE: Updates statistics for the query planner
 * - Orphan cleanup: Removes search_registry entries without content mirror items
 *
 * Usage:
 * ```typescript
 * import { runDatabaseMaintenance, cleanupOrphanedSearchState } from '$lib/server/services/maintenance';
 *
 * // Run maintenance with default options
 * const result = await runDatabaseMaintenance();
 *
 * // Run with VACUUM FULL (more thorough but locks tables)
 * const result = await runDatabaseMaintenance({ vacuumFull: true });
 *
 * // Clean up orphaned search state entries
 * const orphanResult = await cleanupOrphanedSearchState();
 * ```
 *
 * @module services/maintenance
 * @requirements 13.1, 13.2
 */

// =============================================================================
// Types
// =============================================================================

export type { MaintenanceOptions, MaintenanceResult, OrphanCleanupResult } from './types';

// =============================================================================
// Services
// =============================================================================

export { runDatabaseMaintenance } from './maintenance-service';
export { cleanupOrphanedSearchState } from './orphan-cleanup';
