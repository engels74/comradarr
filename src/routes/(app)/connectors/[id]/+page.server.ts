import { error, fail } from '@sveltejs/kit';
import {
	AuthenticationError,
	isArrClientError,
	NetworkError,
	RadarrClient,
	SonarrClient,
	SSLError,
	TimeoutError,
	WhisparrClient
} from '$lib/server/connectors';
import { captureConnectorSnapshotAfterSync } from '$lib/server/db/queries/completion';
import {
	clearFailedSearches,
	deleteConnector,
	getConnector,
	getConnectorDetailedStats,
	getDecryptedApiKey,
	getRecentSearchHistory,
	getSearchStateDistribution,
	getSyncState,
	updateConnectorHealth
} from '$lib/server/db/queries/connectors';
import type { Connector } from '$lib/server/db/schema';
import { createLogger } from '$lib/server/logger';
import { runIncrementalSync } from '$lib/server/services/sync';
import type { Actions, PageServerLoad } from './$types';

const logger = createLogger('connectors');

function createClient(
	connector: Connector,
	apiKey: string
): SonarrClient | RadarrClient | WhisparrClient {
	const clientConfig = {
		baseUrl: connector.url,
		apiKey
	};

	switch (connector.type) {
		case 'sonarr':
			return new SonarrClient(clientConfig);
		case 'radarr':
			return new RadarrClient(clientConfig);
		case 'whisparr':
			return new WhisparrClient(clientConfig);
		default:
			throw new Error(`Unknown connector type: ${connector.type}`);
	}
}

function getErrorMessage(err: unknown): string {
	if (err instanceof AuthenticationError) {
		return 'Invalid API key. Check your API key in the *arr application settings.';
	}
	if (err instanceof NetworkError) {
		if (err.errorCause === 'connection_refused') {
			return 'Connection refused. Check the URL and ensure the application is running.';
		}
		if (err.errorCause === 'dns_failure') {
			return 'Could not resolve hostname. Check the URL is correct.';
		}
		return 'Network error. Check your connection and URL.';
	}
	if (err instanceof TimeoutError) {
		return 'Connection timed out. The server may be slow or unreachable.';
	}
	if (err instanceof SSLError) {
		return 'SSL certificate error. Check your SSL configuration.';
	}
	if (isArrClientError(err)) {
		return `Connection failed: ${err.message}`;
	}
	if (err instanceof Error) {
		return `Connection failed: ${err.message}`;
	}
	return 'An unexpected error occurred while testing the connection.';
}

export const load: PageServerLoad = async ({ params }) => {
	const id = Number(params.id);

	if (Number.isNaN(id)) {
		error(400, 'Invalid connector ID');
	}

	const connector = await getConnector(id);

	if (!connector) {
		error(404, 'Connector not found');
	}

	const [syncStateData, detailedStats, searchStateDistribution, recentSearchHistory] =
		await Promise.all([
			getSyncState(id),
			getConnectorDetailedStats(id),
			getSearchStateDistribution(id),
			getRecentSearchHistory(id, 15)
		]);

	return {
		connector,
		syncState: syncStateData,
		detailedStats,
		searchStateDistribution,
		recentSearchHistory
	};
};

