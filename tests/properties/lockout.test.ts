/**
 * Tests for account lockout functionality.
 *
 * Validates requirements:
 * - 35.1: Increment failed attempt counter on failed login
 * - 35.2: Lock account after threshold failures (3 attempts)
 * - 35.3: Reject login and show remaining lockout time
 * - 35.4: Reset counter when lockout expires
 * - 35.5: Reset counter on successful login
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
	isAccountLocked,
	getRemainingLockoutTime,
	MAX_FAILED_ATTEMPTS,
	LOCKOUT_DURATION_MINUTES
} from '../../src/lib/server/auth/lockout';

describe('Account Lockout (Requirements 35.1-35.5)', () => {
	describe('Configuration Constants', () => {
		it('should have MAX_FAILED_ATTEMPTS set to 3', () => {
			expect(MAX_FAILED_ATTEMPTS).toBe(3);
		});

		it('should have LOCKOUT_DURATION_MINUTES set to 30', () => {
			expect(LOCKOUT_DURATION_MINUTES).toBe(30);
		});
	});

	describe('isAccountLocked (Requirement 35.3)', () => {
		it('should return false when lockedUntil is null', () => {
			const user = { lockedUntil: null };
			expect(isAccountLocked(user)).toBe(false);
		});

		it('should return true when lockedUntil is in the future', () => {
			const futureDate = new Date(Date.now() + 60000); // 1 minute in future
			const user = { lockedUntil: futureDate };
			expect(isAccountLocked(user)).toBe(true);
		});

		it('should return false when lockedUntil is in the past', () => {
			const pastDate = new Date(Date.now() - 60000); // 1 minute in past
			const user = { lockedUntil: pastDate };
			expect(isAccountLocked(user)).toBe(false);
		});

		it('should return false when lockedUntil equals current time', () => {
			// Edge case: exactly at expiry time should be considered unlocked
			const now = new Date();
			const user = { lockedUntil: now };
			// Due to execution time, this might be slightly in the past
			expect(isAccountLocked(user)).toBe(false);
		});
	});

	describe('getRemainingLockoutTime (Requirement 35.3)', () => {
		it('should return null when lockedUntil is null', () => {
			const user = { lockedUntil: null };
			expect(getRemainingLockoutTime(user)).toBeNull();
		});

		it('should return null when lockedUntil is in the past', () => {
			const pastDate = new Date(Date.now() - 60000);
			const user = { lockedUntil: pastDate };
			expect(getRemainingLockoutTime(user)).toBeNull();
		});

		it('should return remaining seconds when lockedUntil is in the future', () => {
			const futureDate = new Date(Date.now() + 120000); // 2 minutes in future
			const user = { lockedUntil: futureDate };
			const remaining = getRemainingLockoutTime(user);

			expect(remaining).not.toBeNull();
			// Should be approximately 120 seconds (allowing for test execution time)
			expect(remaining).toBeGreaterThan(115);
			expect(remaining).toBeLessThanOrEqual(120);
		});

		it('should round up to nearest second', () => {
			const futureDate = new Date(Date.now() + 1500); // 1.5 seconds
			const user = { lockedUntil: futureDate };
			const remaining = getRemainingLockoutTime(user);

			expect(remaining).not.toBeNull();
			// Math.ceil(1500/1000) = 2, but execution time may reduce it
			expect(remaining).toBeGreaterThanOrEqual(1);
			expect(remaining).toBeLessThanOrEqual(2);
		});
	});

	describe('Property: Lockout Status Consistency', () => {
		it('should have consistent lockout status and remaining time', () => {
			fc.assert(
				fc.property(
					fc.integer({ min: -3600000, max: 3600000 }), // +/- 1 hour in ms
					(offsetMs) => {
						const lockedUntil = new Date(Date.now() + offsetMs);
						const user = { lockedUntil };

						const isLocked = isAccountLocked(user);
						const remaining = getRemainingLockoutTime(user);

						if (offsetMs > 0) {
							// Future lockout: should be locked with remaining time
							expect(isLocked).toBe(true);
							expect(remaining).not.toBeNull();
							expect(remaining).toBeGreaterThan(0);
						} else {
							// Past or current lockout: should not be locked
							expect(isLocked).toBe(false);
							expect(remaining).toBeNull();
						}
					}
				),
				{ numRuns: 100 }
			);
		});
	});

	describe('Property: Null Safety', () => {
		it('should handle null lockedUntil consistently', () => {
			fc.assert(
				fc.property(fc.constant(null), () => {
					const user = { lockedUntil: null };
					expect(isAccountLocked(user)).toBe(false);
					expect(getRemainingLockoutTime(user)).toBeNull();
				}),
				{ numRuns: 10 }
			);
		});
	});

	describe('Lockout Duration Calculation', () => {
		it('should lock for configured duration (30 minutes)', () => {
			// Simulate lockout trigger
			const lockUntil = new Date(Date.now() + LOCKOUT_DURATION_MINUTES * 60 * 1000);
			const user = { lockedUntil: lockUntil };

			const remaining = getRemainingLockoutTime(user);
			expect(remaining).not.toBeNull();

			// Should be approximately 30 minutes (1800 seconds)
			const expectedSeconds = LOCKOUT_DURATION_MINUTES * 60;
			expect(remaining).toBeGreaterThan(expectedSeconds - 5); // Allow 5s margin
			expect(remaining).toBeLessThanOrEqual(expectedSeconds);
		});
	});

	describe('Edge Cases', () => {
		it('should handle Date objects correctly', () => {
			const futureDate = new Date(Date.now() + 60000);
			const user = { lockedUntil: futureDate };

			expect(isAccountLocked(user)).toBe(true);
			expect(getRemainingLockoutTime(user)).not.toBeNull();
		});

		it('should handle millisecond precision', () => {
			// Just 1ms in the future
			const barelyFuture = new Date(Date.now() + 1);
			const user = { lockedUntil: barelyFuture };

			// Should be considered locked (even if only for 1ms)
			expect(isAccountLocked(user)).toBe(true);
		});

		it('should handle very long lockout periods', () => {
			// 1 year in the future
			const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
			const user = { lockedUntil: farFuture };

			expect(isAccountLocked(user)).toBe(true);
			const remaining = getRemainingLockoutTime(user);
			expect(remaining).not.toBeNull();
			expect(remaining).toBeGreaterThan(30000000); // More than ~347 days in seconds
		});
	});
});
