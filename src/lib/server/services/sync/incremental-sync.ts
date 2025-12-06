/**
 * Incremental sync service orchestrator
 *
 * Main entry point for syncing content from *arr applications to the content mirror.
 * Routes to appropriate handler based on connector type and manages sync state.
 *
 * @module services/sync/incremental-sync

 */

import { db } from '$lib/server/db';
import { syncState, type Connector } from '$lib/server/db/schema';
import { sql } from 'drizzle-orm';
import {
	getDecryptedApiKey,
	updateConnectorLastSync
} from '$lib/server/db/queries/connectors';
import { SonarrClient } from '$lib/server/connectors/sonarr/client';
import { RadarrClient } from '$lib/server/connectors/radarr/client';
import { WhisparrClient } from '$lib/server/connectors/whisparr/client';
import { syncSonarrContent } from './handlers/sonarr';
import { syncRadarrMovies } from './handlers/radarr';
import { withSyncRetry } from './with-sync-retry';
import type { SyncResult, SyncOptions } from './types';

/**
 * Run an incremental sync for a connector.
 *
 * This function:
 * 1. Validates the connector is enabled
 * 2. Optionally wraps with retry logic (unless skipRetry is set)
 * 3. Decrypts the API key
 * 4. Creates the appropriate client based on connector type
 * 5. Calls the type-specific sync handler
 * 6. Updates sync state on success/failure
 * 7. Updates connector health status based on consecutive failures
 * 8. Updates the connector's lastSync timestamp
 *
 * @param connector - The connector to sync
 * @param options - Optional sync configuration
 * @returns Result of the sync operation including health status
 *
 * @example
 * ```typescript
 * const connector = await getConnector(1);
 * const result = await runIncrementalSync(connector);
 *
 * if (result.success) {
 *   console.log(`Synced ${result.itemsSynced} items in ${result.durationMs}ms`);
 *   console.log(`Health status: ${result.healthStatus}`);
 * } else {
 *   console.error(`Sync failed after ${result.attempts} attempts: ${result.error}`);
 * }
 * ```
 *

 */
export async function runIncrementalSync(
	connector: Connector,
	options?: SyncOptions
): Promise<SyncResult> {
	const startTime = Date.now();

	// Validate connector is enabled
	if (!connector.enabled) {
		return {
			success: false,
			connectorId: connector.id,
			connectorType: connector.type as 'sonarr' | 'radarr' | 'whisparr',
			itemsSynced: 0,
			durationMs: Date.now() - startTime,
			error: 'Connector is disabled',
			attempts: 1,
			healthStatus: 'unknown'
		};
	}

	// Execute with or without retry wrapper
	if (options?.skipRetry === true) {
		// Direct execution without retry wrapper (for testing or forced sync)
		return executeIncrementalSync(connector, options, startTime);
	}

	// Use retry wrapper for normal execution
	const retryResult = await withSyncRetry(
		connector.id,
		() => executeIncrementalSync(connector, options, startTime)
	);

	if (retryResult.success && retryResult.data !== undefined) {
		return {
			...retryResult.data,
			attempts: retryResult.attempts,
			healthStatus: retryResult.finalHealthStatus
		};
	}

	return {
		success: false,
		connectorId: connector.id,
		connectorType: connector.type as 'sonarr' | 'radarr' | 'whisparr',
		itemsSynced: 0,
		durationMs: Date.now() - startTime,
		error: retryResult.error instanceof Error ? retryResult.error.message : 'Unknown error',
		attempts: retryResult.attempts,
		healthStatus: retryResult.finalHealthStatus
	};
}

/**
 * Execute the incremental sync logic without retry wrapper.
 * This is the core sync implementation that can be wrapped with retry logic.
 *
 * @internal
 */
async function executeIncrementalSync(
	connector: Connector,
	options: SyncOptions | undefined,
	startTime: number
): Promise<SyncResult> {
	try {
		// Decrypt API key
		const apiKey = await getDecryptedApiKey(connector);

		// Create client configuration
		const clientConfig = {
			baseUrl: connector.url,
			apiKey,
			timeout: 60000 // 60s timeout for sync operations
		};

		// Execute sync based on connector type
		let itemsSynced: number;

		switch (connector.type) {
			case 'sonarr': {
				const client = new SonarrClient(clientConfig);
				itemsSynced = await syncSonarrContent(client, connector.id, options);
				break;
			}
			case 'whisparr': {
				const client = new WhisparrClient(clientConfig);
				itemsSynced = await syncSonarrContent(client, connector.id, options);
				break;
			}
			case 'radarr': {
				const client = new RadarrClient(clientConfig);
				itemsSynced = await syncRadarrMovies(client, connector.id);
				break;
			}
			default:
				throw new Error(`Unknown connector type: ${connector.type}`);
		}

		// Update sync state on success
		await updateSyncState(connector.id, true);

		// Update connector's lastSync timestamp
		await updateConnectorLastSync(connector.id);

		return {
			success: true,
			connectorId: connector.id,
			connectorType: connector.type as 'sonarr' | 'radarr' | 'whisparr',
			itemsSynced,
			durationMs: Date.now() - startTime
		};
	} catch (error) {
		// Update sync state on failure
		await updateSyncState(connector.id, false);

		// Re-throw to let the retry wrapper handle it
		// If skipRetry was used, the error will propagate up
		throw error;
	}
}

/**
 * Update sync state for a connector.
 *
 * On success: Sets lastSync to now, resets consecutiveFailures to 0
 * On failure: Increments consecutiveFailures
 *
 * Uses upsert pattern to handle first sync (insert) vs subsequent syncs (update)
 */
async function updateSyncState(connectorId: number, success: boolean): Promise<void> {
	const now = new Date();

	await db
		.insert(syncState)
		.values({
			connectorId,
			lastSync: now,
			consecutiveFailures: success ? 0 : 1
		})
		.onConflictDoUpdate({
			target: syncState.connectorId,
			set: success
				? {
						lastSync: now,
						consecutiveFailures: 0,
						updatedAt: now
					}
				: {
						consecutiveFailures: sql`${syncState.consecutiveFailures} + 1`,
						updatedAt: now
					}
		});
}
