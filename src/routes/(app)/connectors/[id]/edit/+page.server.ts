/**
 * Edit connector page server-side logic.
 */

import { error, fail } from '@sveltejs/kit';
import * as v from 'valibot';
import { ConnectorUpdateSchema } from '$lib/schemas/connectors';
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
import {
	connectorNameExists,
	getConnector,
	getDecryptedApiKey,
	updateConnector
} from '$lib/server/db/queries/connectors';
import type { Connector } from '$lib/server/db/schema';
import { createLogger } from '$lib/server/logger';
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

	return {
		connector
	};
};

export const actions: Actions = {
	/**
	 * Test connection to the *arr application.
	 * Uses the provided API key if given, otherwise uses the existing one.
	 */
	testConnection: async ({ request, params }) => {
		const id = Number(params.id);

		if (Number.isNaN(id)) {
			return fail(400, { error: 'Invalid connector ID' });
		}

		const connector = await getConnector(id);

		if (!connector) {
			return fail(404, { error: 'Connector not found' });
		}

		const formData = await request.formData();
		const data = {
			name: formData.get('name')?.toString() ?? connector.name,
			type: formData.get('type')?.toString() ?? connector.type,
			url: formData.get('url')?.toString() ?? connector.url,
			apiKey: formData.get('apiKey')?.toString() || undefined, // Empty string becomes undefined
			enabled: formData.get('enabled') === 'true'
		};

		let apiKey: string;
		if (data.apiKey) {
			apiKey = data.apiKey;
		} else {
			try {
				apiKey = await getDecryptedApiKey(connector);
			} catch (_err) {
				return fail(500, {
					error: 'Failed to decrypt existing API key',
					name: data.name,
					type: data.type,
					url: data.url,
					enabled: data.enabled
				});
			}
		}

		const testConnector = {
			...connector,
			url: data.url.replace(/\/+$/, '') // Normalize URL
		};

		try {
			const client = createClient(testConnector, apiKey);
			const isConnected = await client.ping();

			if (isConnected) {
				logger.info('Connection test successful', {
					connectorId: id,
					connectorName: data.name,
					type: data.type,
					url: data.url
				});
				return {
					success: true,
					message: 'Connection successful!',
					name: data.name,
					type: data.type,
					url: data.url,
					enabled: data.enabled
				};
			} else {
				logger.warn('Connection test failed - no response', {
					connectorId: id,
					connectorName: data.name,
					type: data.type,
					url: data.url
				});
				return fail(400, {
					error: 'Connection failed. Check your URL and API key.',
					name: data.name,
					type: data.type,
					url: data.url,
					enabled: data.enabled
				});
			}
		} catch (err) {
			logger.warn('Connection test failed', {
				connectorId: id,
				connectorName: data.name,
				type: data.type,
				url: data.url,
				error: getErrorMessage(err)
			});
			return fail(400, {
				error: getErrorMessage(err),
				name: data.name,
				type: data.type,
				url: data.url,
				enabled: data.enabled
			});
		}
	},

	/**
	 * Update the connector.
	 * Validates form data, checks for duplicate names (excluding self), and updates.
	 */
	update: async ({ request, params }) => {
		const id = Number(params.id);

		if (Number.isNaN(id)) {
			return fail(400, { error: 'Invalid connector ID' });
		}

		const connector = await getConnector(id);

		if (!connector) {
			return fail(404, { error: 'Connector not found' });
		}

		const formData = await request.formData();
		const data = {
			name: formData.get('name'),
			type: formData.get('type')?.toString() ?? connector.type,
			url: formData.get('url'),
			apiKey: formData.get('apiKey')?.toString() || undefined, // Empty string becomes undefined
			enabled: formData.get('enabled') === 'true'
		};

		const result = v.safeParse(ConnectorUpdateSchema, data);
		if (!result.success) {
			const errors = result.issues.map((issue) => issue.message);
			return fail(400, {
				error: errors[0] ?? 'Invalid input',
				name: data.name?.toString() ?? connector.name,
				type: data.type?.toString() ?? connector.type,
				url: data.url?.toString() ?? connector.url,
				enabled: data.enabled
			});
		}

		const config = result.output;

		const nameExists = await connectorNameExists(config.name, id);
		if (nameExists) {
			logger.warn('Connector update failed - duplicate name', {
				connectorId: id,
				name: config.name,
				type: config.type
			});
			return fail(400, {
				error: 'A connector with this name already exists.',
				name: config.name,
				type: config.type,
				url: config.url,
				enabled: config.enabled
			});
		}

		try {
			const updateData: Parameters<typeof updateConnector>[1] = {
				name: config.name,
				url: config.url
			};
			if (config.apiKey !== undefined) {
				updateData.apiKey = config.apiKey;
			}
			if (config.enabled !== undefined) {
				updateData.enabled = config.enabled;
			}
			await updateConnector(id, updateData);

			logger.info('Connector updated', {
				connectorId: id,
				connectorName: config.name,
				type: config.type
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to update connector';
			logger.error('Failed to update connector', {
				connectorId: id,
				connectorName: config.name,
				type: config.type,
				error: message
			});
			return fail(500, {
				error: message,
				name: config.name,
				type: config.type,
				url: config.url,
				enabled: config.enabled
			});
		}

		return {
			success: true,
			message: 'Connector updated successfully',
			redirectTo: `/connectors/${id}`
		};
	}
};