export const actions: Actions = {
	testConnection: async ({ params }) => {
		const id = Number(params.id);

		if (Number.isNaN(id)) {
			logger.warn('Connection test failed - invalid ID', { rawId: params.id });
			return fail(400, { error: 'Invalid connector ID' });
		}

		const connector = await getConnector(id);

		if (!connector) {
			logger.warn('Connection test failed - not found', { connectorId: id });
			return fail(404, { error: 'Connector not found' });
		}

		try {
			const apiKey = await getDecryptedApiKey(connector);
			const client = createClient(connector, apiKey);
			const isConnected = await client.ping();

			if (isConnected) {
				await updateConnectorHealth(id, 'healthy');

				logger.info('Connection test successful', {
					connectorId: id,
					connectorName: connector.name,
					type: connector.type,
					healthStatus: 'healthy'
				});

				return {
					success: true,
					message: 'Connection successful!'
				};
			} else {
				await updateConnectorHealth(id, 'unhealthy');

				logger.warn('Connection test failed - no response', {
					connectorId: id,
					connectorName: connector.name,
					type: connector.type,
					healthStatus: 'unhealthy'
				});

				return fail(400, {
					error: 'Connection failed. The application did not respond as expected.'
				});
			}
		} catch (err) {
			let healthStatus: string;
			if (err instanceof AuthenticationError) {
				healthStatus = 'unhealthy';
				await updateConnectorHealth(id, 'unhealthy');
			} else if (err instanceof NetworkError) {
				healthStatus = 'offline';
				await updateConnectorHealth(id, 'offline');
			} else {
				healthStatus = 'unhealthy';
				await updateConnectorHealth(id, 'unhealthy');
			}

			logger.warn('Connection test failed', {
				connectorId: id,
				connectorName: connector.name,
				type: connector.type,
				healthStatus,
				error: getErrorMessage(err)
			});

			return fail(400, { error: getErrorMessage(err) });
		}
	},

	triggerSync: async ({ params }) => {
		const id = Number(params.id);

		if (Number.isNaN(id)) {
			logger.warn('Sync trigger failed - invalid ID', { rawId: params.id });
			return fail(400, { error: 'Invalid connector ID' });
		}

		const connector = await getConnector(id);

		if (!connector) {
			logger.warn('Sync trigger failed - not found', { connectorId: id });
			return fail(404, { error: 'Connector not found' });
		}

		if (!connector.enabled) {
			logger.warn('Sync trigger failed - connector disabled', {
				connectorId: id,
				connectorName: connector.name
			});
			return fail(400, { error: 'Cannot sync a disabled connector' });
		}

		logger.info('Manual sync started', {
			connectorId: connector.id,
			connectorName: connector.name,
			type: connector.type
		});

		const result = await runIncrementalSync(connector, { skipRetry: true });

		if (result.success) {
			await captureConnectorSnapshotAfterSync(connector.id);

			logger.info('Manual sync completed', {
				connectorId: connector.id,
				connectorName: connector.name,
				itemsSynced: result.itemsSynced,
				durationMs: result.durationMs
			});
			return {
				success: true,
				message: `Sync completed. ${result.itemsSynced} items synced in ${(result.durationMs / 1000).toFixed(1)}s.`
			};
		} else {
			logger.warn('Manual sync failed', {
				connectorId: connector.id,
				connectorName: connector.name,
				error: result.error
			});
			return fail(500, { error: result.error ?? 'Sync failed' });
		}
	},

	clearFailedSearches: async ({ params }) => {
		const id = Number(params.id);

		if (Number.isNaN(id)) {
			logger.warn('Clear failed searches failed - invalid ID', { rawId: params.id });
			return fail(400, { error: 'Invalid connector ID' });
		}

		const connector = await getConnector(id);

		if (!connector) {
			logger.warn('Clear failed searches failed - not found', { connectorId: id });
			return fail(404, { error: 'Connector not found' });
		}

		const clearedCount = await clearFailedSearches(id);

		logger.info('Failed searches cleared', {
			connectorId: id,
			connectorName: connector.name,
			clearedCount
		});

		return {
			success: true,
			message: `Cleared ${clearedCount} failed search${clearedCount === 1 ? '' : 'es'}.`
		};
	},

	delete: async ({ params }) => {
		const id = Number(params.id);

		if (Number.isNaN(id)) {
			logger.warn('Delete connector failed - invalid ID', { rawId: params.id });
			return fail(400, { error: 'Invalid connector ID' });
		}

		const connector = await getConnector(id);

		if (!connector) {
			logger.warn('Delete connector failed - not found', { connectorId: id });
			return fail(404, { error: 'Connector not found' });
		}

		logger.info('Connector deleted', {
			connectorId: id,
			connectorName: connector.name,
			type: connector.type
		});

		await deleteConnector(id);

		return {
			success: true,
			message: 'Connector deleted successfully',
			redirectTo: '/connectors'
		};
	}
};
