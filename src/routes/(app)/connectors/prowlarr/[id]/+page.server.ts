/**
 * Prowlarr instance detail page server load and actions.
 *
 * Requirements: 38.4
 */

import { error, fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import {
	getProwlarrInstance,
	getDecryptedApiKey,
	getIndexerHealthByInstance,
	updateProwlarrHealth,
	deleteProwlarrInstance
} from '$lib/server/db/queries/prowlarr';
import { ProwlarrClient, prowlarrHealthMonitor } from '$lib/server/services/prowlarr';
import {
	AuthenticationError,
	NetworkError,
	TimeoutError,
	SSLError,
	isArrClientError
} from '$lib/server/connectors';

/**
 * Returns a user-friendly error message based on the error type.
 */
function getErrorMessage(err: unknown): string {
	if (err instanceof AuthenticationError) {
		return 'Invalid API key. Check your API key in Prowlarr settings.';
	}
	if (err instanceof NetworkError) {
		if (err.errorCause === 'connection_refused') {
			return 'Connection refused. Check the URL and ensure Prowlarr is running.';
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
		error(400, 'Invalid Prowlarr instance ID');
	}

	const instance = await getProwlarrInstance(id);

	if (!instance) {
		error(404, 'Prowlarr instance not found');
	}

	// Load indexer health data
	const indexerHealth = await getIndexerHealthByInstance(id);

	// Calculate stale threshold (10 minutes)
	const staleThresholdMs = prowlarrHealthMonitor.getStaleThresholdMs();
	const now = new Date();

	// Add isStale flag to each indexer
	const indexerHealthWithStale = indexerHealth.map((indexer) => ({
		...indexer,
		isStale: now.getTime() - new Date(indexer.lastUpdated).getTime() > staleThresholdMs
	}));

	return {
		instance,
		indexerHealth: indexerHealthWithStale
	};
};

export const actions: Actions = {
	/**
	 * Test connection to Prowlarr.
	 * Updates health status based on result.
	 */
	testConnection: async ({ params }) => {
		const id = Number(params.id);

		if (isNaN(id)) {
			return fail(400, { error: 'Invalid Prowlarr instance ID' });
		}

		const instance = await getProwlarrInstance(id);

		if (!instance) {
			return fail(404, { error: 'Prowlarr instance not found' });
		}

		try {
			const apiKey = await getDecryptedApiKey(instance);
			const client = new ProwlarrClient({
				baseUrl: instance.url,
				apiKey
			});
			const isConnected = await client.ping();

			if (isConnected) {
				// Update health status to healthy
				await updateProwlarrHealth(id, 'healthy');

				return {
					success: true,
					message: 'Connection successful!'
				};
			} else {
				// Update health status to unhealthy
				await updateProwlarrHealth(id, 'unhealthy');

				return fail(400, {
					error: 'Connection failed. Prowlarr did not respond as expected.'
				});
			}
		} catch (err) {
			// Update health status based on error type
			if (err instanceof AuthenticationError) {
				await updateProwlarrHealth(id, 'unhealthy');
			} else if (err instanceof NetworkError) {
				await updateProwlarrHealth(id, 'offline');
			} else {
				await updateProwlarrHealth(id, 'unhealthy');
			}

			return fail(400, { error: getErrorMessage(err) });
		}
	},

	/**
	 * Trigger a health check for the Prowlarr instance.
	 * Updates cached indexer health data.
	 */
	checkHealth: async ({ params }) => {
		const id = Number(params.id);

		if (isNaN(id)) {
			return fail(400, { error: 'Invalid Prowlarr instance ID' });
		}

		const instance = await getProwlarrInstance(id);

		if (!instance) {
			return fail(404, { error: 'Prowlarr instance not found' });
		}

		if (!instance.enabled) {
			return fail(400, { error: 'Cannot check health of a disabled instance' });
		}

		try {
			const result = await prowlarrHealthMonitor.checkInstance(instance);

			if (result.status === 'offline') {
				return fail(400, {
					error: result.error ?? 'Prowlarr is offline or unreachable.'
				});
			}

			return {
				success: true,
				message: `Health check complete. ${result.indexersChecked} indexers checked, ${result.indexersRateLimited} rate-limited.`
			};
		} catch (err) {
			return fail(500, {
				error: err instanceof Error ? err.message : 'Failed to check health'
			});
		}
	},

	/**
	 * Delete the Prowlarr instance and all associated data.
	 * Redirects to the connectors list on success.
	 */
	delete: async ({ params }) => {
		const id = Number(params.id);

		if (isNaN(id)) {
			return fail(400, { error: 'Invalid Prowlarr instance ID' });
		}

		const instance = await getProwlarrInstance(id);

		if (!instance) {
			return fail(404, { error: 'Prowlarr instance not found' });
		}

		await deleteProwlarrInstance(id);

		redirect(303, '/connectors');
	}
};
