/**
 * Authentication module exports.
 *
 * Provides password hashing, session management, network utilities,
 * and API key authentication.
 */

// API key authentication and scope enforcement
export { type ApiKeyScope, canRead, canWrite, requireAuth, requireScope } from './api-auth';
// Network utilities for local bypass
export { getClientIP, isLocalNetworkIP } from './network';
// Password hashing utilities
export { hashPassword, verifyPassword } from './password';
// Session management
export {
	cleanupExpiredSessions,
	createSession,
	deleteAllUserSessions,
	deleteSession,
	type SessionUser,
	validateSession
} from './session';
