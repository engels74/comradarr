/**
 * API Keys settings page server load and actions.
 *
 * Requirement: 34.1
 */

import type { PageServerLoad, Actions } from './$types';
import {
	getApiKeysByUser,
	createApiKey,
	deleteApiKey,
	apiKeyNameExists,
	type ApiKeyScope
} from '$lib/server/db/queries/api-keys';
import { fail } from '@sveltejs/kit';
import * as v from 'valibot';
import { CreateApiKeySchema } from '$lib/schemas/settings';

export const load: PageServerLoad = async ({ locals }) => {
	// locals.user is guaranteed by (app) layout guard
	// For bypass users, return empty list since they can't manage keys
	const apiKeys =
		locals.isLocalBypass || locals.user?.id === 0 ? [] : await getApiKeysByUser(locals.user!.id);

	return {
		apiKeys,
		isLocalBypass: locals.isLocalBypass ?? false
	};
};

/**
 * Calculate expiration date from expiration option.
 */
function calculateExpiration(expiresIn: string | undefined): Date | null {
	if (!expiresIn || expiresIn === 'never') return null;

	const now = new Date();
	switch (expiresIn) {
		case '30d':
			return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
		case '90d':
			return new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
		case '365d':
			return new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
		default:
			return null;
	}
}

export const actions: Actions = {
	/**
	 * Create a new API key.
	 */
	createKey: async ({ request, locals }) => {
		// Cannot create keys for bypass users
		if (locals.isLocalBypass || !locals.user || locals.user.id === 0) {
			return fail(403, {
				action: 'createKey' as const,
				error: 'Cannot create API keys in local network bypass mode'
			});
		}

		const formData = await request.formData();

		const data = {
			name: formData.get('name')?.toString() ?? '',
			description: formData.get('description')?.toString() || undefined,
			scope: formData.get('scope')?.toString() ?? 'read',
			expiresIn: formData.get('expiresIn')?.toString() || undefined
		};

		// Validate form data
		const result = v.safeParse(CreateApiKeySchema, data);
		if (!result.success) {
			const errors = result.issues.map((issue) => issue.message);
			return fail(400, {
				action: 'createKey' as const,
				error: errors[0] ?? 'Invalid input'
			});
		}

		const config = result.output;

		// Check for duplicate names
		const nameExists = await apiKeyNameExists(locals.user.id, config.name);
		if (nameExists) {
			return fail(400, {
				action: 'createKey' as const,
				error: 'An API key with this name already exists'
			});
		}

		try {
			const expiresAt = calculateExpiration(config.expiresIn);
			const created = await createApiKey({
				userId: locals.user.id,
				name: config.name,
				description: config.description ?? null,
				scope: config.scope as ApiKeyScope,
				expiresAt
			});

			return {
				action: 'createKey' as const,
				success: true,
				message: 'API key created successfully',
				plainKey: created.plainKey // Shown only once
			};
		} catch (err) {
			console.error('[api-keys] Failed to create key:', err);
			return fail(500, {
				action: 'createKey' as const,
				error: 'Failed to create API key. Please try again.'
			});
		}
	},

	/**
	 * Delete an API key.
	 */
	deleteKey: async ({ request, locals }) => {
		if (locals.isLocalBypass || !locals.user || locals.user.id === 0) {
			return fail(403, {
				action: 'deleteKey' as const,
				error: 'Cannot manage API keys in local network bypass mode'
			});
		}

		const formData = await request.formData();
		const keyId = parseInt(formData.get('keyId')?.toString() ?? '', 10);

		if (isNaN(keyId)) {
			return fail(400, {
				action: 'deleteKey' as const,
				error: 'Invalid key ID'
			});
		}

		try {
			const deleted = await deleteApiKey(keyId, locals.user.id);
			if (!deleted) {
				return fail(404, {
					action: 'deleteKey' as const,
					error: 'API key not found'
				});
			}
		} catch (err) {
			console.error('[api-keys] Failed to delete key:', err);
			return fail(500, {
				action: 'deleteKey' as const,
				error: 'Failed to delete API key. Please try again.'
			});
		}

		return {
			action: 'deleteKey' as const,
			success: true,
			message: 'API key deleted successfully'
		};
	}
};
