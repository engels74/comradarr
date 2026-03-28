/**
 * Unit tests for API authentication and scope enforcement utilities.
 *
 * Tests cover:
 * - requireAuth() behavior for authenticated and unauthenticated requests
 * - requireScope() behavior for different scopes and auth types
 *

 */

import { describe, expect, it } from 'vitest';
import { requireAuth, requireScope } from '../../src/lib/server/auth/api-auth';

// Mock App.Locals for testing
function createLocals(overrides: Partial<App.Locals> = {}): App.Locals {
	return {
		correlationId: 'test-correlation-id',
		user: null,
		...overrides
	};
}

function createAuthenticatedUser() {
	return {
		id: 1,
		username: 'testuser',
		displayName: 'Test User',
		role: 'admin'
	};
}

describe('requireAuth', () => {
	describe('when authenticated', () => {
		it('should not throw for session authenticated user', () => {
			const locals = createLocals({
				user: createAuthenticatedUser()
			});

			expect(() => requireAuth(locals)).not.toThrow();
		});

		it('should not throw for API key authenticated user', () => {
			const locals = createLocals({
				user: createAuthenticatedUser(),
				isApiKey: true,
				apiKeyScope: 'full',
				apiKeyId: 1
			});

			expect(() => requireAuth(locals)).not.toThrow();
		});

		it('should not throw for local bypass user', () => {
			const locals = createLocals({
				user: {
					id: 0,
					username: 'local',
					displayName: 'Local Network',
					role: 'admin'
				},
				isLocalBypass: true
			});

			expect(() => requireAuth(locals)).not.toThrow();
		});
	});

	describe('when not authenticated', () => {
		it('should throw 401 for null user', () => {
			const locals = createLocals({ user: null });

			expect(() => requireAuth(locals)).toThrow();
		});

		it('should throw with correct error message', () => {
			const locals = createLocals({ user: null });

			try {
				requireAuth(locals);
				expect.fail('Expected error to be thrown');
			} catch (e: unknown) {
				const err = e as { status: number; body: { message: string; code: string } };
				expect(err.status).toBe(401);
				expect(err.body.message).toBe('Authentication required');
				expect(err.body.code).toBe('UNAUTHORIZED');
			}
		});
	});
});

describe('requireScope', () => {
	describe('session authentication (no API key)', () => {
		it('should allow read scope for session user', () => {
			const locals = createLocals({
				user: createAuthenticatedUser()
			});

			expect(() => requireScope(locals, 'read')).not.toThrow();
		});

		it('should allow full scope for session user', () => {
			const locals = createLocals({
				user: createAuthenticatedUser()
			});

			expect(() => requireScope(locals, 'full')).not.toThrow();
		});
	});

	describe('local bypass authentication', () => {
		it('should allow read scope for local bypass user', () => {
			const locals = createLocals({
				user: {
					id: 0,
					username: 'local',
					displayName: 'Local Network',
					role: 'admin'
				},
				isLocalBypass: true
			});

			expect(() => requireScope(locals, 'read')).not.toThrow();
		});

		it('should allow full scope for local bypass user', () => {
			const locals = createLocals({
				user: {
					id: 0,
					username: 'local',
					displayName: 'Local Network',
					role: 'admin'
				},
				isLocalBypass: true
			});

			expect(() => requireScope(locals, 'full')).not.toThrow();
		});
	});

	describe('API key with full scope', () => {
		it('should allow read scope for full scope API key', () => {
			const locals = createLocals({
				user: createAuthenticatedUser(),
				isApiKey: true,
				apiKeyScope: 'full',
				apiKeyId: 1
			});

			expect(() => requireScope(locals, 'read')).not.toThrow();
		});

		it('should allow full scope for full scope API key', () => {
			const locals = createLocals({
				user: createAuthenticatedUser(),
				isApiKey: true,
				apiKeyScope: 'full',
				apiKeyId: 1
			});

			expect(() => requireScope(locals, 'full')).not.toThrow();
		});
	});

	describe('API key with read scope', () => {
		it('should allow read scope for read scope API key', () => {
			const locals = createLocals({
				user: createAuthenticatedUser(),
				isApiKey: true,
				apiKeyScope: 'read',
				apiKeyId: 1
			});

			expect(() => requireScope(locals, 'read')).not.toThrow();
		});

		it('should throw 403 for full scope requirement with read scope API key', () => {
			const locals = createLocals({
				user: createAuthenticatedUser(),
				isApiKey: true,
				apiKeyScope: 'read',
				apiKeyId: 1
			});

			try {
				requireScope(locals, 'full');
				expect.fail('Expected error to be thrown');
			} catch (e: unknown) {
				const err = e as { status: number; body: { message: string; code: string } };
				expect(err.status).toBe(403);
				expect(err.body.message).toContain('read-only access');
				expect(err.body.code).toBe('INSUFFICIENT_SCOPE');
			}
		});
	});

	describe('unauthenticated', () => {
		it('should throw 401 when requiring scope without authentication', () => {
			const locals = createLocals({ user: null });

			try {
				requireScope(locals, 'read');
				expect.fail('Expected error to be thrown');
			} catch (e: unknown) {
				const err = e as { status: number; body: { message: string; code: string } };
				expect(err.status).toBe(401);
				expect(err.body.code).toBe('UNAUTHORIZED');
			}
		});
	});
});

describe('scope hierarchy', () => {
	it('should enforce that full scope allows all operations', () => {
		const locals = createLocals({
			user: createAuthenticatedUser(),
			isApiKey: true,
			apiKeyScope: 'full',
			apiKeyId: 1
		});

		expect(() => requireScope(locals, 'read')).not.toThrow();
		expect(() => requireScope(locals, 'full')).not.toThrow();
	});

	it('should enforce that read scope only allows read operations', () => {
		const locals = createLocals({
			user: createAuthenticatedUser(),
			isApiKey: true,
			apiKeyScope: 'read',
			apiKeyId: 1
		});

		expect(() => requireScope(locals, 'read')).not.toThrow();
		expect(() => requireScope(locals, 'full')).toThrow();
	});
});
