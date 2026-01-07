/**
 * Add connector page server-side logic.
 */

import { fail } from '@sveltejs/kit';
import * as v from 'valibot';
import { ConnectorSchema, TestConnectionSchema } from '$lib/schemas/connectors';
import { detectConnectorType } from '$lib/server/connectors';
import {
	type ConnectorType,
	connectorNameExists,
	createConnector
} from '$lib/server/db/queries/connectors';
import { createLogger } from '$lib/server/logger';
import type { Actions } from './$types';

const logger = createLogger('connectors');

export const actions: Actions = {
	/**
	 * Test connection to the *arr application with automatic type detection.
	 *
	 * 1. Validates URL and API key (type is optional)
	 * 2. Auto-detects connector type from /api/v3/system/status
	 * 3. Returns detected type for UI auto-population
	 *
	 * Note: The detection step validates connectivity via an authenticated request
	 * to /api/v3/system/status, which is more comprehensive than the /ping endpoint.
	 */
	testConnection: async ({ request }) => {
		const formData = await request.formData();
		const data = {
			url: formData.get('url'),
			apiKey: formData.get('apiKey'),
			type: formData.get('type') || undefined // Optional type for manual override
		};

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

		const detectionResult = await detectConnectorType(config.url, config.apiKey);

		if (!detectionResult.success) {
			logger.warn('Connection test failed', {
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

		logger.info('Connection test successful', {
			detectedType: detectionResult.type,
			appName: detectionResult.appName,
			version: detectionResult.version,
			url: config.url
		});

		return {
			success: true,
			message: `Connected to ${detectionResult.appName} v${detectionResult.version}`,
			detectedType: detectionResult.type,
			appName: detectionResult.appName,
			version: detectionResult.version,
			name: formData.get('name')?.toString() ?? '',
			type: detectionResult.type,
			url: config.url
		};
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

		return {
			success: true,
			message: 'Connector created successfully',
			redirectTo: '/connectors'
		};
	}
};
