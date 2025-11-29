/**
 * Account lockout configuration and pure utility functions.
 *
 * This file contains only pure functions that don't depend on the database,
 * making them easy to test without mocking.
 *
 * Requirements: 35.2, 35.3, 35.4
 */

// ============================================================================
// Account Lockout Configuration (Requirements 35.2, 35.4)
// ============================================================================

/** Maximum failed login attempts before account lockout (Req 35.2) */
export const MAX_FAILED_ATTEMPTS = 3;

/** Lockout duration in minutes (Req 35.2, 35.4) */
export const LOCKOUT_DURATION_MINUTES = 30;

// ============================================================================
// Pure Utility Functions (no database dependencies)
// ============================================================================

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
 * Gets the remaining lockout time in seconds (Req 35.3).
 *
 * @param user - User object with lockedUntil field
 * @returns Remaining seconds until lockout expires, or null if not locked
 */
export function getRemainingLockoutTime(user: { lockedUntil: Date | null }): number | null {
	if (!user.lockedUntil) return null;
	const remaining = user.lockedUntil.getTime() - Date.now();
	return remaining > 0 ? Math.ceil(remaining / 1000) : null;
}

/**
 * Calculates the lockout expiration date based on current time.
 *
 * @returns Date when lockout will expire
 */
export function calculateLockoutExpiry(): Date {
	return new Date(Date.now() + LOCKOUT_DURATION_MINUTES * 60 * 1000);
}

/**
 * Checks if the failure count should trigger an account lockout.
 *
 * @param failedAttempts - Current number of failed attempts
 * @returns true if account should be locked
 */
export function shouldTriggerLockout(failedAttempts: number): boolean {
	return failedAttempts >= MAX_FAILED_ATTEMPTS;
}
