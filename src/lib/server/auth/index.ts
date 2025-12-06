/**
 * Authentication module exports.
 *
 * Requirements: 10.1, 10.2, 10.3, 34.2
 *
 * Provides password hashing, session management, network utilities,
 * and API key authentication.
 */

// Password hashing utilities
export { hashPassword, verifyPassword } from './password';

// Session management
export {
	createSession,
	validateSession,
	deleteSession,
	deleteAllUserSessions,
	cleanupExpiredSessions,
	type SessionUser
} from './session';

// Network utilities for local bypass
export { isLocalNetworkIP, getClientIP } from './network';

// API key authentication and scope enforcement (Requirement 34.2)
export {
	requireAuth,
	requireScope,
	canWrite,
	canRead,
	type ApiKeyScope
} from './api-auth';
