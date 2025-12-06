/**
 * Integration tests for ThrottleEnforcer service.
 *
 * Validates requirements:
 * - 7.1: Enforce requests per minute, batch size, cooldown periods, and daily request budget limits
 * - 7.2: Pause queue processing when daily budget is exhausted until next day
 * - 7.7: Use global default profile (Moderate preset) when connector has no profile assigned
 *
 * NOTE: These tests require a running PostgreSQL database with DATABASE_URL set.
 * Run with: bun test tests/integration/throttle-enforcer.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { db } from '../../src/lib/server/db';
import {
	connectors,
	throttleProfiles,
	throttleState
} from '../../src/lib/server/db/schema';
import { eq } from 'drizzle-orm';
import {
	ThrottleEnforcer,
	throttleEnforcer
} from '../../src/lib/server/services/throttle/throttle-enforcer';
import {
	getThrottleState,
	getOrCreateThrottleState,
	incrementRequestCounters,
	resetMinuteWindow,
	resetDayWindow,
	setPausedUntil,
	getStartOfDayUTC
} from '../../src/lib/server/db/queries/throttle-state';
import {
	getThrottleProfileForConnector,
	createThrottleProfile,
	assignThrottleProfileToConnector,
	deleteThrottleProfile
} from '../../src/lib/server/db/queries/throttle';
import { MODERATE_PRESET, CONSERVATIVE_PRESET } from '../../src/lib/config/throttle-presets';

// Store original SECRET_KEY to restore after tests
const originalSecretKey = process.env.SECRET_KEY;

// Valid test SECRET_KEY (64 hex chars = 32 bytes = 256 bits)
const TEST_SECRET_KEY = 'a'.repeat(64);

// Test connector ID
let testConnectorId: number;
let testThrottleProfileId: number | null = null;

/**
 * Create a test connector in the database
 */
