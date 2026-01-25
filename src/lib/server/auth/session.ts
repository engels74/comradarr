/**
 * Session management service for PostgreSQL-backed sessions.
 * Sessions expire after 7 days. IDs are 64-character hex strings (256 bits).
 */

import { eq, lt } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { sessions, users } from '$lib/server/db/schema';
import { createLogger } from '$lib/server/logger';

const logger = createLogger('session');

const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_ID_LENGTH = 64;

function generateSessionId(): string {
	const bytes = new Uint8Array(SESSION_ID_LENGTH / 2);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface SessionUser {
	id: number;
	username: string;
	displayName: string | null;
	role: string;
}

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

	logger.debug('Session created', { userId, expiresAt: expiresAt.toISOString() });

	return sessionId;
}

export async function validateSession(sessionId: string): Promise<SessionUser | null> {
	if (!sessionId || sessionId.length !== SESSION_ID_LENGTH) {
		logger.debug('Invalid session format');
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
		logger.debug('Session not found');
		return null;
	}

	if (row.session.expiresAt < new Date()) {
		logger.debug('Session expired', { userId: row.user.id });
		await deleteSession(sessionId);
		return null;
	}

	// Non-blocking update for activity tracking
	db.update(sessions)
		.set({ lastAccessedAt: new Date() })
		.where(eq(sessions.id, sessionId))
		.execute()
		.catch((error) => {
			logger.warn('Failed to update session activity', {
				error: error instanceof Error ? error.message : 'Unknown error'
			});
		});

	logger.trace('Session validated', { userId: row.user.id });
	return row.user;
}

export async function deleteSession(sessionId: string): Promise<void> {
	await db.delete(sessions).where(eq(sessions.id, sessionId));
	logger.debug('Session deleted');
}

export async function deleteAllUserSessions(userId: number): Promise<void> {
	await db.delete(sessions).where(eq(sessions.userId, userId));
	logger.info('All user sessions deleted', { userId });
}

export async function cleanupExpiredSessions(): Promise<number> {
	const result = await db
		.delete(sessions)
		.where(lt(sessions.expiresAt, new Date()))
		.returning({ id: sessions.id });

	logger.info('Expired sessions cleaned up', { count: result.length });
	return result.length;
}
