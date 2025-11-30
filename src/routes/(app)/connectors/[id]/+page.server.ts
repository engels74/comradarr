/**
 * Connector detail page server load and actions.
 *
 * Requirements: 16.4, 16.5
 */

import { error, fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import {
	getConnector,
	getDecryptedApiKey,
	getSyncState,
	getConnectorDetailedStats,
	getSearchStateDistribution,
	getRecentSearchHistory,
	clearFailedSearches,
	updateConnectorHealth,
	deleteConnector
} from '$lib/server/db/queries/connectors';
import {
	SonarrClient,
	RadarrClient,
	WhisparrClient,
	AuthenticationError,
	NetworkError,
	TimeoutError,
	SSLError,
	isArrClientError
} from '$lib/server/connectors';
import type { Connector } from '$lib/server/db/schema';

/**
 * Creates an appropriate client for the connector type.
 */
function createClient(connector: Connector, apiKey: string): SonarrClient | RadarrClient | WhisparrClient {
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

/**
 * Returns a user-friendly error message based on the error type.
 */
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

	if (isNaN(id)) {
		error(400, 'Invalid connector ID');
	}

	const connector = await getConnector(id);

	if (!connector) {
		error(404, 'Connector not found');
	}

	// Load all data in parallel for efficiency
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
	/**
	 * Test connection to the *arr application.
	 * Updates health status based on result.
	 */
	testConnection: async ({ params }) => {
		const id = Number(params.id);

		if (isNaN(id)) {
			return fail(400, { error: 'Invalid connector ID' });
		}

		const connector = await getConnector(id);

		if (!connector) {
			return fail(404, { error: 'Connector not found' });
		}

		try {
			const apiKey = await getDecryptedApiKey(connector);
			const client = createClient(connector, apiKey);
			const isConnected = await client.ping();

			if (isConnected) {
				// Update health status to healthy
				await updateConnectorHealth(id, 'healthy');

				return {
					success: true,
					message: 'Connection successful!'
				};
			} else {
				// Update health status to unhealthy
				await updateConnectorHealth(id, 'unhealthy');

				return fail(400, {
					error: 'Connection failed. The application did not respond as expected.'
				});
			}
		} catch (err) {
			// Update health status based on error type
			if (err instanceof AuthenticationError) {
				await updateConnectorHealth(id, 'unhealthy');
			} else if (err instanceof NetworkError) {
				await updateConnectorHealth(id, 'offline');
			} else {
				await updateConnectorHealth(id, 'unhealthy');
			}

			return fail(400, { error: getErrorMessage(err) });
		}
	},

	/**
	 * Trigger a manual sync for the connector.
	 * Placeholder - will integrate with sync service when available.
	 */
	triggerSync: async ({ params }) => {
		const id = Number(params.id);

		if (isNaN(id)) {
			return fail(400, { error: 'Invalid connector ID' });
		}

		const connector = await getConnector(id);

		if (!connector) {
			return fail(404, { error: 'Connector not found' });
		}

		if (!connector.enabled) {
			return fail(400, { error: 'Cannot sync a disabled connector' });
		}

		// TODO: Integrate with sync service when available
		// For now, return success to indicate the action was received
		return {
			success: true,
			message: 'Sync triggered. This feature will be fully implemented with the sync service.'
		};
	},

	/**
	 * Clear failed search entries (exhausted or cooldown) for the connector.
	 * Resets them to pending state for retry.
	 */
	clearFailedSearches: async ({ params }) => {
		const id = Number(params.id);

		if (isNaN(id)) {
			return fail(400, { error: 'Invalid connector ID' });
		}

		const connector = await getConnector(id);

		if (!connector) {
			return fail(404, { error: 'Connector not found' });
		}

		const clearedCount = await clearFailedSearches(id);

		return {
			success: true,
			message: `Cleared ${clearedCount} failed search${clearedCount === 1 ? '' : 'es'}.`
		};
	},

	/**
	 * Delete the connector and all associated data.
	 * Redirects to the connector list on success.
	 */
	delete: async ({ params }) => {
		const id = Number(params.id);

		if (isNaN(id)) {
			return fail(400, { error: 'Invalid connector ID' });
		}

		const connector = await getConnector(id);

		if (!connector) {
			return fail(404, { error: 'Connector not found' });
		}

		await deleteConnector(id);

		redirect(303, '/connectors');
	}
};
