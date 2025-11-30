/**
 * Sync health status management.
 *
 * Provides logic for determining and updating connector health status
 * based on sync operation results and consecutive failure counts.
 *
 * This module re-exports pure utility functions from health-utils.ts
 * and provides the database-dependent updateHealthFromSyncResult function.
 *
 * @module services/sync/health
 * @requirements 2.6
 */

import { updateConnectorHealth } from '$lib/server/db/queries/connectors';
import {
	determineHealthStatus,
	shouldRetrySync,
	calculateSyncBackoffDelay,
	type HealthStatus,
	type SyncFailureContext
} from './health-utils';

// Re-export pure functions and types from health-utils
export {
	determineHealthStatus,
	shouldRetrySync,
	calculateSyncBackoffDelay,
	type HealthStatus,
	type SyncFailureContext
};

/**
 * Updates connector health status based on sync result.
 *
 * This is the main entry point for health status updates after sync operations.
 * It determines the appropriate status and persists it to the database.
 *
 * @param connectorId - ID of the connector to update
 * @param success - Whether the sync succeeded
 * @param consecutiveFailures - Number of consecutive failures
 * @param error - The error if sync failed (used for error-type-specific handling)
 * @returns The new health status that was set
 *
 * @example
 * ```typescript
 * // After successful sync
 * const status = await updateHealthFromSyncResult(connectorId, true, 0);
 * // status === 'healthy'
 *
 * // After 3rd consecutive failure
 * const status = await updateHealthFromSyncResult(connectorId, false, 3, error);
 * // status === 'degraded' (below unhealthy threshold)
 * ```
 */
export async function updateHealthFromSyncResult(
	connectorId: number,
	success: boolean,
	consecutiveFailures: number,
	error?: unknown
): Promise<HealthStatus> {
	const newStatus = determineHealthStatus(success, consecutiveFailures, error);

	await updateConnectorHealth(connectorId, newStatus);

	return newStatus;
}
