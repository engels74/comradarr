/**
 * Add Prowlarr instance page server-side logic.
 *
 * Requirements: 38.1, 38.4
 */

import { fail, redirect } from '@sveltejs/kit';
import * as v from 'valibot';
import { ProwlarrInstanceSchema } from '$lib/schemas/prowlarr';
import {
	createProwlarrInstance,
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
import type { Actions } from './$types';

/**
 * Returns a user-friendly error message based on the error type.
 */
function getErrorMessage(error: unknown): string {
	if (error instanceof AuthenticationError) {
		return 'Invalid API key. Check your API key in Prowlarr settings.';
	}
	if (error instanceof NetworkError) {
		if (error.errorCause === 'connection_refused') {
			return 'Connection refused. Check the URL and ensure Prowlarr is running.';
		}
		if (error.errorCause === 'dns_failure') {
			return 'Could not resolve hostname. Check the URL is correct.';
		}
		return 'Network error. Check your connection and URL.';
	}
	if (error instanceof TimeoutError) {
		return 'Connection timed out. The server may be slow or unreachable.';
	}
	if (error instanceof SSLError) {
		return 'SSL certificate error. Check your SSL configuration.';
	}
	if (isArrClientError(error)) {
		return `Connection failed: ${error.message}`;
	}
	if (error instanceof Error) {
		return `Connection failed: ${error.message}`;
	}
	return 'An unexpected error occurred while testing the connection.';
}

export const actions: Actions = {
	/**
	 * Test connection to Prowlarr.
	 *
	 * Validates form data, creates a client, and calls ping().
	 * Returns success or detailed error message.
	 */
	testConnection: async ({ request }) => {
		const formData = await request.formData();
		const data = {
			name: formData.get('name'),
			url: formData.get('url'),
			apiKey: formData.get('apiKey')
		};

		// Validate form data
		const result = v.safeParse(ProwlarrInstanceSchema, data);
		if (!result.success) {
			const errors = result.issues.map((issue) => issue.message);
			return fail(400, {
				error: errors[0] ?? 'Invalid input',
				name: data.name?.toString() ?? '',
				url: data.url?.toString() ?? ''
			});
		}

		const config = result.output;

		// Create client and test connection
		try {
			const client = new ProwlarrClient({
				baseUrl: config.url.replace(/\/+$/, ''), // Normalize URL
				apiKey: config.apiKey
			});
			const isConnected = await client.ping();

			if (isConnected) {
				return {
					success: true,
					message: 'Connection successful!',
					name: config.name,
					url: config.url
				};
			} else {
				return fail(400, {
					error: 'Connection failed. Check your URL and API key.',
					name: config.name,
					url: config.url
				});
			}
		} catch (error) {
			return fail(400, {
				error: getErrorMessage(error),
				name: config.name,
				url: config.url
			});
		}
	},

	/**
	 * Create a new Prowlarr instance.
	 *
	 * Validates form data, checks for duplicate names, and creates the instance.
	 * Redirects to the connectors list on success.
	 */
	create: async ({ request }) => {
		const formData = await request.formData();
		const data = {
			name: formData.get('name'),
			url: formData.get('url'),
			apiKey: formData.get('apiKey')
		};

		// Validate form data
		const result = v.safeParse(ProwlarrInstanceSchema, data);
		if (!result.success) {
			const errors = result.issues.map((issue) => issue.message);
			return fail(400, {
				error: errors[0] ?? 'Invalid input',
				name: data.name?.toString() ?? '',
				url: data.url?.toString() ?? ''
			});
		}

		const config = result.output;

		// Check for duplicate instance name
		const nameExists = await prowlarrInstanceNameExists(config.name);
		if (nameExists) {
			return fail(400, {
				error: 'A Prowlarr instance with this name already exists.',
				name: config.name,
				url: config.url
			});
		}

		// Create the instance (API key is encrypted automatically)
		try {
			await createProwlarrInstance({
				name: config.name,
				url: config.url,
				apiKey: config.apiKey,
				enabled: true
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Failed to create Prowlarr instance';
			return fail(500, {
				error: message,
				name: config.name,
				url: config.url
			});
		}

		// Redirect to connectors list on success
		redirect(303, '/connectors');
	}
};
