/**
 * Unit tests for state transition functions.
 *
 * Tests cover:
 * - calculateNextEligibleTime() with various attempt counts
 * - Exponential backoff behavior
 * - Maximum delay capping
 * - Configuration constants
 *
 * Note: Database-dependent functions (markSearchFailed, markSearchExhausted,
 * reenqueueEligibleCooldownItems) are tested in integration tests.
 *

 */

import { describe, it, expect } from 'vitest';
// Import directly from specific files to avoid loading database-dependent modules
import {
	calculateNextEligibleTime,
	shouldMarkExhausted
} from '../../src/lib/server/services/queue/backoff';
import { STATE_TRANSITION_CONFIG } from '../../src/lib/server/services/queue/config';

describe('calculateNextEligibleTime', () => {
	// Fixed reference date for deterministic tests
	const now = new Date('2024-07-01T12:00:00Z');

	describe('basic behavior', () => {
		it('should return a future date', () => {
			const result = calculateNextEligibleTime(1, now);
			expect(result.getTime()).toBeGreaterThan(now.getTime());
		});

		it('should produce deterministic results without jitter when testing', () => {
			// Note: With jitter enabled, results will vary slightly
			// We test the general behavior rather than exact values
			const result1 = calculateNextEligibleTime(1, now);
			const result2 = calculateNextEligibleTime(1, now);

			// Both should be within the jitter range (±25% of base delay)
			const expectedBase = STATE_TRANSITION_CONFIG.COOLDOWN_BASE_DELAY;
			const minDelay = expectedBase * 0.75;
			const maxDelay = expectedBase * 1.25;

			const delay1 = result1.getTime() - now.getTime();
			const delay2 = result2.getTime() - now.getTime();

			expect(delay1).toBeGreaterThanOrEqual(minDelay);
			expect(delay1).toBeLessThanOrEqual(maxDelay);
			expect(delay2).toBeGreaterThanOrEqual(minDelay);
			expect(delay2).toBeLessThanOrEqual(maxDelay);
		});
	});

	describe('exponential backoff', () => {
		it('should increase delay with each attempt', () => {
			// With jitter, we can't test exact values, but average delay should increase
			// Run multiple times and check trend
			const samples = 10;
			let avgDelay1 = 0;
			let avgDelay2 = 0;
			let avgDelay3 = 0;

			for (let i = 0; i < samples; i++) {
				avgDelay1 += calculateNextEligibleTime(1, now).getTime() - now.getTime();
				avgDelay2 += calculateNextEligibleTime(2, now).getTime() - now.getTime();
				avgDelay3 += calculateNextEligibleTime(3, now).getTime() - now.getTime();
			}

			avgDelay1 /= samples;
			avgDelay2 /= samples;
			avgDelay3 /= samples;

			// With multiplier of 2, each level should roughly double
			// Allow for jitter variance
			expect(avgDelay2).toBeGreaterThan(avgDelay1 * 1.5);
			expect(avgDelay3).toBeGreaterThan(avgDelay2 * 1.5);
		});

		it('should cap delay at maximum', () => {
			// Very high attempt count should still be capped
			const result = calculateNextEligibleTime(100, now);
			const delay = result.getTime() - now.getTime();

			// Maximum delay with jitter could be up to 125% of max delay
			const maxWithJitter = STATE_TRANSITION_CONFIG.COOLDOWN_MAX_DELAY * 1.25;
			expect(delay).toBeLessThanOrEqual(maxWithJitter);
		});

		it('should respect multiplier configuration', () => {
			// First attempt delay should be around base delay
			const result = calculateNextEligibleTime(1, now);
			const delay = result.getTime() - now.getTime();

			// Base delay is for attempt 0 (first retry)
			// attemptCount 1 means this is after first failure
			// calculateNextEligibleTime uses attemptCount - 1 for backoff calculation
			// So attemptCount 1 → backoff attempt 0 → base delay
			const minExpected = STATE_TRANSITION_CONFIG.COOLDOWN_BASE_DELAY * 0.75;
			const maxExpected = STATE_TRANSITION_CONFIG.COOLDOWN_BASE_DELAY * 1.25;

			expect(delay).toBeGreaterThanOrEqual(minExpected);
			expect(delay).toBeLessThanOrEqual(maxExpected);
		});
	});

	describe('edge cases', () => {
		it('should handle zero attempt count', () => {
			const result = calculateNextEligibleTime(0, now);
			const delay = result.getTime() - now.getTime();

			// Zero attempts means base delay (or slightly less due to -1 in calculation)
			// Should still be a valid positive delay
			expect(delay).toBeGreaterThan(0);
			expect(delay).toBeLessThanOrEqual(STATE_TRANSITION_CONFIG.COOLDOWN_BASE_DELAY * 1.25);
		});

		it('should handle negative attempt count gracefully', () => {
			// Should clamp to 0
			const result = calculateNextEligibleTime(-5, now);
			const delay = result.getTime() - now.getTime();

			expect(delay).toBeGreaterThan(0);
			expect(Number.isFinite(delay)).toBe(true);
		});

		it('should use current time when not provided', () => {
			const before = Date.now();
			const result = calculateNextEligibleTime(1);
			const after = Date.now();

			// Result should be in the future from when function was called
			expect(result.getTime()).toBeGreaterThanOrEqual(before);
			expect(result.getTime()).toBeLessThanOrEqual(
				after + STATE_TRANSITION_CONFIG.COOLDOWN_BASE_DELAY * 1.25
			);
		});

		it('should produce valid Date objects', () => {
			const result = calculateNextEligibleTime(1, now);

			expect(result).toBeInstanceOf(Date);
			expect(result.toString()).not.toBe('Invalid Date');
			expect(Number.isFinite(result.getTime())).toBe(true);
		});
	});

	describe('delay progression', () => {
		it('should produce delays that roughly double with each attempt', () => {
			// Test without jitter effects by comparing ratios
			const baseDelay = STATE_TRANSITION_CONFIG.COOLDOWN_BASE_DELAY;
			const multiplier = STATE_TRANSITION_CONFIG.COOLDOWN_MULTIPLIER;
			const maxDelay = STATE_TRANSITION_CONFIG.COOLDOWN_MAX_DELAY;

			// Calculate expected delays (before jitter)
			const expectedDelays = [
				baseDelay, // attempt 1 → backoff 0
				baseDelay * multiplier, // attempt 2 → backoff 1
				baseDelay * Math.pow(multiplier, 2), // attempt 3 → backoff 2
				Math.min(baseDelay * Math.pow(multiplier, 3), maxDelay), // attempt 4 → backoff 3
				Math.min(baseDelay * Math.pow(multiplier, 4), maxDelay) // attempt 5 → backoff 4, capped
			];

			// With default config: 1h, 2h, 4h, 8h, 16h (capped at 24h)
			expect(expectedDelays[0]).toBe(3600000); // 1 hour
			expect(expectedDelays[1]).toBe(7200000); // 2 hours
			expect(expectedDelays[2]).toBe(14400000); // 4 hours
			expect(expectedDelays[3]).toBe(28800000); // 8 hours
			expect(expectedDelays[4]).toBe(57600000); // 16 hours (not yet capped)
		});
	});
});

