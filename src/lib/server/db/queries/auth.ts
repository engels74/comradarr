/**
 * Database queries for authentication operations.
 */

import { db } from '$lib/server/db';
import { users, sessions, type User, type NewUser } from '$lib/server/db/schema';
import { eq, sql, and, ne, desc } from 'drizzle-orm';
import {
	MAX_FAILED_ATTEMPTS,
	LOCKOUT_DURATION_MINUTES,
	isAccountLocked,
	getRemainingLockoutTime,
	calculateLockoutExpiry,
	shouldTriggerLockout
} from '$lib/server/auth/lockout';

// Re-export lockout utilities for backward compatibility
export {
	MAX_FAILED_ATTEMPTS,
	LOCKOUT_DURATION_MINUTES,
	isAccountLocked,
	getRemainingLockoutTime,
	calculateLockoutExpiry,
	shouldTriggerLockout
};

/**
 * Gets a user by username for login.
 *
 * @param username - The username to look up
 * @returns User if found, null otherwise
 */
export async function getUserByUsername(username: string): Promise<User | null> {
	const result = await db.select().from(users).where(eq(users.username, username)).limit(1);

	return result[0] ?? null;
}

/**
 * Gets a user by ID.
 *
 * @param id - The user ID to look up
 * @returns User if found, null otherwise
 */
export async function getUserById(id: number): Promise<User | null> {
	const result = await db.select().from(users).where(eq(users.id, id)).limit(1);

	return result[0] ?? null;
}

/**
 * Creates a new user.
 *
 * @param data - User data including username and passwordHash
 * @returns Created user
 */
export async function createUser(data: {
	username: string;
	passwordHash: string;
	displayName?: string;
	role?: string;
}): Promise<User> {
	const result = await db
		.insert(users)
		.values({
			username: data.username,
			passwordHash: data.passwordHash,
			displayName: data.displayName ?? null,
			role: data.role ?? 'user'
		})
		.returning();

	return result[0]!;
}

/**
 * Result of a failed login attempt.
 */
export interface FailedLoginResult {
	/** Whether the account is now locked */
	isLocked: boolean;
	/** Lockout duration in minutes (only set if isLocked is true) */
	lockoutMinutes?: number;
	/** Current failed attempt count */
	attemptCount: number;
}

/**
 * Records a failed login attempt and triggers lockout if threshold exceeded (Req 35.1, 35.2).
 *
 * @param userId - The user ID that failed login
 * @returns Result containing lockout status and attempt count
 */
export async function recordFailedLogin(userId: number): Promise<FailedLoginResult> {
	// Increment the counter and get the new value
	const result = await db
		.update(users)
		.set({
			failedLoginAttempts: sql`${users.failedLoginAttempts} + 1`,
			lastFailedLogin: new Date(),
			updatedAt: new Date()
		})
		.where(eq(users.id, userId))
		.returning({ failedLoginAttempts: users.failedLoginAttempts });

	const newCount = result[0]?.failedLoginAttempts ?? 0;

	// Check if should lock account (Req 35.2)
	if (shouldTriggerLockout(newCount)) {
		const lockUntil = calculateLockoutExpiry();
		await lockUserAccount(userId, lockUntil);
		return {
			isLocked: true,
			lockoutMinutes: LOCKOUT_DURATION_MINUTES,
			attemptCount: newCount
		};
	}

	return {
		isLocked: false,
		attemptCount: newCount
	};
}

/**
 * Resets failed login counter on successful login (Req 35.5).
 *
 * @param userId - The user ID that successfully logged in
 */
export async function recordSuccessfulLogin(userId: number): Promise<void> {
	await db
		.update(users)
		.set({
			failedLoginAttempts: 0,
			lockedUntil: null,
			lastFailedLogin: null,
			lastLogin: new Date(),
			updatedAt: new Date()
		})
		.where(eq(users.id, userId));
}

