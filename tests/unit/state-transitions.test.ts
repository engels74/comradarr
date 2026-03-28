/**
 * Unit tests for state transition configuration.
 *
 * Note: Database-dependent functions (markSearchFailed,
 * reenqueueEligibleCooldownItems) are tested in integration tests.
 */

import { describe, expect, it } from 'vitest';
// Import directly from specific files to avoid loading database-dependent modules
import { STATE_TRANSITION_CONFIG } from '../../src/lib/server/services/queue/config';

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
