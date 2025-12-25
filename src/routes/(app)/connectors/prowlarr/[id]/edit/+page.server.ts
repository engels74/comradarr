/**
 * Edit Prowlarr instance page server-side logic.
 */

import { error, fail } from '@sveltejs/kit';
import * as v from 'valibot';
import { ProwlarrInstanceUpdateSchema } from '$lib/schemas/prowlarr';
import {
	getProwlarrInstance,
	getDecryptedApiKey,
	updateProwlarrInstance,
	prowlarrInstanceNameExists
} from '$lib/server/db/queries/prowlarr';
import { ProwlarrClient } from '$lib/server/services/prowlarr';
import {
	AuthenticationError,
	NetworkError,
	TimeoutError,
	SSLError,
	isArrClientError
} from '$lib/server/connectors';
import type { PageServerLoad, Actions } from './$types';
import { createLogger } from '$lib/server/logger';

const logger = createLogger('prowlarr');

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

	return {
		instance
	};
};

export const actions: Actions = {
	/**
	 * Test connection to Prowlarr.
	 * Uses the provided API key if given, otherwise uses the existing one.
	 */
	testConnection: async ({ request, params }) => {
		const id = Number(params.id);

		if (isNaN(id)) {
			return fail(400, { error: 'Invalid Prowlarr instance ID' });
		}

		const instance = await getProwlarrInstance(id);

		if (!instance) {
			return fail(404, { error: 'Prowlarr instance not found' });
		}

		const formData = await request.formData();
		const data = {
			name: formData.get('name')?.toString() ?? instance.name,
			url: formData.get('url')?.toString() ?? instance.url,
			apiKey: formData.get('apiKey')?.toString() || undefined, // Empty string becomes undefined
			enabled: formData.get('enabled') === 'true'
		};

		// Use provided API key if given, otherwise use existing
		let apiKey: string;
		if (data.apiKey) {
			apiKey = data.apiKey;
		} else {
			try {
				apiKey = await getDecryptedApiKey(instance);
			} catch (err) {
				return fail(500, {
					error: 'Failed to decrypt existing API key',
					name: data.name,
					url: data.url,
					enabled: data.enabled
				});
			}
		}

		try {
			const client = new ProwlarrClient({
				baseUrl: data.url.replace(/\/+$/, ''), // Normalize URL
				apiKey
			});
			const isConnected = await client.ping();

			if (isConnected) {
				logger.info('Prowlarr connection test successful', {
					instanceId: id,
					instanceName: data.name,
					url: data.url
				});
				return {
					success: true,
					message: 'Connection successful!',
					name: data.name,
					url: data.url,
					enabled: data.enabled
				};
			} else {
				logger.warn('Prowlarr connection test failed - no response', {
					instanceId: id,
					instanceName: data.name,
					url: data.url
				});
				return fail(400, {
					error: 'Connection failed. Check your URL and API key.',
					name: data.name,
					url: data.url,
					enabled: data.enabled
				});
			}
		} catch (err) {
			logger.warn('Prowlarr connection test failed', {
				instanceId: id,
				instanceName: data.name,
				url: data.url,
				error: getErrorMessage(err)
			});
			return fail(400, {
				error: getErrorMessage(err),
				name: data.name,
				url: data.url,
				enabled: data.enabled
			});
		}
	},

	/**
	 * Update the Prowlarr instance.
	 * Validates form data, checks for duplicate names (excluding self), and updates.
	 */
	update: async ({ request, params }) => {
		const id = Number(params.id);

		if (isNaN(id)) {
			return fail(400, { error: 'Invalid Prowlarr instance ID' });
		}

		const instance = await getProwlarrInstance(id);

		if (!instance) {
			return fail(404, { error: 'Prowlarr instance not found' });
		}

		const formData = await request.formData();
		const data = {
			name: formData.get('name'),
			url: formData.get('url'),
			apiKey: formData.get('apiKey')?.toString() || undefined, // Empty string becomes undefined
			enabled: formData.get('enabled') === 'true'
		};

		// Validate form data
		const result = v.safeParse(ProwlarrInstanceUpdateSchema, data);
		if (!result.success) {
			const errors = result.issues.map((issue) => issue.message);
			return fail(400, {
				error: errors[0] ?? 'Invalid input',
				name: data.name?.toString() ?? instance.name,
				url: data.url?.toString() ?? instance.url,
				enabled: data.enabled
			});
		}

		const config = result.output;

		// Check for duplicate instance name (excluding self)
		const nameExists = await prowlarrInstanceNameExists(config.name, id);
		if (nameExists) {
			logger.warn('Prowlarr instance update failed - duplicate name', {
				instanceId: id,
				name: config.name
			});
			return fail(400, {
				error: 'A Prowlarr instance with this name already exists.',
				name: config.name,
				url: config.url,
				enabled: config.enabled
			});
		}

		// Update the instance
		try {
			// Build update object - only include optional fields if they are defined
			const updateData: Parameters<typeof updateProwlarrInstance>[1] = {
				name: config.name,
				url: config.url
			};
			if (config.apiKey !== undefined) {
				updateData.apiKey = config.apiKey;
			}
			if (config.enabled !== undefined) {
				updateData.enabled = config.enabled;
			}
			await updateProwlarrInstance(id, updateData);

			logger.info('Prowlarr instance updated', {
				instanceId: id,
				instanceName: config.name
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to update Prowlarr instance';
			logger.error('Failed to update Prowlarr instance', {
				instanceId: id,
				instanceName: config.name,
				error: message
			});
			return fail(500, {
				error: message,
				name: config.name,
				url: config.url,
				enabled: config.enabled
			});
		}

		// Return success with redirect target (client will handle navigation after showing toast)
		return {
			success: true,
			message: 'Prowlarr instance updated successfully',
			redirectTo: `/connectors/prowlarr/${id}`
		};
	}
};
