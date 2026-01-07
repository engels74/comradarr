export const MAX_FAILED_ATTEMPTS = 3;
export const LOCKOUT_DURATION_MINUTES = 30;

export function isAccountLocked(user: { lockedUntil: Date | null }): boolean {
	if (!user.lockedUntil) return false;
	return user.lockedUntil > new Date();
}

export function getRemainingLockoutTime(user: { lockedUntil: Date | null }): number | null {
	if (!user.lockedUntil) return null;
	const remaining = user.lockedUntil.getTime() - Date.now();
	return remaining > 0 ? Math.ceil(remaining / 1000) : null;
}

export function calculateLockoutExpiry(): Date {
	return new Date(Date.now() + LOCKOUT_DURATION_MINUTES * 60 * 1000);
}

export function shouldTriggerLockout(failedAttempts: number): boolean {
	return failedAttempts >= MAX_FAILED_ATTEMPTS;
}