async function createTestConnector(): Promise<number> {
	const result = await db
		.insert(connectors)
		.values({
			type: 'sonarr',
			name: 'Test Sonarr Throttle Enforcer',
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

	// Clean up test throttle profile if created
	if (testThrottleProfileId !== null) {
		// First unassign from connector
		await assignThrottleProfileToConnector(testConnectorId, null);
		try {
			await deleteThrottleProfile(testThrottleProfileId);
		} catch {
			// Ignore errors during cleanup
		}
	}

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

	// Reset connector's throttle profile assignment
	await assignThrottleProfileToConnector(testConnectorId, null);
});

// ============================================================================
// Throttle State CRUD Tests
// ============================================================================

describe('Throttle State CRUD Operations', () => {
	describe('getThrottleState', () => {
		it('should return null for non-existent state', async () => {
			const result = await getThrottleState(testConnectorId);
			expect(result).toBeNull();
		});

		it('should return state after creation', async () => {
			await getOrCreateThrottleState(testConnectorId);
			const result = await getThrottleState(testConnectorId);

			expect(result).not.toBeNull();
			expect(result!.connectorId).toBe(testConnectorId);
			expect(result!.requestsThisMinute).toBe(0);
			expect(result!.requestsToday).toBe(0);
		});
	});

	describe('getOrCreateThrottleState', () => {
		it('should create state with zero counters', async () => {
			const result = await getOrCreateThrottleState(testConnectorId);

			expect(result.connectorId).toBe(testConnectorId);
			expect(result.requestsThisMinute).toBe(0);
			expect(result.requestsToday).toBe(0);
			expect(result.minuteWindowStart).toBeDefined();
			expect(result.dayWindowStart).toBeDefined();
			expect(result.pausedUntil).toBeNull();
		});

		it('should be idempotent', async () => {
			const first = await getOrCreateThrottleState(testConnectorId);
			const second = await getOrCreateThrottleState(testConnectorId);

			expect(first.id).toBe(second.id);
		});
	});

	describe('incrementRequestCounters', () => {
		it('should increment both counters atomically', async () => {
			await getOrCreateThrottleState(testConnectorId);

			const result1 = await incrementRequestCounters(testConnectorId);
			expect(result1.requestsThisMinute).toBe(1);
			expect(result1.requestsToday).toBe(1);

			const result2 = await incrementRequestCounters(testConnectorId);
			expect(result2.requestsThisMinute).toBe(2);
			expect(result2.requestsToday).toBe(2);
		});

		it('should create state if not exists', async () => {
			const result = await incrementRequestCounters(testConnectorId);

			expect(result.requestsThisMinute).toBe(1);
			expect(result.requestsToday).toBe(1);
		});

		it('should update lastRequestAt', async () => {
			const before = new Date();
			const result = await incrementRequestCounters(testConnectorId);

			expect(result.lastRequestAt).toBeDefined();
			expect(result.lastRequestAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
		});
	});

	describe('resetMinuteWindow', () => {
		it('should reset minute counter and update window start', async () => {
			await getOrCreateThrottleState(testConnectorId);
			await incrementRequestCounters(testConnectorId);
			await incrementRequestCounters(testConnectorId);

			await resetMinuteWindow(testConnectorId);

			const result = await getThrottleState(testConnectorId);
			expect(result!.requestsThisMinute).toBe(0);
			expect(result!.requestsToday).toBe(2); // Daily counter unchanged
		});
	});

	describe('resetDayWindow', () => {
		it('should reset daily counter and update window start', async () => {
			await getOrCreateThrottleState(testConnectorId);
			await incrementRequestCounters(testConnectorId);
			await incrementRequestCounters(testConnectorId);

			await resetDayWindow(testConnectorId);

			const result = await getThrottleState(testConnectorId);
			expect(result!.requestsToday).toBe(0);
			expect(result!.requestsThisMinute).toBe(2); // Minute counter unchanged
		});

		it('should clear daily_budget_exhausted pause', async () => {
			await getOrCreateThrottleState(testConnectorId);
			await setPausedUntil(
				testConnectorId,
				new Date(Date.now() + 60000),
				'daily_budget_exhausted'
			);

			await resetDayWindow(testConnectorId);

			const result = await getThrottleState(testConnectorId);
			expect(result!.pausedUntil).toBeNull();
			expect(result!.pauseReason).toBeNull();
		});

		it('should preserve other pause reasons', async () => {
			await getOrCreateThrottleState(testConnectorId);
			const pauseUntil = new Date(Date.now() + 60000);
			await setPausedUntil(testConnectorId, pauseUntil, 'rate_limit');

			await resetDayWindow(testConnectorId);

			const result = await getThrottleState(testConnectorId);
			expect(result!.pausedUntil).not.toBeNull();
			expect(result!.pauseReason).toBe('rate_limit');
		});
	});

	describe('setPausedUntil', () => {
		it('should set pause state', async () => {
			await getOrCreateThrottleState(testConnectorId);
			const pauseUntil = new Date(Date.now() + 60000);

			await setPausedUntil(testConnectorId, pauseUntil, 'rate_limit');

			const result = await getThrottleState(testConnectorId);
			expect(result!.pausedUntil).not.toBeNull();
			expect(result!.pauseReason).toBe('rate_limit');
		});

		it('should clear pause state when set to null', async () => {
			await getOrCreateThrottleState(testConnectorId);
			await setPausedUntil(testConnectorId, new Date(Date.now() + 60000), 'manual');
			await setPausedUntil(testConnectorId, null, null);

			const result = await getThrottleState(testConnectorId);
			expect(result!.pausedUntil).toBeNull();
			expect(result!.pauseReason).toBeNull();
		});
	});
});

// ============================================================================
// ThrottleEnforcer canDispatch Tests
// ============================================================================

describe('ThrottleEnforcer.canDispatch', () => {
	describe('Basic allow/deny', () => {
		it('should allow dispatch when under limits', async () => {
			const result = await throttleEnforcer.canDispatch(testConnectorId);

			expect(result.allowed).toBe(true);
			expect(result.reason).toBeUndefined();
		});

		it('should deny dispatch when paused', async () => {
			await getOrCreateThrottleState(testConnectorId);
			const pauseUntil = new Date(Date.now() + 60000);
			await setPausedUntil(testConnectorId, pauseUntil, 'rate_limit');

			const result = await throttleEnforcer.canDispatch(testConnectorId);

			expect(result.allowed).toBe(false);
			expect(result.reason).toBe('rate_limit');
			expect(result.retryAfterMs).toBeGreaterThan(0);
			expect(result.retryAfterMs).toBeLessThanOrEqual(60000);
		});
	});

	describe('Per-minute rate limit (Requirement 7.1)', () => {
		it('should deny dispatch when minute limit exceeded', async () => {
			// Default profile is Moderate with 5 requests/minute
			const state = await getOrCreateThrottleState(testConnectorId);

			// Manually set requests to limit
			await db
				.update(throttleState)
				.set({
					requestsThisMinute: MODERATE_PRESET.requestsPerMinute,
					minuteWindowStart: new Date() // Current window
				})
				.where(eq(throttleState.connectorId, testConnectorId));

			const result = await throttleEnforcer.canDispatch(testConnectorId);

			expect(result.allowed).toBe(false);
			expect(result.reason).toBe('rate_limit');
			expect(result.retryAfterMs).toBeDefined();
		});

		it('should allow dispatch when minute window has expired', async () => {
			await getOrCreateThrottleState(testConnectorId);

			// Set requests to limit with expired window
			const expiredWindow = new Date(Date.now() - 61000); // 61 seconds ago
			await db
				.update(throttleState)
				.set({
					requestsThisMinute: MODERATE_PRESET.requestsPerMinute,
					minuteWindowStart: expiredWindow
				})
				.where(eq(throttleState.connectorId, testConnectorId));

			const result = await throttleEnforcer.canDispatch(testConnectorId);

			// Should allow because window expired
			expect(result.allowed).toBe(true);
		});
	});

	describe('Daily budget (Requirements 7.1, 7.2)', () => {
		it('should deny dispatch when daily budget exhausted', async () => {
			// Create a profile with low daily budget for testing
			const profile = await createThrottleProfile({
				name: 'Test Low Budget',
				requestsPerMinute: 100,
				dailyBudget: 5,
				batchSize: 10,
				batchCooldownSeconds: 60,
				rateLimitPauseSeconds: 300
			});
			testThrottleProfileId = profile.id;

			await assignThrottleProfileToConnector(testConnectorId, profile.id);

			await getOrCreateThrottleState(testConnectorId);

			// Set daily requests to budget limit
			await db
				.update(throttleState)
				.set({
					requestsToday: 5,
					dayWindowStart: getStartOfDayUTC(new Date())
				})
				.where(eq(throttleState.connectorId, testConnectorId));

			const result = await throttleEnforcer.canDispatch(testConnectorId);

			expect(result.allowed).toBe(false);
			expect(result.reason).toBe('daily_budget_exhausted');
			expect(result.retryAfterMs).toBeDefined();
			expect(result.retryAfterMs!).toBeGreaterThan(0);
		});

		it('should allow dispatch with unlimited daily budget', async () => {
			// Aggressive preset has unlimited daily budget (null)
			const profile = await createThrottleProfile({
				name: 'Test Unlimited',
				requestsPerMinute: 100,
				dailyBudget: null, // Unlimited
				batchSize: 10,
				batchCooldownSeconds: 60,
				rateLimitPauseSeconds: 300
			});

			// Store for cleanup
			const tempProfileId = profile.id;

			try {
				await assignThrottleProfileToConnector(testConnectorId, profile.id);
				await getOrCreateThrottleState(testConnectorId);

				// Set high daily count
				await db
					.update(throttleState)
					.set({
						requestsToday: 10000,
						dayWindowStart: getStartOfDayUTC(new Date())
					})
					.where(eq(throttleState.connectorId, testConnectorId));

				const result = await throttleEnforcer.canDispatch(testConnectorId);

				// Should allow because budget is unlimited
				expect(result.allowed).toBe(true);
			} finally {
				await assignThrottleProfileToConnector(testConnectorId, null);
				await deleteThrottleProfile(tempProfileId);
			}
		});

		it('should set pausedUntil when daily budget exhausted', async () => {
			// Create a profile with low daily budget for testing
			const profile = await createThrottleProfile({
				name: 'Test Budget Pause',
				requestsPerMinute: 100,
				dailyBudget: 3,
				batchSize: 10,
				batchCooldownSeconds: 60,
				rateLimitPauseSeconds: 300
			});
			const tempProfileId = profile.id;

			try {
				await assignThrottleProfileToConnector(testConnectorId, profile.id);
				await getOrCreateThrottleState(testConnectorId);

				// Set daily requests to budget limit
				await db
					.update(throttleState)
					.set({
						requestsToday: 3,
						dayWindowStart: getStartOfDayUTC(new Date())
					})
					.where(eq(throttleState.connectorId, testConnectorId));

				await throttleEnforcer.canDispatch(testConnectorId);

				// Check that pausedUntil was set
				const state = await getThrottleState(testConnectorId);
				expect(state!.pausedUntil).not.toBeNull();
				expect(state!.pauseReason).toBe('daily_budget_exhausted');
			} finally {
				await assignThrottleProfileToConnector(testConnectorId, null);
				await deleteThrottleProfile(tempProfileId);
			}
		});
	});

	describe('Profile resolution (Requirement 7.7)', () => {
		it('should use default profile when no connector profile assigned', async () => {
			// Connector has no profile assigned, should use default/fallback
			const profile = await getThrottleProfileForConnector(testConnectorId);

			// Should be Moderate preset (default fallback)
			expect(profile.requestsPerMinute).toBe(MODERATE_PRESET.requestsPerMinute);
		});

		it('should use assigned profile when one exists', async () => {
			// Create a custom profile
			const profile = await createThrottleProfile({
				name: 'Test Custom Profile',
				requestsPerMinute: 2,
				dailyBudget: 50,
				batchSize: 5,
				batchCooldownSeconds: 120,
				rateLimitPauseSeconds: 600
			});
			const tempProfileId = profile.id;

			try {
				await assignThrottleProfileToConnector(testConnectorId, profile.id);

				const resolved = await getThrottleProfileForConnector(testConnectorId);

				expect(resolved.requestsPerMinute).toBe(2);
				expect(resolved.dailyBudget).toBe(50);
			} finally {
				await assignThrottleProfileToConnector(testConnectorId, null);
				await deleteThrottleProfile(tempProfileId);
			}
		});
	});
});

// ============================================================================
// ThrottleEnforcer recordRequest Tests
// ============================================================================

describe('ThrottleEnforcer.recordRequest', () => {
	it('should increment counters after recording', async () => {
		await throttleEnforcer.recordRequest(testConnectorId);

		const state = await getThrottleState(testConnectorId);
		expect(state!.requestsThisMinute).toBe(1);
		expect(state!.requestsToday).toBe(1);
	});

	it('should create state if not exists', async () => {
		await throttleEnforcer.recordRequest(testConnectorId);

		const state = await getThrottleState(testConnectorId);
		expect(state).not.toBeNull();
	});

	it('should increment multiple times correctly', async () => {
		await throttleEnforcer.recordRequest(testConnectorId);
		await throttleEnforcer.recordRequest(testConnectorId);
		await throttleEnforcer.recordRequest(testConnectorId);

		const state = await getThrottleState(testConnectorId);
		expect(state!.requestsThisMinute).toBe(3);
		expect(state!.requestsToday).toBe(3);
	});
});

// ============================================================================
// ThrottleEnforcer handleRateLimitResponse Tests
// ============================================================================

describe('ThrottleEnforcer.handleRateLimitResponse', () => {
	it('should set pause state with Retry-After', async () => {
		await getOrCreateThrottleState(testConnectorId);

		const retryAfter = 120; // 2 minutes
		await throttleEnforcer.handleRateLimitResponse(testConnectorId, retryAfter);

		const state = await getThrottleState(testConnectorId);
		expect(state!.pausedUntil).not.toBeNull();
		expect(state!.pauseReason).toBe('rate_limit');

		// Pause should be approximately 2 minutes from now
		const expectedPause = Date.now() + retryAfter * 1000;
		expect(Math.abs(state!.pausedUntil!.getTime() - expectedPause)).toBeLessThan(1000);
	});

	it('should use profile rateLimitPauseSeconds when no Retry-After', async () => {
		await getOrCreateThrottleState(testConnectorId);

		await throttleEnforcer.handleRateLimitResponse(testConnectorId);

		const state = await getThrottleState(testConnectorId);
		expect(state!.pausedUntil).not.toBeNull();

		// Should use Moderate preset's rateLimitPauseSeconds (300)
		const expectedPause = Date.now() + MODERATE_PRESET.rateLimitPauseSeconds * 1000;
		expect(Math.abs(state!.pausedUntil!.getTime() - expectedPause)).toBeLessThan(1000);
	});
});

// ============================================================================
// ThrottleEnforcer getAvailableCapacity Tests
// ============================================================================

describe('ThrottleEnforcer.getAvailableCapacity', () => {
	it('should return full capacity for new connector', async () => {
		const capacity = await throttleEnforcer.getAvailableCapacity(testConnectorId);

		// Should be Moderate preset's requestsPerMinute
		expect(capacity).toBe(MODERATE_PRESET.requestsPerMinute);
	});

	it('should return remaining capacity after requests', async () => {
		await throttleEnforcer.recordRequest(testConnectorId);
		await throttleEnforcer.recordRequest(testConnectorId);

		const capacity = await throttleEnforcer.getAvailableCapacity(testConnectorId);

		expect(capacity).toBe(MODERATE_PRESET.requestsPerMinute - 2);
	});

	it('should return 0 when at limit', async () => {
		await getOrCreateThrottleState(testConnectorId);

		// Set requests to limit
		await db
			.update(throttleState)
			.set({
				requestsThisMinute: MODERATE_PRESET.requestsPerMinute,
				minuteWindowStart: new Date()
			})
			.where(eq(throttleState.connectorId, testConnectorId));

		const capacity = await throttleEnforcer.getAvailableCapacity(testConnectorId);

		expect(capacity).toBe(0);
	});

	it('should return -1 when paused', async () => {
		await getOrCreateThrottleState(testConnectorId);
		await setPausedUntil(testConnectorId, new Date(Date.now() + 60000), 'rate_limit');

		const capacity = await throttleEnforcer.getAvailableCapacity(testConnectorId);

		expect(capacity).toBe(-1);
	});
});

// ============================================================================
// ThrottleEnforcer getStatus Tests
// ============================================================================

describe('ThrottleEnforcer.getStatus', () => {
	it('should return comprehensive status', async () => {
		await throttleEnforcer.recordRequest(testConnectorId);

		const status = await throttleEnforcer.getStatus(testConnectorId);

		expect(status.connectorId).toBe(testConnectorId);
		expect(status.requestsThisMinute).toBe(1);
		expect(status.requestsToday).toBe(1);
		expect(status.remainingThisMinute).toBe(MODERATE_PRESET.requestsPerMinute - 1);
		expect(status.isPaused).toBe(false);
		expect(status.profile).toBeDefined();
	});

	it('should reflect pause status', async () => {
		await getOrCreateThrottleState(testConnectorId);
		await setPausedUntil(testConnectorId, new Date(Date.now() + 60000), 'manual');

		const status = await throttleEnforcer.getStatus(testConnectorId);

		expect(status.isPaused).toBe(true);
		expect(status.pauseReason).toBe('manual');
		expect(status.pauseExpiresInMs).toBeGreaterThan(0);
	});
});

// ============================================================================
// ThrottleEnforcer resetExpiredWindows Tests
// ============================================================================

describe('ThrottleEnforcer.resetExpiredWindows', () => {
	it('should reset expired minute windows', async () => {
		await getOrCreateThrottleState(testConnectorId);

		// Set an expired minute window
		const expiredWindow = new Date(Date.now() - 120000); // 2 minutes ago
		await db
			.update(throttleState)
			.set({
				requestsThisMinute: 5,
				minuteWindowStart: expiredWindow
			})
			.where(eq(throttleState.connectorId, testConnectorId));

		const result = await throttleEnforcer.resetExpiredWindows();

		expect(result.minuteResets).toBeGreaterThanOrEqual(1);

		// Verify counter was reset
		const state = await getThrottleState(testConnectorId);
		expect(state!.requestsThisMinute).toBe(0);
	});

	it('should clear expired pauses', async () => {
		await getOrCreateThrottleState(testConnectorId);

		// Set an expired pause
		const expiredPause = new Date(Date.now() - 1000); // 1 second ago
		await setPausedUntil(testConnectorId, expiredPause, 'rate_limit');

		const result = await throttleEnforcer.resetExpiredWindows();

		expect(result.pausesCleared).toBeGreaterThanOrEqual(1);

		// Verify pause was cleared
		const state = await getThrottleState(testConnectorId);
		expect(state!.pausedUntil).toBeNull();
	});
});

// ============================================================================
// ThrottleEnforcer pauseDispatch/resumeDispatch Tests
// ============================================================================

describe('ThrottleEnforcer.pauseDispatch and resumeDispatch', () => {
	it('should pause dispatch for specified duration', async () => {
		await getOrCreateThrottleState(testConnectorId);

		await throttleEnforcer.pauseDispatch(testConnectorId, 60);

		const state = await getThrottleState(testConnectorId);
		expect(state!.pausedUntil).not.toBeNull();
		expect(state!.pauseReason).toBe('manual');

		// Verify canDispatch returns denied
		const result = await throttleEnforcer.canDispatch(testConnectorId);
		expect(result.allowed).toBe(false);
		expect(result.reason).toBe('manual');
	});

	it('should resume dispatch by clearing pause', async () => {
		await getOrCreateThrottleState(testConnectorId);
		await throttleEnforcer.pauseDispatch(testConnectorId, 3600);

		await throttleEnforcer.resumeDispatch(testConnectorId);

		const state = await getThrottleState(testConnectorId);
		expect(state!.pausedUntil).toBeNull();
		expect(state!.pauseReason).toBeNull();

		// Verify canDispatch returns allowed
		const result = await throttleEnforcer.canDispatch(testConnectorId);
		expect(result.allowed).toBe(true);
	});
});
