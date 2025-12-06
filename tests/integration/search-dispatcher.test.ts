/**
 * Integration tests for Search Dispatcher HTTP 429 handling.
 *
 * Validates requirement 7.3:
 * - WHEN an HTTP 429 response is received THEN the System SHALL pause all
 *   searches for the affected connector and apply extended cooldown
 *
 * These tests verify that RateLimitError from connector clients properly
 * triggers throttle state changes in the database.
 *
 * NOTE: These tests require a running PostgreSQL database with DATABASE_URL set.
 * Run with: bun test tests/integration/search-dispatcher.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { db } from '../../src/lib/server/db';
import { connectors, throttleState } from '../../src/lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { throttleEnforcer } from '../../src/lib/server/services/throttle/throttle-enforcer';
import {
	getThrottleState,
	getOrCreateThrottleState
} from '../../src/lib/server/db/queries/throttle-state';
import { MODERATE_PRESET } from '../../src/lib/config/throttle-presets';

// Store original SECRET_KEY to restore after tests
const originalSecretKey = process.env.SECRET_KEY;

// Valid test SECRET_KEY (64 hex chars = 32 bytes = 256 bits)
const TEST_SECRET_KEY = 'a'.repeat(64);

// Test connector ID
let testConnectorId: number;

/**
 * Create a test connector in the database
 */
async function createTestConnector(): Promise<number> {
	const result = await db
		.insert(connectors)
		.values({
			type: 'sonarr',
			name: 'Test Sonarr Dispatcher',
			url: 'http://test-sonarr.local:8989',
			apiKeyEncrypted: 'testencryptedkey',
			enabled: true,
			queuePaused: false
		})
		.returning({ id: connectors.id });

	return result[0]!.id;
}

/**
 * Clean up throttle state for a connector
 */
async function cleanupThrottleState(connectorId: number): Promise<void> {
	await db.delete(throttleState).where(eq(throttleState.connectorId, connectorId));
}

// ============================================================================
// Test Setup and Teardown
// ============================================================================

beforeAll(async () => {
	// Set test SECRET_KEY
	process.env.SECRET_KEY = TEST_SECRET_KEY;

	// Create test connector
	testConnectorId = await createTestConnector();
});

afterAll(async () => {
	// Clean up throttle state
	await cleanupThrottleState(testConnectorId);

	// Delete test connector
	await db.delete(connectors).where(eq(connectors.id, testConnectorId));

	// Restore original SECRET_KEY
	if (originalSecretKey !== undefined) {
		process.env.SECRET_KEY = originalSecretKey;
	} else {
		delete process.env.SECRET_KEY;
	}
});

beforeEach(async () => {
	// Clean up throttle state before each test for isolation
	await cleanupThrottleState(testConnectorId);
});

// ============================================================================
// HTTP 429 Handling Integration Tests (Requirement 7.3)
// ============================================================================

