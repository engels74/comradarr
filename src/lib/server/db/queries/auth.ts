/**
 * Database queries for authentication operations.
 *
 * Requirements: 10.1, 10.2, 35.1-35.5
 */

import { db } from '$lib/server/db';
import { users, type User, type NewUser } from '$lib/server/db/schema';
import { eq, sql } from 'drizzle-orm';
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
