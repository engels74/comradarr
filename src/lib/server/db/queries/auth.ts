import { and, desc, eq, ne, sql } from 'drizzle-orm';
import {
	calculateLockoutExpiry,
	getRemainingLockoutTime,
	isAccountLocked,
	LOCKOUT_DURATION_MINUTES,
	MAX_FAILED_ATTEMPTS,
	shouldTriggerLockout
} from '$lib/server/auth/lockout';
import { db } from '$lib/server/db';
import { sessions, type User, users } from '$lib/server/db/schema';

export {
	MAX_FAILED_ATTEMPTS,
	LOCKOUT_DURATION_MINUTES,
	isAccountLocked,
	getRemainingLockoutTime,
	calculateLockoutExpiry,
	shouldTriggerLockout
};

export async function getUserByUsername(username: string): Promise<User | null> {
	const result = await db.select().from(users).where(eq(users.username, username)).limit(1);

	return result[0] ?? null;
}

export async function getUserById(id: number): Promise<User | null> {
	const result = await db.select().from(users).where(eq(users.id, id)).limit(1);

	return result[0] ?? null;
}

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

export interface FailedLoginResult {
	/** Whether the account is now locked */
	isLocked: boolean;
	/** Lockout duration in minutes (only set if isLocked is true) */
	lockoutMinutes?: number;
	attemptCount: number;
}

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

export async function lockUserAccount(userId: number, until: Date): Promise<void> {
	await db
		.update(users)
		.set({
			lockedUntil: until,
			updatedAt: new Date()
		})
		.where(eq(users.id, userId));
}

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

export async function updateUserPassword(userId: number, passwordHash: string): Promise<void> {
	await db
		.update(users)
		.set({
			passwordHash,
			updatedAt: new Date()
		})
		.where(eq(users.id, userId));
}

export async function hasUsers(): Promise<boolean> {
	const result = await db.select({ id: users.id }).from(users).limit(1);
	return result.length > 0;
}

export interface UserSession {
	id: string;
	createdAt: Date;
	lastAccessedAt: Date;
	expiresAt: Date;
	userAgent: string | null;
	ipAddress: string | null;
	isCurrent: boolean;
}

export async function getUserSessions(
	userId: number,
	currentSessionId?: string
): Promise<UserSession[]> {
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

export async function deleteUserSession(userId: number, sessionId: string): Promise<boolean> {
	const result = await db
		.delete(sessions)
		.where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
		.returning({ id: sessions.id });

	return result.length > 0;
}

export async function deleteOtherUserSessions(
	userId: number,
	currentSessionId: string
): Promise<number> {
	const result = await db
		.delete(sessions)
		.where(and(eq(sessions.userId, userId), ne(sessions.id, currentSessionId)))
		.returning({ id: sessions.id });

	return result.length;
}
