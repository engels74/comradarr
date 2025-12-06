/**
 * API authentication and scope enforcement utilities.
 *
 * Provides utilities for enforcing authentication and scope restrictions
 * on API routes. Works with both session and API key authentication.
 */

import { error } from '@sveltejs/kit';

/**
 * API key scope types.
 * - 'read': Read-only access (GET requests only)
 * - 'full': Full access to all API operations
 */
export type ApiKeyScope = 'read' | 'full';

/**
 * Ensures the request is authenticated (via session or API key).
 * Throws 401 Unauthorized if not authenticated.
 *
 * @param locals - The event.locals object from SvelteKit
 * @throws 401 if not authenticated
 */
export function requireAuth(locals: App.Locals): void {
	if (!locals.user) {
		error(401, {
			message: 'Authentication required',
			code: 'UNAUTHORIZED'
		});
	}
}

/**
 * Ensures the request has the required scope for the operation.
 *
 * For session and local bypass auth: always allowed (they have full access)
 * For API key auth: checks if the key's scope matches the required scope
 *
 * Scope hierarchy:
 * - 'read' allows only read operations (GET)
 * - 'full' allows all operations
 *
 * @param locals - The event.locals object from SvelteKit
 * @param required - The required scope for the operation
 * @throws 401 if not authenticated
 * @throws 403 if API key scope is insufficient
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
		error(403, {
			message: 'API key has read-only access. Full access required for this operation.',
			code: 'INSUFFICIENT_SCOPE'
		});
	}
}

/**
 * Checks if the current authentication allows write operations.
 *
 * Returns true for:
 * - Session authentication (full access)
 * - Local bypass authentication (full access)
 * - API key with 'full' scope
 *
 * Returns false for:
 * - API key with 'read' scope
 * - No authentication
 *
 * @param locals - The event.locals object from SvelteKit
 * @returns true if write operations are allowed
 */
export function canWrite(locals: App.Locals): boolean {
	// Not authenticated
	if (!locals.user) {
		return false;
	}

	// Session auth and local bypass have full access
	if (!locals.isApiKey) {
		return true;
	}

	// API key auth - 'full' scope allows writes
	return locals.apiKeyScope === 'full';
}

/**
 * Checks if the current authentication allows read operations.
 *
 * Returns true for any authenticated request (API keys with 'read' or 'full' scope).
 *
 * @param locals - The event.locals object from SvelteKit
 * @returns true if read operations are allowed
 */
export function canRead(locals: App.Locals): boolean {
	return locals.user !== null;
}
