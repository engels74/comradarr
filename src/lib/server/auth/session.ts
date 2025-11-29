/**
 * Session management service for PostgreSQL-backed sessions.
 *
 * Requirements: 10.1, 10.2
 *
 * Sessions are stored in PostgreSQL with configurable expiry (default 7 days).
 * Session IDs are 64-character hex strings (256 bits of entropy).
 */

import { db } from '$lib/server/db';
import { sessions, users } from '$lib/server/db/schema';
import { eq, lt } from 'drizzle-orm';

/** Session duration in milliseconds (default: 7 days per tech.md) */
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

/** Session ID length in characters (hex encoded) */
const SESSION_ID_LENGTH = 64;

/**
 * Generates a cryptographically secure session ID.
 * Uses Web Crypto API available in Bun runtime.
 */
function generateSessionId(): string {
	const bytes = new Uint8Array(SESSION_ID_LENGTH / 2);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * User data returned from session validation.
 * Matches the App.Locals.user type.
 */
export interface SessionUser {
	id: number;
	username: string;
	displayName: string | null;
	role: string;
}

/**
 * Creates a new session for a user.
 *
 * @param userId - The user ID to create session for
 * @param userAgent - Optional user agent string for audit
 * @param ipAddress - Optional IP address for audit
 * @returns The session ID token
 */
export async function createSession(
	userId: number,
	userAgent?: string,
	ipAddress?: string
): Promise<string> {
	const sessionId = generateSessionId();
	const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

	await db.insert(sessions).values({
		id: sessionId,
		userId,
		expiresAt,
		userAgent: userAgent ?? null,
		ipAddress: ipAddress ?? null
	});

	return sessionId;
}

/**
 * Validates a session and returns the associated user.
 * Updates lastAccessedAt for session activity tracking.
 *
 * @param sessionId - The session token to validate
 * @returns User object if valid, null if invalid or expired
 */
export async function validateSession(sessionId: string): Promise<SessionUser | null> {
	if (!sessionId || sessionId.length !== SESSION_ID_LENGTH) {
		return null;
	}

	const result = await db
		.select({
			session: sessions,
			user: {
				id: users.id,
				username: users.username,
				displayName: users.displayName,
				role: users.role
			}
		})
		.from(sessions)
		.innerJoin(users, eq(sessions.userId, users.id))
		.where(eq(sessions.id, sessionId))
		.limit(1);

	const row = result[0];
	if (!row) {
		return null;
	}

	// Check expiration
	if (row.session.expiresAt < new Date()) {
		// Clean up expired session
		await deleteSession(sessionId);
		return null;
	}

	// Update last accessed time (fire and forget - non-blocking)
	db.update(sessions)
		.set({ lastAccessedAt: new Date() })
		.where(eq(sessions.id, sessionId))
		.execute()
		.catch(() => {
			/* ignore errors - non-critical update */
		});

	return row.user;
}

/**
 * Deletes a session (logout).
 *
 * @param sessionId - The session to delete
 */
export async function deleteSession(sessionId: string): Promise<void> {
	await db.delete(sessions).where(eq(sessions.id, sessionId));
}

/**
 * Deletes all sessions for a user (force logout all devices).
 *
 * @param userId - The user ID to logout
 */
export async function deleteAllUserSessions(userId: number): Promise<void> {
	await db.delete(sessions).where(eq(sessions.userId, userId));
}

/**
 * Removes expired sessions from database.
 * Should be called periodically (e.g., by scheduler).
 *
 * @returns Number of sessions deleted
 */
export async function cleanupExpiredSessions(): Promise<number> {
	const result = await db
		.delete(sessions)
		.where(lt(sessions.expiresAt, new Date()))
		.returning({ id: sessions.id });

	return result.length;
}