describe('HTTP 429 Rate Limit Handling (Requirement 7.3)', () => {
	describe('handleRateLimitResponse database effects', () => {
		it('should set pausedUntil in throttle_state with Retry-After value', async () => {
			await getOrCreateThrottleState(testConnectorId);

			// Simulate receiving HTTP 429 with Retry-After: 120
			const retryAfterSeconds = 120;
			await throttleEnforcer.handleRateLimitResponse(testConnectorId, retryAfterSeconds);

			// Verify database state
			const state = await getThrottleState(testConnectorId);
			expect(state).not.toBeNull();
			expect(state!.pausedUntil).not.toBeNull();
			expect(state!.pauseReason).toBe('rate_limit');

			// Pause should be approximately 120 seconds from now
			const expectedPauseTime = Date.now() + retryAfterSeconds * 1000;
			const actualPauseTime = state!.pausedUntil!.getTime();
			expect(Math.abs(actualPauseTime - expectedPauseTime)).toBeLessThan(1000);
		});

		it('should use profile rateLimitPauseSeconds when no Retry-After header', async () => {
			await getOrCreateThrottleState(testConnectorId);

			// Simulate receiving HTTP 429 without Retry-After header
			await throttleEnforcer.handleRateLimitResponse(testConnectorId, undefined);

			// Verify database state
			const state = await getThrottleState(testConnectorId);
			expect(state).not.toBeNull();
			expect(state!.pausedUntil).not.toBeNull();
			expect(state!.pauseReason).toBe('rate_limit');

			// Pause should be approximately MODERATE_PRESET.rateLimitPauseSeconds from now (300 seconds)
			const expectedPauseTime = Date.now() + MODERATE_PRESET.rateLimitPauseSeconds * 1000;
			const actualPauseTime = state!.pausedUntil!.getTime();
			expect(Math.abs(actualPauseTime - expectedPauseTime)).toBeLessThan(1000);
		});

		it('should respect small Retry-After values', async () => {
			await getOrCreateThrottleState(testConnectorId);

			// Small Retry-After (30 seconds)
			const retryAfterSeconds = 30;
			await throttleEnforcer.handleRateLimitResponse(testConnectorId, retryAfterSeconds);

			const state = await getThrottleState(testConnectorId);
			const expectedPauseTime = Date.now() + retryAfterSeconds * 1000;
			const actualPauseTime = state!.pausedUntil!.getTime();
			expect(Math.abs(actualPauseTime - expectedPauseTime)).toBeLessThan(1000);
		});

		it('should respect large Retry-After values', async () => {
			await getOrCreateThrottleState(testConnectorId);

			// Large Retry-After (1 hour)
			const retryAfterSeconds = 3600;
			await throttleEnforcer.handleRateLimitResponse(testConnectorId, retryAfterSeconds);

			const state = await getThrottleState(testConnectorId);
			const expectedPauseTime = Date.now() + retryAfterSeconds * 1000;
			const actualPauseTime = state!.pausedUntil!.getTime();
			expect(Math.abs(actualPauseTime - expectedPauseTime)).toBeLessThan(1000);
		});
	});

	describe('canDispatch after rate limit', () => {
		it('should deny dispatch after handleRateLimitResponse is called', async () => {
			await getOrCreateThrottleState(testConnectorId);

			// First, verify dispatch is allowed
			const beforeResult = await throttleEnforcer.canDispatch(testConnectorId);
			expect(beforeResult.allowed).toBe(true);

			// Simulate HTTP 429 response
			await throttleEnforcer.handleRateLimitResponse(testConnectorId, 60);

			// Now dispatch should be denied
			const afterResult = await throttleEnforcer.canDispatch(testConnectorId);
			expect(afterResult.allowed).toBe(false);
			expect(afterResult.reason).toBe('rate_limit');
			expect(afterResult.retryAfterMs).toBeGreaterThan(0);
			expect(afterResult.retryAfterMs).toBeLessThanOrEqual(60000);
		});

		it('should include accurate retryAfterMs in denial result', async () => {
			await getOrCreateThrottleState(testConnectorId);

			const retryAfterSeconds = 120; // 2 minutes
			await throttleEnforcer.handleRateLimitResponse(testConnectorId, retryAfterSeconds);

			const result = await throttleEnforcer.canDispatch(testConnectorId);
			expect(result.allowed).toBe(false);
			expect(result.retryAfterMs).toBeDefined();
			// Should be approximately 2 minutes (120000ms) accounting for test execution time
			expect(result.retryAfterMs!).toBeGreaterThan(115000);
			expect(result.retryAfterMs!).toBeLessThanOrEqual(120000);
		});
	});

	describe('rate limit recovery', () => {
		it('should allow dispatch after pause expires', async () => {
			await getOrCreateThrottleState(testConnectorId);

			// Set a pause that has already expired
			const expiredPauseUntil = new Date(Date.now() - 1000); // 1 second ago
			await db
				.update(throttleState)
				.set({
					pausedUntil: expiredPauseUntil,
					pauseReason: 'rate_limit'
				})
				.where(eq(throttleState.connectorId, testConnectorId));

			// Clear expired pauses (would be done by scheduler in production)
			await throttleEnforcer.resetExpiredWindows();

			// Should now allow dispatch
			const result = await throttleEnforcer.canDispatch(testConnectorId);
			expect(result.allowed).toBe(true);
		});

		it('should clear rate_limit pause after reset', async () => {
			await getOrCreateThrottleState(testConnectorId);

			// Set a rate limit pause
			await throttleEnforcer.handleRateLimitResponse(testConnectorId, 60);

			// Manually clear the pause (simulate resumeDispatch or admin action)
			await throttleEnforcer.resumeDispatch(testConnectorId);

			// Verify pause is cleared
			const state = await getThrottleState(testConnectorId);
			expect(state!.pausedUntil).toBeNull();
			expect(state!.pauseReason).toBeNull();

			// Should allow dispatch
			const result = await throttleEnforcer.canDispatch(testConnectorId);
			expect(result.allowed).toBe(true);
		});
	});

	describe('status reporting after rate limit', () => {
		it('should reflect rate limit pause in getStatus', async () => {
			await getOrCreateThrottleState(testConnectorId);

			// Trigger rate limit
			await throttleEnforcer.handleRateLimitResponse(testConnectorId, 300);

			const status = await throttleEnforcer.getStatus(testConnectorId);

			expect(status.isPaused).toBe(true);
			expect(status.pauseReason).toBe('rate_limit');
			expect(status.pauseExpiresInMs).toBeGreaterThan(0);
			expect(status.pauseExpiresInMs!).toBeLessThanOrEqual(300000);
		});

		it('should show negative capacity when rate limited', async () => {
			await getOrCreateThrottleState(testConnectorId);

			// Trigger rate limit
			await throttleEnforcer.handleRateLimitResponse(testConnectorId, 60);

			const capacity = await throttleEnforcer.getAvailableCapacity(testConnectorId);

			expect(capacity).toBe(-1); // -1 indicates paused
		});
	});
});

// ============================================================================
// Extended Cooldown Tests (Requirement 7.3)
// ============================================================================

describe('Extended Cooldown Application', () => {
	it('should apply extended cooldown from profile when Retry-After is not provided', async () => {
		await getOrCreateThrottleState(testConnectorId);

		// Call without Retry-After
		await throttleEnforcer.handleRateLimitResponse(testConnectorId);

		const state = await getThrottleState(testConnectorId);
		const expectedPause = Date.now() + MODERATE_PRESET.rateLimitPauseSeconds * 1000;

		expect(state!.pausedUntil).not.toBeNull();
		// Should match profile's rateLimitPauseSeconds (300 for Moderate)
		expect(Math.abs(state!.pausedUntil!.getTime() - expectedPause)).toBeLessThan(1000);
	});

	it('should prefer Retry-After over profile config when both available', async () => {
		await getOrCreateThrottleState(testConnectorId);

		// Retry-After of 60 seconds (less than Moderate's 300 seconds)
		const retryAfterSeconds = 60;
		await throttleEnforcer.handleRateLimitResponse(testConnectorId, retryAfterSeconds);

		const state = await getThrottleState(testConnectorId);
		const expectedPause = Date.now() + retryAfterSeconds * 1000;

		// Should use Retry-After (60 seconds), not profile (300 seconds)
		expect(Math.abs(state!.pausedUntil!.getTime() - expectedPause)).toBeLessThan(1000);
	});
});
