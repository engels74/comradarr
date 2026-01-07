// Unlike incremental sync which only upserts, full reconciliation also deletes removed content

import { sql } from 'drizzle-orm';
import { RadarrClient } from '$lib/server/connectors/radarr/client';
import { SonarrClient } from '$lib/server/connectors/sonarr/client';
import { WhisparrClient } from '$lib/server/connectors/whisparr/client';
import { db } from '$lib/server/db';
import { getDecryptedApiKey, updateConnectorLastSync } from '$lib/server/db/queries/connectors';
import { type Connector, syncState } from '$lib/server/db/schema';
import { createLogger } from '$lib/server/logger';
import { reconcileRadarrMovies } from './handlers/radarr-reconcile';
import { reconcileSonarrContent } from './handlers/sonarr-reconcile';
import type { ReconciliationResult, SyncOptions } from './types';
import { withSyncRetry } from './with-sync-retry';

const logger = createLogger('sync');

export async function runFullReconciliation(
	connector: Connector,
	options?: SyncOptions
): Promise<ReconciliationResult> {
	const startTime = Date.now();

	logger.debug('Starting full reconciliation', {
		connectorId: connector.id,
		connectorName: connector.name,
		type: connector.type,
		skipRetry: options?.skipRetry ?? false
	});

	// Validate connector is enabled
	if (!connector.enabled) {
		logger.warn('Full reconciliation skipped - connector disabled', {
			connectorId: connector.id,
			connectorName: connector.name
		});
		return {
			success: false,
			connectorId: connector.id,
			connectorType: connector.type as 'sonarr' | 'radarr' | 'whisparr',
			itemsCreated: 0,
			itemsUpdated: 0,
			itemsDeleted: 0,
			searchStateDeleted: 0,
			durationMs: Date.now() - startTime,
			error: 'Connector is disabled',
			attempts: 1,
			healthStatus: 'unknown'
		};
	}

	// Execute with or without retry wrapper
	if (options?.skipRetry === true) {
		// Direct execution without retry wrapper (for testing or forced sync)
		return executeFullReconciliation(connector, options, startTime);
	}

	// Use retry wrapper for normal execution
	// Fewer retries for full reconciliation since it's expensive
	const retryResult = await withSyncRetry(
		connector.id,
		() => executeFullReconciliation(connector, options, startTime),
		{ maxRetries: 2 }
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
		itemsCreated: 0,
		itemsUpdated: 0,
		itemsDeleted: 0,
		searchStateDeleted: 0,
		durationMs: Date.now() - startTime,
		error: retryResult.error instanceof Error ? retryResult.error.message : 'Unknown error',
		attempts: retryResult.attempts,
		healthStatus: retryResult.finalHealthStatus
	};
}

async function executeFullReconciliation(
	connector: Connector,
	options: SyncOptions | undefined,
	startTime: number
): Promise<ReconciliationResult> {
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

		const durationMs = Date.now() - startTime;

		logger.info('Full reconciliation completed', {
			connectorId: connector.id,
			connectorName: connector.name,
			type: connector.type,
			itemsCreated,
			itemsUpdated,
			itemsDeleted,
			searchStateDeleted,
			durationMs
		});

		return {
			success: true,
			connectorId: connector.id,
			connectorType: connector.type as 'sonarr' | 'radarr' | 'whisparr',
			itemsCreated,
			itemsUpdated,
			itemsDeleted,
			searchStateDeleted,
			durationMs
		};
	} catch (error) {
		// Update sync state on failure
		await updateReconciliationState(connector.id, false);

		logger.error('Full reconciliation failed', {
			connectorId: connector.id,
			connectorName: connector.name,
			type: connector.type,
			error: error instanceof Error ? error.message : String(error)
		});

		// Re-throw to let the retry wrapper handle it
		// If skipRetry was used, the error will propagate up
		throw error;
	}
}

// On success: resets consecutiveFailures to 0; On failure: increments consecutiveFailures
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
