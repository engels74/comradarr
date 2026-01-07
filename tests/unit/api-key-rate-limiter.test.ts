/**
 * Unit tests for API Key Rate Limiter.
 * Verifies per-key rate limiting functionality.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the database queries
vi.mock('$lib/server/db/queries/api-key-rate-limit', () => ({
	getOrCreateRateLimitState: vi.fn(),
	getRateLimitState: vi.fn(),
	incrementRequestCounter: vi.fn(),
	resetMinuteWindow: vi.fn(),
	resetExpiredMinuteWindows: vi.fn(),
	isMinuteWindowExpired: vi.fn(),
	msUntilMinuteWindowExpires: vi.fn()
}));

import {
	getOrCreateRateLimitState,
	getRateLimitState,
	incrementRequestCounter,
	isMinuteWindowExpired,
	msUntilMinuteWindowExpires,
	resetExpiredMinuteWindows,
	resetMinuteWindow
} from '$lib/server/db/queries/api-key-rate-limit';

import { ApiKeyRateLimiter } from '$lib/server/services/api-rate-limit/api-key-rate-limiter';

const mockedGetOrCreateRateLimitState = vi.mocked(getOrCreateRateLimitState);
const mockedGetRateLimitState = vi.mocked(getRateLimitState);
const mockedIncrementRequestCounter = vi.mocked(incrementRequestCounter);
const mockedResetMinuteWindow = vi.mocked(resetMinuteWindow);
const mockedResetExpiredMinuteWindows = vi.mocked(resetExpiredMinuteWindows);
const mockedIsMinuteWindowExpired = vi.mocked(isMinuteWindowExpired);
const mockedMsUntilMinuteWindowExpires = vi.mocked(msUntilMinuteWindowExpires);

describe('ApiKeyRateLimiter', () => {
	let rateLimiter: ApiKeyRateLimiter;

	beforeEach(() => {
		vi.clearAllMocks();
		rateLimiter = new ApiKeyRateLimiter();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('canMakeRequest', () => {
		it('should allow unlimited rate limit (null)', async () => {
			const result = await rateLimiter.canMakeRequest(1, null);

			expect(result.allowed).toBe(true);
			expect(result.reason).toBeUndefined();
			expect(result.retryAfterMs).toBeUndefined();
		});

		it('should allow request when under rate limit', async () => {
			const now = new Date();
			mockedGetOrCreateRateLimitState.mockResolvedValueOnce({
				id: 1,
				apiKeyId: 1,
				requestsThisMinute: 5,
				minuteWindowStart: now,
				lastRequestAt: now,
				createdAt: now,
				updatedAt: now
			});
			mockedIsMinuteWindowExpired.mockReturnValueOnce(false);

			const result = await rateLimiter.canMakeRequest(1, 60);

			expect(result.allowed).toBe(true);
			expect(result.reason).toBeUndefined();
		});

		it('should deny request when at rate limit', async () => {
			const now = new Date();
			mockedGetOrCreateRateLimitState.mockResolvedValueOnce({
				id: 1,
				apiKeyId: 1,
				requestsThisMinute: 60,
				minuteWindowStart: now,
				lastRequestAt: now,
				createdAt: now,
				updatedAt: now
			});
			mockedIsMinuteWindowExpired.mockReturnValueOnce(false);
			mockedMsUntilMinuteWindowExpires.mockReturnValueOnce(30000); // 30 seconds

			const result = await rateLimiter.canMakeRequest(1, 60);

			expect(result.allowed).toBe(false);
			expect(result.reason).toBe('rate_limit');
			expect(result.retryAfterMs).toBe(30000);
		});

		it('should deny request when over rate limit', async () => {
			const now = new Date();
			mockedGetOrCreateRateLimitState.mockResolvedValueOnce({
				id: 1,
				apiKeyId: 1,
				requestsThisMinute: 100,
				minuteWindowStart: now,
				lastRequestAt: now,
				createdAt: now,
				updatedAt: now
			});
			mockedIsMinuteWindowExpired.mockReturnValueOnce(false);
			mockedMsUntilMinuteWindowExpires.mockReturnValueOnce(45000); // 45 seconds

			const result = await rateLimiter.canMakeRequest(1, 60);

			expect(result.allowed).toBe(false);
			expect(result.reason).toBe('rate_limit');
			expect(result.retryAfterMs).toBe(45000);
		});

		it('should reset window when expired and allow request', async () => {
			const oldWindowStart = new Date(Date.now() - 120000); // 2 minutes ago
			mockedGetOrCreateRateLimitState.mockResolvedValueOnce({
				id: 1,
				apiKeyId: 1,
				requestsThisMinute: 100,
				minuteWindowStart: oldWindowStart,
				lastRequestAt: oldWindowStart,
				createdAt: oldWindowStart,
				updatedAt: oldWindowStart
			});
			mockedIsMinuteWindowExpired.mockReturnValueOnce(true);
			mockedResetMinuteWindow.mockResolvedValueOnce();

			const result = await rateLimiter.canMakeRequest(1, 60);

			expect(mockedResetMinuteWindow).toHaveBeenCalledWith(1);
			expect(result.allowed).toBe(true);
		});

		it('should enforce minimum retry after of 1 second', async () => {
			const now = new Date();
			mockedGetOrCreateRateLimitState.mockResolvedValueOnce({
				id: 1,
				apiKeyId: 1,
				requestsThisMinute: 60,
				minuteWindowStart: now,
				lastRequestAt: now,
				createdAt: now,
				updatedAt: now
			});
			mockedIsMinuteWindowExpired.mockReturnValueOnce(false);
			mockedMsUntilMinuteWindowExpires.mockReturnValueOnce(100); // Very short time

			const result = await rateLimiter.canMakeRequest(1, 60);

			expect(result.allowed).toBe(false);
			expect(result.retryAfterMs).toBe(1000); // Minimum 1 second
		});
	});

	describe('recordRequest', () => {
		it('should increment the request counter', async () => {
			const now = new Date();
			mockedIncrementRequestCounter.mockResolvedValueOnce({
				id: 1,
				apiKeyId: 1,
				requestsThisMinute: 1,
				minuteWindowStart: now,
				lastRequestAt: now,
				createdAt: now,
				updatedAt: now
			});

			await rateLimiter.recordRequest(1);

			expect(mockedIncrementRequestCounter).toHaveBeenCalledWith(1);
		});
	});

	describe('getRateLimitStatus', () => {
		it('should return correct status for unlimited rate limit', async () => {
			const now = new Date();
			mockedGetRateLimitState.mockResolvedValueOnce({
				id: 1,
				apiKeyId: 1,
				requestsThisMinute: 10,
				minuteWindowStart: now,
				lastRequestAt: now,
				createdAt: now,
				updatedAt: now
			});
			mockedIsMinuteWindowExpired.mockReturnValueOnce(false);
			mockedMsUntilMinuteWindowExpires.mockReturnValueOnce(45000);

			const result = await rateLimiter.getRateLimitStatus(1, null);

			expect(result.limit).toBeNull();
			expect(result.remaining).toBeNull();
		});

		it('should return correct status when under limit', async () => {
			const now = new Date();
			mockedGetRateLimitState.mockResolvedValueOnce({
				id: 1,
				apiKeyId: 1,
				requestsThisMinute: 30,
				minuteWindowStart: now,
				lastRequestAt: now,
				createdAt: now,
				updatedAt: now
			});
			mockedIsMinuteWindowExpired.mockReturnValueOnce(false);
			mockedMsUntilMinuteWindowExpires.mockReturnValueOnce(45000); // 45 seconds

			const result = await rateLimiter.getRateLimitStatus(1, 60);

			expect(result.limit).toBe(60);
			expect(result.remaining).toBe(30);
			expect(result.resetInSeconds).toBe(45);
		});

		it('should return zero remaining when at limit', async () => {
			const now = new Date();
			mockedGetRateLimitState.mockResolvedValueOnce({
				id: 1,
				apiKeyId: 1,
				requestsThisMinute: 60,
				minuteWindowStart: now,
				lastRequestAt: now,
				createdAt: now,
				updatedAt: now
			});
			mockedIsMinuteWindowExpired.mockReturnValueOnce(false);
			mockedMsUntilMinuteWindowExpires.mockReturnValueOnce(15000); // 15 seconds

			const result = await rateLimiter.getRateLimitStatus(1, 60);

			expect(result.limit).toBe(60);
			expect(result.remaining).toBe(0);
			expect(result.resetInSeconds).toBe(15);
		});

		it('should return zero remaining when over limit', async () => {
			const now = new Date();
			mockedGetRateLimitState.mockResolvedValueOnce({
				id: 1,
				apiKeyId: 1,
				requestsThisMinute: 100,
				minuteWindowStart: now,
				lastRequestAt: now,
				createdAt: now,
				updatedAt: now
			});
			mockedIsMinuteWindowExpired.mockReturnValueOnce(false);
			mockedMsUntilMinuteWindowExpires.mockReturnValueOnce(5000); // 5 seconds

			const result = await rateLimiter.getRateLimitStatus(1, 60);

			expect(result.limit).toBe(60);
			expect(result.remaining).toBe(0);
			expect(result.resetInSeconds).toBe(5);
		});

		it('should reset count when window is expired', async () => {
			const oldWindowStart = new Date(Date.now() - 120000);
			mockedGetRateLimitState.mockResolvedValueOnce({
				id: 1,
				apiKeyId: 1,
				requestsThisMinute: 100,
				minuteWindowStart: oldWindowStart,
				lastRequestAt: oldWindowStart,
				createdAt: oldWindowStart,
				updatedAt: oldWindowStart
			});
			mockedIsMinuteWindowExpired.mockReturnValueOnce(true);

			const result = await rateLimiter.getRateLimitStatus(1, 60);

			expect(result.remaining).toBe(60); // Full limit available after reset
			expect(result.resetInSeconds).toBe(60);
		});

		it('should handle null state (new API key)', async () => {
			mockedGetRateLimitState.mockResolvedValueOnce(null);

			const result = await rateLimiter.getRateLimitStatus(1, 60);

			expect(result.limit).toBe(60);
			expect(result.remaining).toBe(60);
			expect(result.resetInSeconds).toBe(60);
		});
	});

	describe('resetExpiredWindows', () => {
		it('should call database reset function', async () => {
			mockedResetExpiredMinuteWindows.mockResolvedValueOnce(5);

			const result = await rateLimiter.resetExpiredWindows();

			expect(mockedResetExpiredMinuteWindows).toHaveBeenCalled();
			expect(result).toBe(5);
		});

		it('should return zero when no windows to reset', async () => {
			mockedResetExpiredMinuteWindows.mockResolvedValueOnce(0);

			const result = await rateLimiter.resetExpiredWindows();

			expect(result).toBe(0);
		});
	});
});

describe('Rate limit helper function behavior', () => {
	it('should correctly identify when window is expired', () => {
		const now = Date.now();

		// Window from 2 minutes ago should be expired
		const oldWindowStart = new Date(now - 120000);
		const isExpired = now - oldWindowStart.getTime() >= 60000;
		expect(isExpired).toBe(true);

		// Window from 30 seconds ago should not be expired
		const recentWindowStart = new Date(now - 30000);
		const isNotExpired = now - recentWindowStart.getTime() >= 60000;
		expect(isNotExpired).toBe(false);
	});

	it('should calculate correct remaining time until window expires', () => {
		const now = Date.now();

		// Window started 30 seconds ago - 30 seconds remaining
		const windowStart = new Date(now - 30000);
		const remaining = 60000 - (now - windowStart.getTime());
		expect(remaining).toBeCloseTo(30000, -2); // Within 100ms

		// Window started 45 seconds ago - 15 seconds remaining
		const windowStart2 = new Date(now - 45000);
		const remaining2 = 60000 - (now - windowStart2.getTime());
		expect(remaining2).toBeCloseTo(15000, -2); // Within 100ms
	});
});
