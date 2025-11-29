/**
 * Authentication module exports.
 *
 * Requirements: 10.1, 10.2
 *
 * Provides password hashing and session management services.
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
