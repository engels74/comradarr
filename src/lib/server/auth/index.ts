/**
 * Authentication module exports.
 *
 * Requirements: 10.1, 10.2, 10.3
 *
 * Provides password hashing, session management, and network utilities.
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
