/**
 * API Keys settings page server load and actions.
 */

import { fail } from '@sveltejs/kit';
import * as v from 'valibot';
import {
	type ApiKeyRateLimitPreset,
	CreateApiKeySchema,
	parseRateLimitValue,
	UpdateApiKeyRateLimitSchema
} from '$lib/schemas/settings';
import {
	type ApiKeyScope,
	apiKeyNameExists,
	createApiKey,
	deleteApiKey,
	getApiKeysByUser,
	revokeApiKey,
	updateApiKeyRateLimit
} from '$lib/server/db/queries/api-keys';
import { createLogger } from '$lib/server/logger';
import type { Actions, PageServerLoad } from './$types';

const logger = createLogger('api-keys');

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

		// Parse rateLimitCustom as number if present
		const rateLimitCustomStr = formData.get('rateLimitCustom')?.toString();
		const rateLimitCustom = rateLimitCustomStr ? parseInt(rateLimitCustomStr, 10) : undefined;

		const data = {
			name: formData.get('name')?.toString() ?? '',
			description: formData.get('description')?.toString() || undefined,
			scope: formData.get('scope')?.toString() ?? 'read',
			expiresIn: formData.get('expiresIn')?.toString() || undefined,
			rateLimitPreset: formData.get('rateLimitPreset')?.toString() || undefined,
			rateLimitCustom:
				rateLimitCustom && !Number.isNaN(rateLimitCustom) ? rateLimitCustom : undefined
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
			const rateLimitPerMinute = parseRateLimitValue(
				config.rateLimitPreset as ApiKeyRateLimitPreset | undefined,
				config.rateLimitCustom
			);

			const created = await createApiKey({
				userId: locals.user.id,
				name: config.name,
				description: config.description ?? null,
				scope: config.scope as ApiKeyScope,
				rateLimitPerMinute,
				expiresAt
			});

			return {
				action: 'createKey' as const,
				success: true,
				message: 'API key created successfully',
				plainKey: created.plainKey // Shown only once
			};
		} catch (err) {
			logger.error('Failed to create key', {
				error: err instanceof Error ? err.message : String(err)
			});
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

		if (Number.isNaN(keyId)) {
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
			logger.error('Failed to delete key', {
				error: err instanceof Error ? err.message : String(err)
			});
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
	},

	/**
	 * Update an API key's rate limit.
	 */
	updateRateLimit: async ({ request, locals }) => {
		if (locals.isLocalBypass || !locals.user || locals.user.id === 0) {
			return fail(403, {
				action: 'updateRateLimit' as const,
				error: 'Cannot manage API keys in local network bypass mode'
			});
		}

		const formData = await request.formData();
		const keyId = parseInt(formData.get('keyId')?.toString() ?? '', 10);

		if (Number.isNaN(keyId)) {
			return fail(400, {
				action: 'updateRateLimit' as const,
				error: 'Invalid key ID'
			});
		}

		// Parse rateLimitCustom as number if present
		const rateLimitCustomStr = formData.get('rateLimitCustom')?.toString();
		const rateLimitCustom = rateLimitCustomStr ? parseInt(rateLimitCustomStr, 10) : undefined;

		const data = {
			rateLimitPreset: formData.get('rateLimitPreset')?.toString() ?? 'unlimited',
			rateLimitCustom:
				rateLimitCustom && !Number.isNaN(rateLimitCustom) ? rateLimitCustom : undefined
		};

		// Validate form data
		const result = v.safeParse(UpdateApiKeyRateLimitSchema, data);
		if (!result.success) {
			const errors = result.issues.map((issue) => issue.message);
			return fail(400, {
				action: 'updateRateLimit' as const,
				error: errors[0] ?? 'Invalid input'
			});
		}

		const config = result.output;

		try {
			const rateLimitPerMinute = parseRateLimitValue(
				config.rateLimitPreset as ApiKeyRateLimitPreset,
				config.rateLimitCustom
			);

			const updated = await updateApiKeyRateLimit(keyId, locals.user.id, rateLimitPerMinute);
			if (!updated) {
				return fail(404, {
					action: 'updateRateLimit' as const,
					error: 'API key not found'
				});
			}
		} catch (err) {
			logger.error('Failed to update rate limit', {
				error: err instanceof Error ? err.message : String(err)
			});
			return fail(500, {
				action: 'updateRateLimit' as const,
				error: 'Failed to update rate limit. Please try again.'
			});
		}

		return {
			action: 'updateRateLimit' as const,
			success: true,
			message: 'Rate limit updated successfully'
		};
	},

	/**
	 * Revoke an API key (soft delete).
	 */
	revokeKey: async ({ request, locals }) => {
		if (locals.isLocalBypass || !locals.user || locals.user.id === 0) {
			return fail(403, {
				action: 'revokeKey' as const,
				error: 'Cannot manage API keys in local network bypass mode'
			});
		}

		const formData = await request.formData();
		const keyId = parseInt(formData.get('keyId')?.toString() ?? '', 10);

		if (Number.isNaN(keyId)) {
			return fail(400, {
				action: 'revokeKey' as const,
				error: 'Invalid key ID'
			});
		}

		try {
			const revoked = await revokeApiKey(keyId, locals.user.id);
			if (!revoked) {
				return fail(404, {
					action: 'revokeKey' as const,
					error: 'API key not found or already revoked'
				});
			}
		} catch (err) {
			logger.error('Failed to revoke key', {
				error: err instanceof Error ? err.message : String(err)
			});
			return fail(500, {
				action: 'revokeKey' as const,
				error: 'Failed to revoke API key. Please try again.'
			});
		}

		return {
			action: 'revokeKey' as const,
			success: true,
			message: 'API key revoked successfully'
		};
	}
};
