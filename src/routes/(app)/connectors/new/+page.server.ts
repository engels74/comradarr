/**
 * Add connector page server-side logic.
 */

import { fail } from '@sveltejs/kit';
import * as v from 'valibot';
import {
	ConnectorSchema,
	type ConnectorType as SchemaConnectorType,
	TestConnectionSchema
} from '$lib/schemas/connectors';
import {
	AuthenticationError,
	detectConnectorType,
	isArrClientError,
	NetworkError,
	RadarrClient,
	SonarrClient,
	SSLError,
	TimeoutError,
	WhisparrClient
} from '$lib/server/connectors';
import {
	type ConnectorType,
	connectorNameExists,
	createConnector
} from '$lib/server/db/queries/connectors';
import { createLogger } from '$lib/server/logger';
import type { Actions } from './$types';

const logger = createLogger('connectors');

/**
 * Creates an appropriate client for the connector type.
 */
function createClient(
	type: SchemaConnectorType,
	url: string,
	apiKey: string
): SonarrClient | RadarrClient | WhisparrClient {
	const clientConfig = {
		baseUrl: url.replace(/\/+$/, ''), // Normalize URL
		apiKey
	};

	switch (type) {
		case 'sonarr':
			return new SonarrClient(clientConfig);
		case 'radarr':
			return new RadarrClient(clientConfig);
		case 'whisparr':
			return new WhisparrClient(clientConfig);
	}
}

/**
 * Returns a user-friendly error message based on the error type.
 */
function getErrorMessage(error: unknown): string {
	if (error instanceof AuthenticationError) {
		return 'Invalid API key. Check your API key in the *arr application settings.';
	}
	if (error instanceof NetworkError) {
		if (error.errorCause === 'connection_refused') {
			return 'Connection refused. Check the URL and ensure the application is running.';
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
	 * Test connection to the *arr application with automatic type detection.
	 *
	 * 1. Validates URL and API key (type is optional)
	 * 2. Auto-detects connector type from /api/v3/system/status
	 * 3. Tests connectivity using the detected type
	 * 4. Returns detected type for UI auto-population
	 */
	testConnection: async ({ request }) => {
		const formData = await request.formData();
		const data = {
			url: formData.get('url'),
			apiKey: formData.get('apiKey'),
			type: formData.get('type') || undefined // Optional type for manual override
		};

		// Validate URL and API key (type is optional for auto-detection)
		const result = v.safeParse(TestConnectionSchema, data);
		if (!result.success) {
			const errors = result.issues.map((issue) => issue.message);
			return fail(400, {
				error: errors[0] ?? 'Invalid input',
				name: formData.get('name')?.toString() ?? '',
				type: data.type?.toString() ?? '',
				url: data.url?.toString() ?? ''
			});
		}

		const config = result.output;

		// Step 1: Detect connector type
		const detectionResult = await detectConnectorType(config.url, config.apiKey);

		if (!detectionResult.success) {
			// Detection failed - return the error
			logger.warn('Connection test failed - type detection error', {
				url: config.url,
				error: detectionResult.error
			});
			return fail(400, {
				error: detectionResult.error,
				name: formData.get('name')?.toString() ?? '',
				type: config.type ?? '',
				url: config.url
			});
		}

		// Use detected type (detection already validates connectivity via system/status)
		const detectedType = detectionResult.type;

		// Step 2: Test connection using ping for additional validation
		try {
			const client = createClient(detectedType, config.url, config.apiKey);
			const isConnected = await client.ping();

			if (isConnected) {
				logger.info('Connection test successful', {
					detectedType,
					appName: detectionResult.appName,
					version: detectionResult.version,
					url: config.url
				});
				return {
					success: true,
					message: `Connected to ${detectionResult.appName} v${detectionResult.version}`,
					detectedType,
					appName: detectionResult.appName,
					version: detectionResult.version,
					name: formData.get('name')?.toString() ?? '',
					type: detectedType,
					url: config.url
				};
			} else {
				// Ping failed but detection worked - still return success with detected type
				// (system/status already verified connectivity)
				logger.info('Connection test successful (detection passed, ping failed)', {
					detectedType,
					appName: detectionResult.appName,
					version: detectionResult.version,
					url: config.url
				});
				return {
					success: true,
					message: `Connected to ${detectionResult.appName} v${detectionResult.version}`,
					detectedType,
					appName: detectionResult.appName,
					version: detectionResult.version,
					name: formData.get('name')?.toString() ?? '',
					type: detectedType,
					url: config.url
				};
			}
		} catch (error) {
			// Ping threw but detection worked - still return success
			// (system/status already verified connectivity)
			logger.info('Connection test successful (detection passed, ping error)', {
				detectedType,
				appName: detectionResult.appName,
				version: detectionResult.version,
				url: config.url,
				pingError: getErrorMessage(error)
			});
			return {
				success: true,
				message: `Connected to ${detectionResult.appName} v${detectionResult.version}`,
				detectedType,
				appName: detectionResult.appName,
				version: detectionResult.version,
				name: formData.get('name')?.toString() ?? '',
				type: detectedType,
				url: config.url
			};
		}
	},

	/**
	 * Create a new connector.
	 *
	 * Validates form data, checks for duplicate names, and creates the connector.
	 * Redirects to the connectors list on success.
	 */
	create: async ({ request }) => {
		const formData = await request.formData();
		const data = {
			name: formData.get('name'),
			type: formData.get('type'),
			url: formData.get('url'),
			apiKey: formData.get('apiKey')
		};

		// Validate form data
		const result = v.safeParse(ConnectorSchema, data);
		if (!result.success) {
			const errors = result.issues.map((issue) => issue.message);
			return fail(400, {
				error: errors[0] ?? 'Invalid input',
				name: data.name?.toString() ?? '',
				type: data.type?.toString() ?? '',
				url: data.url?.toString() ?? ''
			});
		}

		const config = result.output;

		// Check for duplicate connector name
		const nameExists = await connectorNameExists(config.name);
		if (nameExists) {
			logger.warn('Connector creation failed - duplicate name', {
				name: config.name,
				type: config.type
			});
			return fail(400, {
				error: 'A connector with this name already exists.',
				name: config.name,
				type: config.type,
				url: config.url
			});
		}

		// Create the connector (API key is encrypted automatically)
		try {
			await createConnector({
				type: config.type as ConnectorType,
				name: config.name,
				url: config.url,
				apiKey: config.apiKey,
				enabled: true
			});

			logger.info('Connector created', {
				name: config.name,
				type: config.type,
				url: config.url
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Failed to create connector';
			logger.error('Failed to create connector', {
				name: config.name,
				type: config.type,
				error: message
			});
			return fail(500, {
				error: message,
				name: config.name,
				type: config.type,
				url: config.url
			});
		}

		// Return success with redirect target (client will handle navigation after showing toast)
		return {
			success: true,
			message: 'Connector created successfully',
			redirectTo: '/connectors'
		};
	}
};
