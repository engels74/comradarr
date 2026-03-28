/** API authentication and scope enforcement utilities. */

import { error } from '@sveltejs/kit';
import { createLogger } from '$lib/server/logger';

const logger = createLogger('api-auth');

export type ApiKeyScope = 'read' | 'full';

/** Ensures the request is authenticated. Throws 401 if not. */
export function requireAuth(locals: App.Locals): void {
	if (!locals.user) {
		error(401, {
			message: 'Authentication required',
			code: 'UNAUTHORIZED'
		});
	}
}

/**
 * Ensures the request has the required scope.
 * Session/local bypass auth have full access. API keys are checked against scope hierarchy.
 */
export function requireScope(locals: App.Locals, required: ApiKeyScope): void {
	// First ensure authenticated
	requireAuth(locals);

	// Session auth and local bypass have full access
	if (!locals.isApiKey) {
		return;
	}

	// API key auth - check scope
	const keyScope = locals.apiKeyScope;

	// 'full' scope can do anything
	if (keyScope === 'full') {
		return;
	}

	// 'read' scope can only do read operations
	if (required === 'full' && keyScope === 'read') {
		logger.warn('Insufficient API key scope', { required: 'full', actual: keyScope });
		error(403, {
			message: 'API key has read-only access. Full access required for this operation.',
			code: 'INSUFFICIENT_SCOPE'
		});
	}
}
