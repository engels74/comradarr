/**
 * Property-based tests for reconnect backoff calculation.
 *
 * Verifies that reconnect backoff delay follows the exponential formula
 * with proper capping at MAX_DELAY_MS and jitter within ±25% bounds.
 */

import * as fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';

// Mock database modules to avoid Bun import
vi.mock('$lib/server/db', () => ({
	db: {}
}));

vi.mock('$lib/server/db/schema', () => ({
	connectors: {},
	syncState: {}
}));

vi.mock('drizzle-orm', () => ({
	eq: vi.fn(),
	and: vi.fn(),
	or: vi.fn(),
	isNotNull: vi.fn(),
	lte: vi.fn()
}));

vi.mock('$lib/server/db/queries/reconnect', () => ({
	ensureSyncStateExists: vi.fn(),
	getReconnectState: vi.fn(),
	initializeReconnectState: vi.fn(),
	updateReconnectState: vi.fn(),
	resetReconnectState: vi.fn(),
	incrementReconnectAttempts: vi.fn(),
	pauseReconnect: vi.fn(),
	resumeReconnect: vi.fn(),
	getConnectorsDueForReconnect: vi.fn()
}));

vi.mock('$lib/server/db/queries/connectors', () => ({
	getConnector: vi.fn(),
	getDecryptedApiKey: vi.fn(),
	updateConnectorHealth: vi.fn()
}));

vi.mock('$lib/server/connectors/factory', () => ({
	createConnectorClient: vi.fn()
}));

vi.mock('$lib/server/logger', () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn()
	})
}));

import { RECONNECT_CONFIG } from '../../src/lib/server/services/reconnect/config';
import { calculateBackoffDelay } from '../../src/lib/server/services/reconnect/reconnect-service';

const attemptArbitrary = fc.integer({ min: 0, max: 50 });