/**
 * Locks a user account until specified time (Req 35.2, 35.3).
 *
 * @param userId - The user ID to lock
 * @param until - When the lock expires
 */
export async function lockUserAccount(userId: number, until: Date): Promise<void> {
	await db
		.update(users)
		.set({
			lockedUntil: until,
			updatedAt: new Date()
		})
		.where(eq(users.id, userId));
}

/**
 * Checks if account is locked, and resets lockout if expired (Req 35.3, 35.4).
 *
 * This function should be called at login time to automatically reset
 * the failed attempt counter when the lockout period has expired.
 *
 * @param user - User object with lockout fields
 * @returns true if account is still locked, false if not locked or lockout expired
 */
export async function checkAndResetLockout(user: User): Promise<boolean> {
	if (!user.lockedUntil) return false;

	const now = new Date();
	if (user.lockedUntil > now) {
		return true; // Still locked
	}

	// Lockout expired - reset counter (Req 35.4)
	await db
		.update(users)
		.set({
			failedLoginAttempts: 0,
			lockedUntil: null,
			lastFailedLogin: null,
			updatedAt: now
		})
		.where(eq(users.id, user.id));

	return false;
}

/**
 * Updates user's password hash.
 *
 * @param userId - The user ID to update
 * @param passwordHash - New Argon2id password hash
 */
export async function updateUserPassword(userId: number, passwordHash: string): Promise<void> {
	await db
		.update(users)
		.set({
			passwordHash,
			updatedAt: new Date()
		})
		.where(eq(users.id, userId));
}

/**
 * Checks if any users exist in the database.
 * Used during initial setup to determine if admin account needs creation.
 *
 * @returns true if at least one user exists
 */
export async function hasUsers(): Promise<boolean> {
	const result = await db.select({ id: users.id }).from(users).limit(1);
	return result.length > 0;
}

// =============================================================================
// Session Management
// =============================================================================

/**
 * Represents a user session for display in security settings.
 */
export interface UserSession {
	id: string;
	createdAt: Date;
	lastAccessedAt: Date;
	expiresAt: Date;
	userAgent: string | null;
	ipAddress: string | null;
	isCurrent: boolean;
}

/**
 * Gets all active sessions for a user.
 *
 * @param userId - The user ID to get sessions for
 * @param currentSessionId - Optional current session ID to mark as current
 * @returns Array of user sessions, sorted by last accessed (most recent first)
 */
export async function getUserSessions(userId: number, currentSessionId?: string): Promise<UserSession[]> {
	const now = new Date();

	const result = await db
		.select({
			id: sessions.id,
			createdAt: sessions.createdAt,
			lastAccessedAt: sessions.lastAccessedAt,
			expiresAt: sessions.expiresAt,
			userAgent: sessions.userAgent,
			ipAddress: sessions.ipAddress
		})
		.from(sessions)
		.where(and(eq(sessions.userId, userId), sql`${sessions.expiresAt} > ${now}`))
		.orderBy(desc(sessions.lastAccessedAt));

	return result.map((session) => ({
		...session,
		isCurrent: session.id === currentSessionId
	}));
}

/**
 * Deletes a specific session for a user.
 *
 * @param userId - The user ID (for authorization check)
 * @param sessionId - The session ID to delete
 * @returns true if session was deleted, false if not found or unauthorized
 */
export async function deleteUserSession(userId: number, sessionId: string): Promise<boolean> {
	const result = await db
		.delete(sessions)
		.where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
		.returning({ id: sessions.id });

	return result.length > 0;
}

/**
 * Deletes all sessions for a user except the current one.
 *
 * @param userId - The user ID
 * @param currentSessionId - The current session ID to keep
 * @returns Number of sessions deleted
 */
export async function deleteOtherUserSessions(userId: number, currentSessionId: string): Promise<number> {
	const result = await db
		.delete(sessions)
		.where(and(eq(sessions.userId, userId), ne(sessions.id, currentSessionId)))
		.returning({ id: sessions.id });

	return result.length;
}