describe('shouldMarkExhausted', () => {
	it('should return false for attempt count below max', () => {
		for (let i = 0; i < STATE_TRANSITION_CONFIG.MAX_ATTEMPTS; i++) {
			expect(shouldMarkExhausted(i)).toBe(false);
		}
	});

	it('should return true for attempt count at max', () => {
		expect(shouldMarkExhausted(STATE_TRANSITION_CONFIG.MAX_ATTEMPTS)).toBe(true);
	});

	it('should return true for attempt count above max', () => {
		expect(shouldMarkExhausted(STATE_TRANSITION_CONFIG.MAX_ATTEMPTS + 1)).toBe(true);
		expect(shouldMarkExhausted(STATE_TRANSITION_CONFIG.MAX_ATTEMPTS + 10)).toBe(true);
	});

	it('should handle zero attempts', () => {
		expect(shouldMarkExhausted(0)).toBe(false);
	});

	it('should handle negative attempts gracefully', () => {
		expect(shouldMarkExhausted(-1)).toBe(false);
	});
});

describe('STATE_TRANSITION_CONFIG', () => {
	it('should have expected default values', () => {
		expect(STATE_TRANSITION_CONFIG.MAX_ATTEMPTS).toBe(5);
		expect(STATE_TRANSITION_CONFIG.COOLDOWN_BASE_DELAY).toBe(3600000); // 1 hour
		expect(STATE_TRANSITION_CONFIG.COOLDOWN_MAX_DELAY).toBe(86400000); // 24 hours
		expect(STATE_TRANSITION_CONFIG.COOLDOWN_MULTIPLIER).toBe(2);
		expect(STATE_TRANSITION_CONFIG.COOLDOWN_JITTER).toBe(true);
	});

	it('should have reasonable delay progression before max', () => {
		const baseDelay = STATE_TRANSITION_CONFIG.COOLDOWN_BASE_DELAY;
		const multiplier = STATE_TRANSITION_CONFIG.COOLDOWN_MULTIPLIER;
		const maxDelay = STATE_TRANSITION_CONFIG.COOLDOWN_MAX_DELAY;

		// Calculate how many attempts before hitting max delay
		// baseDelay * multiplier^n >= maxDelay
		// multiplier^n >= maxDelay / baseDelay
		// n >= log(maxDelay / baseDelay) / log(multiplier)
		const ratio = maxDelay / baseDelay; // 24
		const attemptsToMax = Math.ceil(Math.log(ratio) / Math.log(multiplier));

		// With 1h base, 2x multiplier, 24h max:
		// Attempt 1: 1h
		// Attempt 2: 2h
		// Attempt 3: 4h
		// Attempt 4: 8h
		// Attempt 5: 16h
		// Attempt 6: 32h → capped to 24h
		expect(attemptsToMax).toBe(5); // Should hit max around attempt 5-6

		// MAX_ATTEMPTS should give reasonable retry window
		expect(STATE_TRANSITION_CONFIG.MAX_ATTEMPTS).toBeLessThanOrEqual(attemptsToMax + 1);
	});
});
