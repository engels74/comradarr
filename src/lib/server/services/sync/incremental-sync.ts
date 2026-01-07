import { sql } from 'drizzle-orm';
import { RadarrClient } from '$lib/server/connectors/radarr/client';
import { SonarrClient } from '$lib/server/connectors/sonarr/client';
import { WhisparrClient } from '$lib/server/connectors/whisparr/client';
import { db } from '$lib/server/db';
import { getDecryptedApiKey, updateConnectorLastSync } from '$lib/server/db/queries/connectors';
import { type Connector, syncState } from '$lib/server/db/schema';
import { createLogger } from '$lib/server/logger';
import { syncRadarrMovies } from './handlers/radarr';
import { syncSonarrContent } from './handlers/sonarr';
import type { SyncOptions, SyncResult } from './types';
import { withSyncRetry } from './with-sync-retry';

const logger = createLogger('sync');

export async function runIncrementalSync(
	connector: Connector,
	options?: SyncOptions
): Promise<SyncResult> {
	const startTime = Date.now();

	logger.debug('Starting incremental sync', {
		connectorId: connector.id,
		connectorName: connector.name,
		type: connector.type,
		skipRetry: options?.skipRetry ?? false
	});

	if (!connector.enabled) {
		logger.warn('Incremental sync skipped - connector disabled', {
			connectorId: connector.id,
			connectorName: connector.name
		});
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

	if (options?.skipRetry === true) {
		return executeIncrementalSync(connector, options, startTime);
	}

	const retryResult = await withSyncRetry(connector.id, () =>
		executeIncrementalSync(connector, options, startTime)
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

async function executeIncrementalSync(
	connector: Connector,
	options: SyncOptions | undefined,
	startTime: number
): Promise<SyncResult> {
	try {
		const apiKey = await getDecryptedApiKey(connector);
		const clientConfig = {
			baseUrl: connector.url,
			apiKey,
			timeout: 60000
		};

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

		await updateSyncState(connector.id, true);
		await updateConnectorLastSync(connector.id);

		const durationMs = Date.now() - startTime;

		logger.info('Incremental sync completed', {
			connectorId: connector.id,
			connectorName: connector.name,
			type: connector.type,
			itemsSynced,
			durationMs
		});

		return {
			success: true,
			connectorId: connector.id,
			connectorType: connector.type as 'sonarr' | 'radarr' | 'whisparr',
			itemsSynced,
			durationMs
		};
	} catch (error) {
		await updateSyncState(connector.id, false);

		logger.error('Incremental sync failed', {
			connectorId: connector.id,
			connectorName: connector.name,
			type: connector.type,
			error: error instanceof Error ? error.message : String(error)
		});

		throw error;
	}
}

// On success: resets consecutiveFailures to 0; On failure: increments consecutiveFailures
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
