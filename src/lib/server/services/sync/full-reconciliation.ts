/**
 * Full reconciliation service orchestrator
 *
 * Main entry point for full library reconciliation with *arr applications.
 * Unlike incremental sync which only upserts, full reconciliation also
 * deletes content that no longer exists in the *arr application.
 *
 * @module services/sync/full-reconciliation
 * @requirements 2.2
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
import { reconcileSonarrContent } from './handlers/sonarr-reconcile';
import { reconcileRadarrMovies } from './handlers/radarr-reconcile';
import type { ReconciliationResult, SyncOptions } from './types';

/**
 * Run a full reconciliation for a connector.
 *
 * Full reconciliation differs from incremental sync in that it:
 * 1. Fetches the complete library from the *arr application
 * 2. Compares with the content mirror in the database
 * 3. Inserts new items, updates changed items, AND deletes removed items
 * 4. Cascades delete search state for removed content
 *
 * This function:
 * 1. Validates the connector is enabled
 * 2. Decrypts the API key
 * 3. Creates the appropriate client based on connector type
 * 4. Calls the type-specific reconciliation handler
 * 5. Updates syncState.lastReconciliation timestamp
 * 6. Updates the connector's lastSync timestamp
 *
 * @param connector - The connector to reconcile
 * @param options - Optional sync configuration
 * @returns Detailed result of the reconciliation operation
 *
 * @example
 * ```typescript
 * const connector = await getConnector(1);
 * const result = await runFullReconciliation(connector);
 *
 * if (result.success) {
 *   console.log(`Created: ${result.itemsCreated}, Updated: ${result.itemsUpdated}, Deleted: ${result.itemsDeleted}`);
 * } else {
 *   console.error(`Reconciliation failed: ${result.error}`);
 * }
 * ```
 *
 * @requirements 2.2 - Full reconciliation with deletion of removed items and cascade to search state
 */
export async function runFullReconciliation(
	connector: Connector,
	options?: SyncOptions
): Promise<ReconciliationResult> {
	const startTime = Date.now();

	// Validate connector is enabled
	if (!connector.enabled) {
		return {
			success: false,
			connectorId: connector.id,
			connectorType: connector.type as 'sonarr' | 'radarr' | 'whisparr',
			itemsCreated: 0,
			itemsUpdated: 0,
			itemsDeleted: 0,
			searchStateDeleted: 0,
			durationMs: Date.now() - startTime,
			error: 'Connector is disabled'
		};
	}

	try {
		// Decrypt API key
		const apiKey = await getDecryptedApiKey(connector);

		// Create client configuration
		const clientConfig = {
			baseUrl: connector.url,
			apiKey,
			timeout: 120000 // 120s timeout for reconciliation operations (longer than sync)
		};

		// Execute reconciliation based on connector type
		let itemsCreated: number;
		let itemsUpdated: number;
		let itemsDeleted: number;
		let searchStateDeleted: number;

		switch (connector.type) {
			case 'sonarr': {
				const client = new SonarrClient(clientConfig);
				const result = await reconcileSonarrContent(client, connector.id, options);
				itemsCreated = result.seriesCreated + result.episodesCreated;
				itemsUpdated = result.seriesUpdated + result.episodesUpdated;
				itemsDeleted = result.seriesDeleted + result.episodesDeleted;
				searchStateDeleted = result.searchStateDeleted;
				break;
			}
			case 'whisparr': {
				const client = new WhisparrClient(clientConfig);
				const result = await reconcileSonarrContent(client, connector.id, options);
				itemsCreated = result.seriesCreated + result.episodesCreated;
				itemsUpdated = result.seriesUpdated + result.episodesUpdated;
				itemsDeleted = result.seriesDeleted + result.episodesDeleted;
				searchStateDeleted = result.searchStateDeleted;
				break;
			}
			case 'radarr': {
				const client = new RadarrClient(clientConfig);
				const result = await reconcileRadarrMovies(client, connector.id);
				itemsCreated = result.moviesCreated;
				itemsUpdated = result.moviesUpdated;
				itemsDeleted = result.moviesDeleted;
				searchStateDeleted = result.searchStateDeleted;
				break;
			}
			default:
				throw new Error(`Unknown connector type: ${connector.type}`);
		}

		// Update sync state with lastReconciliation timestamp
		await updateReconciliationState(connector.id, true);

		// Update connector's lastSync timestamp
		await updateConnectorLastSync(connector.id);

		return {
			success: true,
			connectorId: connector.id,
			connectorType: connector.type as 'sonarr' | 'radarr' | 'whisparr',
			itemsCreated,
			itemsUpdated,
			itemsDeleted,
			searchStateDeleted,
			durationMs: Date.now() - startTime
		};
	} catch (error) {
		// Update sync state on failure
		await updateReconciliationState(connector.id, false);

		return {
			success: false,
			connectorId: connector.id,
			connectorType: connector.type as 'sonarr' | 'radarr' | 'whisparr',
			itemsCreated: 0,
			itemsUpdated: 0,
			itemsDeleted: 0,
			searchStateDeleted: 0,
			durationMs: Date.now() - startTime,
			error: error instanceof Error ? error.message : 'Unknown error'
		};
	}
}

/**
 * Update reconciliation state for a connector.
 *
 * On success: Sets lastReconciliation to now, resets consecutiveFailures to 0
 * On failure: Increments consecutiveFailures
 *
 * Uses upsert pattern to handle first reconciliation (insert) vs subsequent ones (update)
 */
async function updateReconciliationState(connectorId: number, success: boolean): Promise<void> {
	const now = new Date();

	await db
		.insert(syncState)
		.values({
			connectorId,
			lastReconciliation: now,
			consecutiveFailures: success ? 0 : 1
		})
		.onConflictDoUpdate({
			target: syncState.connectorId,
			set: success
				? {
						lastReconciliation: now,
						consecutiveFailures: 0,
						updatedAt: now
					}
				: {
						consecutiveFailures: sql`${syncState.consecutiveFailures} + 1`,
						updatedAt: now
					}
		});
}
