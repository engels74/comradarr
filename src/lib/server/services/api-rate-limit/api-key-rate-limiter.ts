/**
 * ApiKeyRateLimiter service for external API rate limiting enforcement.
 *
 *
 * This service enforces rate limiting for external API requests:
 * - Checks if requests are allowed based on per-minute rate limits
 * - Tracks request counts per API key
 * - Provides rate limit status for response headers
 *
 * Unlike the connector ThrottleEnforcer, this service:
 * - Only enforces per-minute limits (no daily budget)
 * - Returns immediately (no pause states)
 * - Is designed for high-frequency, low-latency checks
 */

import {
	getOrCreateRateLimitState,
	getRateLimitState,
	incrementRequestCounter,
	isMinuteWindowExpired,
	msUntilMinuteWindowExpires,
	resetExpiredMinuteWindows,
	resetMinuteWindow
} from '$lib/server/db/queries/api-key-rate-limit';

// =============================================================================
// Types
// =============================================================================

/**
 * Result of a rate limit check.
 */
export interface ApiKeyRateLimitResult {
	/** Whether the request is allowed */
	allowed: boolean;
	/** Reason for denial (only set when allowed=false) */
	reason?: 'rate_limit';
	/** Milliseconds until rate limit resets (only set when allowed=false) */
	retryAfterMs?: number;
}

/**
 * Rate limit status for response headers.
 */
export interface RateLimitStatus {
	/** API key ID */
	apiKeyId: number;
	/** Configured rate limit per minute (null = unlimited) */
	limit: number | null;
	/** Requests remaining in current window */
	remaining: number | null;
	/** Seconds until window resets */
	resetInSeconds: number;
}

// =============================================================================
// ApiKeyRateLimiter Class
// =============================================================================

/**
 * ApiKeyRateLimiter service for rate limiting enforcement.
 *
 * Usage:
 * ```typescript
 * import { apiKeyRateLimiter } from '$lib/server/services/api-rate-limit';
 *
 * // Before processing a request
 * const result = await apiKeyRateLimiter.canMakeRequest(apiKeyId, rateLimitPerMinute);
 * if (!result.allowed) {
 *   // Return HTTP 429 with Retry-After header
 *   return new Response('Too Many Requests', {
 *     status: 429,
 *     headers: { 'Retry-After': String(Math.ceil(result.retryAfterMs! / 1000)) }
 *   });
 * }
 *
 * // After successful response
 * await apiKeyRateLimiter.recordRequest(apiKeyId);
 *
 * // Get status for response headers
 * const status = await apiKeyRateLimiter.getRateLimitStatus(apiKeyId, rateLimitPerMinute);
 * ```
 */
export class ApiKeyRateLimiter {
	/**
	 * Check if a request is allowed for an API key.
	 *
	 * Checks in order:
	 * 1. If rate limit is null (unlimited), allow immediately
	 * 2. Has minute window expired? If so, reset counter (implicitly allows)
	 * 3. Is per-minute rate limit exceeded?
	 *
	 * @param apiKeyId - API key ID to check
	 * @param rateLimitPerMinute - Configured rate limit (null = unlimited)
	 * @returns Rate limit result indicating if request is allowed
	 */
	async canMakeRequest(
		apiKeyId: number,
		rateLimitPerMinute: number | null
	): Promise<ApiKeyRateLimitResult> {
		// Unlimited - always allow
		if (rateLimitPerMinute === null) {
			return { allowed: true };
		}

		const now = new Date();

		// Get or create rate limit state
		const state = await getOrCreateRateLimitState(apiKeyId);

		// Check minute window - reset if expired
		let requestsThisMinute = state.requestsThisMinute;
		if (isMinuteWindowExpired(state.minuteWindowStart, now)) {
			await resetMinuteWindow(apiKeyId);
			requestsThisMinute = 0;
		}

		// Check per-minute rate limit
		if (requestsThisMinute >= rateLimitPerMinute) {
			const retryAfterMs = msUntilMinuteWindowExpires(state.minuteWindowStart, now);
			return {
				allowed: false,
				reason: 'rate_limit',
				retryAfterMs: Math.max(retryAfterMs, 1000) // At least 1 second
			};
		}

		// All checks passed
		return { allowed: true };
	}

	/**
	 * Record a successful request for an API key.
	 * Atomically increments the request counter.
	 *
	 * @param apiKeyId - API key ID
	 */
	async recordRequest(apiKeyId: number): Promise<void> {
		await incrementRequestCounter(apiKeyId);
	}

	/**
	 * Get rate limit status for response headers.
	 *
	 * @param apiKeyId - API key ID
	 * @param rateLimitPerMinute - Configured rate limit (null = unlimited)
	 * @returns Rate limit status for headers
	 */
	async getRateLimitStatus(
		apiKeyId: number,
		rateLimitPerMinute: number | null
	): Promise<RateLimitStatus> {
		const now = new Date();
		const state = await getRateLimitState(apiKeyId);

		// Calculate current request count (accounting for expired window)
		let requestsThisMinute = 0;
		let resetInSeconds = 60; // Default to 60 seconds

		if (state) {
			if (isMinuteWindowExpired(state.minuteWindowStart, now)) {
				requestsThisMinute = 0;
				resetInSeconds = 60;
			} else {
				requestsThisMinute = state.requestsThisMinute;
				resetInSeconds = Math.ceil(msUntilMinuteWindowExpires(state.minuteWindowStart, now) / 1000);
			}
		}

		// Calculate remaining requests
		const remaining =
			rateLimitPerMinute !== null ? Math.max(0, rateLimitPerMinute - requestsThisMinute) : null;

		return {
			apiKeyId,
			limit: rateLimitPerMinute,
			remaining,
			resetInSeconds
		};
	}

	/**
	 * Reset expired minute windows for all API keys.
	 * Should be called periodically by scheduler for cleanup.
	 *
	 * @returns Number of API keys reset
	 */
	async resetExpiredWindows(): Promise<number> {
		return resetExpiredMinuteWindows();
	}
}

// =============================================================================
// Singleton Export
// =============================================================================

/**
 * Singleton instance of the API key rate limiter.
 */
export const apiKeyRateLimiter = new ApiKeyRateLimiter();
