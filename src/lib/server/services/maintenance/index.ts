/**
 * Database maintenance service for PostgreSQL optimization.
 *
 * Provides:
 * - VACUUM: Reclaims storage from dead tuples
 * - ANALYZE: Updates statistics for the query planner
 *
 * Usage:
 * ```typescript
 * import { runDatabaseMaintenance } from '$lib/server/services/maintenance';
 *
 * // Run maintenance with default options
 * const result = await runDatabaseMaintenance();
 *
 * // Run with VACUUM FULL (more thorough but locks tables)
 * const result = await runDatabaseMaintenance({ vacuumFull: true });
 * ```
 *
 * @module services/maintenance
 * @requirements 13.1
 */

// =============================================================================
// Types
// =============================================================================

export type { MaintenanceOptions, MaintenanceResult } from './types';

// =============================================================================
// Service
// =============================================================================

export { runDatabaseMaintenance } from './maintenance-service';
