/**
 * Database queries for authentication operations.
 *
 * Requirements: 10.1, 10.2, 35.1-35.5 (schema support)
 */

import { db } from '$lib/server/db';
import { users, type User, type NewUser } from '$lib/server/db/schema';
import { eq, sql } from 'drizzle-orm';

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
 * Records a failed login attempt (for lockout feature - Req 35.1).
 *
 * @param userId - The user ID that failed login
 */
export async function recordFailedLogin(userId: number): Promise<void> {
	await db
		.update(users)
		.set({
			failedLoginAttempts: sql`${users.failedLoginAttempts} + 1`,
			lastFailedLogin: new Date(),
			updatedAt: new Date()
		})
		.where(eq(users.id, userId));
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
 * Checks if a user account is currently locked (Req 35.3).
 *
 * @param user - User object with lockedUntil field
 * @returns true if account is locked, false otherwise
 */
export function isAccountLocked(user: { lockedUntil: Date | null }): boolean {
	if (!user.lockedUntil) return false;
	return user.lockedUntil > new Date();
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