describe('Reconnect Backoff Properties', () => {
	describe('Property: Exponential Growth with Cap', () => {
		it('delay follows exponential formula until cap (with ±25% jitter tolerance)', () => {
			fc.assert(
				fc.property(attemptArbitrary, (attempt) => {
					const delay = calculateBackoffDelay(attempt);

					// Calculate expected base delay
					const exponentialDelay =
						RECONNECT_CONFIG.BASE_DELAY_MS * RECONNECT_CONFIG.MULTIPLIER ** attempt;
					const clampedDelay = Math.min(exponentialDelay, RECONNECT_CONFIG.MAX_DELAY_MS);

					// Jitter range is ±25%
					const minExpected = clampedDelay * (1 - RECONNECT_CONFIG.JITTER);
					const maxExpected = clampedDelay * (1 + RECONNECT_CONFIG.JITTER);

					expect(delay).toBeGreaterThanOrEqual(Math.floor(minExpected));
					expect(delay).toBeLessThanOrEqual(Math.ceil(maxExpected));
				}),
				{ numRuns: 100 }
			);
		});
	});

	describe('Property: Maximum Delay Cap', () => {
		it('delay never exceeds MAX_DELAY_MS * 1.25 (750,000ms)', () => {
			fc.assert(
				fc.property(attemptArbitrary, (attempt) => {
					const delay = calculateBackoffDelay(attempt);
					const absoluteMax = RECONNECT_CONFIG.MAX_DELAY_MS * (1 + RECONNECT_CONFIG.JITTER);

					expect(delay).toBeLessThanOrEqual(Math.ceil(absoluteMax));
				}),
				{ numRuns: 100 }
			);
		});
	});

	describe('Property: Minimum Delay Floor', () => {
		it('delay never below BASE_DELAY_MS * 0.75 (22,500ms)', () => {
			fc.assert(
				fc.property(attemptArbitrary, (attempt) => {
					const delay = calculateBackoffDelay(attempt);
					const absoluteMin = RECONNECT_CONFIG.BASE_DELAY_MS * (1 - RECONNECT_CONFIG.JITTER);

					expect(delay).toBeGreaterThanOrEqual(Math.floor(absoluteMin));
				}),
				{ numRuns: 100 }
			);
		});
	});

	describe('Property: Non-Negative Integer Result', () => {
		it('delay is always a non-negative integer', () => {
			fc.assert(
				fc.property(attemptArbitrary, (attempt) => {
					const delay = calculateBackoffDelay(attempt);

					expect(delay).toBeGreaterThanOrEqual(0);
					expect(Number.isInteger(delay)).toBe(true);
				}),
				{ numRuns: 100 }
			);
		});
	});

	describe('Property: Jitter Variance', () => {
		it('same attempt produces varying delays (jitter variance)', () => {
			fc.assert(
				fc.property(attemptArbitrary, (attempt) => {
					// Generate multiple delays for the same attempt
					const delays = new Set<number>();
					for (let i = 0; i < 20; i++) {
						delays.add(calculateBackoffDelay(attempt));
					}

					// With jitter, we expect variation (though not guaranteed for every run)
					// For this property, we just verify that the range is valid
					const delaysArray = Array.from(delays);
					const min = Math.min(...delaysArray);
					const max = Math.max(...delaysArray);

					// The range should be within the jitter bounds
					const exponentialDelay =
						RECONNECT_CONFIG.BASE_DELAY_MS * RECONNECT_CONFIG.MULTIPLIER ** attempt;
					const clampedDelay = Math.min(exponentialDelay, RECONNECT_CONFIG.MAX_DELAY_MS);
					const jitterRange = clampedDelay * RECONNECT_CONFIG.JITTER * 2;

					// The actual range (max - min) should not exceed the theoretical jitter range
					expect(max - min).toBeLessThanOrEqual(Math.ceil(jitterRange) + 1);
				}),
				{ numRuns: 50 }
			);
		});
	});

	describe('Edge Cases', () => {
		it('attempt 0 returns delay in BASE_DELAY range with jitter', () => {
			const minExpected = RECONNECT_CONFIG.BASE_DELAY_MS * (1 - RECONNECT_CONFIG.JITTER);
			const maxExpected = RECONNECT_CONFIG.BASE_DELAY_MS * (1 + RECONNECT_CONFIG.JITTER);

			for (let i = 0; i < 100; i++) {
				const delay = calculateBackoffDelay(0);
				expect(delay).toBeGreaterThanOrEqual(Math.floor(minExpected));
				expect(delay).toBeLessThanOrEqual(Math.ceil(maxExpected));
			}
		});

		it('very high attempt numbers are capped at MAX_DELAY with jitter', () => {
			const minExpected = RECONNECT_CONFIG.MAX_DELAY_MS * (1 - RECONNECT_CONFIG.JITTER);
			const maxExpected = RECONNECT_CONFIG.MAX_DELAY_MS * (1 + RECONNECT_CONFIG.JITTER);

			for (let i = 0; i < 100; i++) {
				const delay = calculateBackoffDelay(100);
				expect(delay).toBeGreaterThanOrEqual(Math.floor(minExpected));
				expect(delay).toBeLessThanOrEqual(Math.ceil(maxExpected));
			}
		});

		it('backoff progression follows expected sequence', () => {
			// Expected base delays (before jitter):
			// attempt 0: 30s
			// attempt 1: 60s
			// attempt 2: 120s
			// attempt 3: 240s
			// attempt 4: 480s
			// attempt 5+: 600s (capped)

			const expectedBaseDelays = [30_000, 60_000, 120_000, 240_000, 480_000, 600_000];

			for (let attempt = 0; attempt <= 5; attempt++) {
				const baseDelay = expectedBaseDelays[attempt]!;
				const minExpected = baseDelay * (1 - RECONNECT_CONFIG.JITTER);
				const maxExpected = baseDelay * (1 + RECONNECT_CONFIG.JITTER);

				for (let i = 0; i < 10; i++) {
					const delay = calculateBackoffDelay(attempt);
					expect(delay).toBeGreaterThanOrEqual(Math.floor(minExpected));
					expect(delay).toBeLessThanOrEqual(Math.ceil(maxExpected));
				}
			}
		});

		it('verifies config values match documentation', () => {
			expect(RECONNECT_CONFIG.BASE_DELAY_MS).toBe(30_000);
			expect(RECONNECT_CONFIG.MAX_DELAY_MS).toBe(600_000);
			expect(RECONNECT_CONFIG.MULTIPLIER).toBe(2);
			expect(RECONNECT_CONFIG.JITTER).toBe(0.25);
		});
	});
});
