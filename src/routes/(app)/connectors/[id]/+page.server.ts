import { error, fail } from '@sveltejs/kit';
import {
	AuthenticationError,
	createConnectorClient,
	isArrClientError,
	NetworkError,
	SSLError,
	TimeoutError
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
import { getReconnectState } from '$lib/server/db/queries/reconnect';
import { createLogger } from '$lib/server/logger';
import {
	pauseConnectorReconnect,
	resumeConnectorReconnect,
	triggerManualReconnect
} from '$lib/server/services/reconnect';
import { runIncrementalSync } from '$lib/server/services/sync';
import type { Actions, PageServerLoad } from './$types';

const logger = createLogger('connectors');

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

	const [
		syncStateData,
		detailedStats,
		searchStateDistribution,
		recentSearchHistory,
		reconnectStateData
	] = await Promise.all([
		getSyncState(id),
		getConnectorDetailedStats(id),
		getSearchStateDistribution(id),
		getRecentSearchHistory(id, 15),
		getReconnectState(id)
	]);

	return {
		connector,
		syncState: syncStateData,
		detailedStats,
		searchStateDistribution,
		recentSearchHistory,
		reconnectState: reconnectStateData
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
			const client = createConnectorClient(connector, apiKey);
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
			try {
				await captureConnectorSnapshotAfterSync(connector.id);
			} catch (snapshotError) {
				logger.warn('Failed to capture completion snapshot', {
					connectorId: connector.id,
					error: snapshotError instanceof Error ? snapshotError.message : String(snapshotError)
				});
			}

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
	},

	reconnect: async ({ params }) => {
		const id = Number(params.id);

		if (Number.isNaN(id)) {
			logger.warn('Reconnect failed - invalid ID', { rawId: params.id });
			return fail(400, { error: 'Invalid connector ID' });
		}

		try {
			const result = await triggerManualReconnect(id);

			if (result.success) {
				logger.info('Manual reconnection successful', {
					connectorId: id,
					connectorName: result.connectorName,
					newStatus: result.newStatus
				});

				return {
					success: true,
					message: `Reconnection successful! Status: ${result.newStatus}`
				};
			} else {
				logger.warn('Manual reconnection failed', {
					connectorId: id,
					connectorName: result.connectorName,
					error: result.error,
					nextReconnectAt: result.nextReconnectAt?.toISOString()
				});

				return fail(400, {
					error: result.error ?? 'Reconnection failed',
					nextReconnectAt: result.nextReconnectAt?.toISOString()
				});
			}
		} catch (err) {
			logger.error('Reconnect error', {
				connectorId: id,
				error: err instanceof Error ? err.message : String(err)
			});
			return fail(500, { error: 'Reconnection failed unexpectedly' });
		}
	},

	pauseReconnect: async ({ params }) => {
		const id = Number(params.id);

		if (Number.isNaN(id)) {
			logger.warn('Pause reconnect failed - invalid ID', { rawId: params.id });
			return fail(400, { error: 'Invalid connector ID' });
		}

		try {
			await pauseConnectorReconnect(id);

			logger.info('Auto-reconnect paused', { connectorId: id });

			return {
				success: true,
				message: 'Auto-reconnect paused'
			};
		} catch (err) {
			logger.error('Pause reconnect error', {
				connectorId: id,
				error: err instanceof Error ? err.message : String(err)
			});
			return fail(500, { error: 'Failed to pause auto-reconnect' });
		}
	},

	resumeReconnect: async ({ params }) => {
		const id = Number(params.id);

		if (Number.isNaN(id)) {
			logger.warn('Resume reconnect failed - invalid ID', { rawId: params.id });
			return fail(400, { error: 'Invalid connector ID' });
		}

		try {
			await resumeConnectorReconnect(id);

			logger.info('Auto-reconnect resumed', { connectorId: id });

			return {
				success: true,
				message: 'Auto-reconnect resumed'
			};
		} catch (err) {
			logger.error('Resume reconnect error', {
				connectorId: id,
				error: err instanceof Error ? err.message : String(err)
			});
			return fail(500, { error: 'Failed to resume auto-reconnect' });
		}
	}
};
