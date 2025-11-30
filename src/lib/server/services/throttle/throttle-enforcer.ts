/**
 * ThrottleEnforcer service for rate limiting enforcement.
 *
 * Requirements: 7.1, 7.2, 7.7
 *
 * This service enforces rate limiting during search dispatch operations:
 * - Checks if dispatches are allowed based on per-minute rate limits
 * - Tracks daily budget usage and pauses when exhausted
 * - Handles pause states from rate limit responses (HTTP 429)
 * - Atomically tracks request counts
 *
 * Profile resolution follows: connector profile → default profile → Moderate preset
 */

import {
	getOrCreateThrottleState,
	getThrottleState,
	incrementRequestCounters,
	resetMinuteWindow,
	resetDayWindow,
	setPausedUntil,
	isMinuteWindowExpired,
	isDayWindowExpired,
	msUntilMinuteWindowExpires,
	msUntilMidnightUTC,
	resetExpiredMinuteWindows,
	resetExpiredDayWindows,
	clearExpiredPauses
} from '$lib/server/db/queries/throttle-state';
import {
	getThrottleProfileForConnector,
	type EffectiveThrottleConfig
} from '$lib/server/db/queries/throttle';

// =============================================================================
// Types
// =============================================================================

/**
 * Pause reason types for throttle state.
 */
export type PauseReason = 'rate_limit' | 'daily_budget_exhausted' | 'manual';

/**
 * Result of a throttle check.
 */
export interface ThrottleResult {
	/** Whether the dispatch is allowed */
	allowed: boolean;
	/** Reason for denial (if not allowed) */
	reason?: PauseReason;
	/** Milliseconds until retry is allowed (if not allowed) */
	retryAfterMs?: number;
}

/**
 * Result of window reset operations.
 */
export interface WindowResetResult {
	/** Number of connectors with minute windows reset */
	minuteResets: number;
	/** Number of connectors with day windows reset */
	dayResets: number;
	/** Number of expired pauses cleared */
	pausesCleared: number;
}

/**
 * Current throttle state summary for a connector.
 */
export interface ThrottleStatus {
	connectorId: number;
	/** Effective throttle profile in use */
	profile: EffectiveThrottleConfig;
	/** Requests made in current minute window */
	requestsThisMinute: number;
	/** Requests made today */
	requestsToday: number;
	/** Remaining requests in current minute (0 if at limit) */
	remainingThisMinute: number;
	/** Remaining daily budget (null if unlimited) */
	remainingToday: number | null;
	/** Whether currently paused */
	isPaused: boolean;
	/** Pause reason if paused */
	pauseReason: PauseReason | null;
	/** Milliseconds until pause expires (if paused) */
	pauseExpiresInMs: number | null;
}

// =============================================================================
// ThrottleEnforcer Class
// =============================================================================

/**
 * ThrottleEnforcer service for rate limiting enforcement.
 *
 * Usage:
 * ```typescript
 * import { throttleEnforcer } from '$lib/server/services/throttle';
 *
 * // Before dispatching a request
 * const result = await throttleEnforcer.canDispatch(connectorId);
 * if (!result.allowed) {
 *   // Handle rate limit - retry after result.retryAfterMs
 *   return;
 * }
 *
 * // After successful dispatch
 * await throttleEnforcer.recordRequest(connectorId);
 * ```
 */
export class ThrottleEnforcer {
	/**
	 * Check if dispatch is allowed for a connector.
	 *
	 * Checks in order:
	 * 1. Is connector paused (pausedUntil > now)?
	 * 2. Has minute window expired? If so, reset counter.
	 * 3. Is per-minute rate limit exceeded?
	 * 4. Has day window expired? If so, reset counter.
	 * 5. Is daily budget exceeded?
	 *
	 * @param connectorId - Connector ID to check
	 * @returns Throttle result indicating if dispatch is allowed
	 */
	async canDispatch(connectorId: number): Promise<ThrottleResult> {
		const now = new Date();

		// Get or create throttle state
		const state = await getOrCreateThrottleState(connectorId);

		// Get effective throttle profile for this connector
		const profile = await getThrottleProfileForConnector(connectorId);

		// 1. Check if paused
		if (state.pausedUntil && state.pausedUntil > now) {
			return {
				allowed: false,
				reason: (state.pauseReason as PauseReason) ?? 'manual',
				retryAfterMs: state.pausedUntil.getTime() - now.getTime()
			};
		}

		// 2. Check minute window - reset if expired
		let requestsThisMinute = state.requestsThisMinute;
		if (isMinuteWindowExpired(state.minuteWindowStart, now)) {
			await resetMinuteWindow(connectorId);
			requestsThisMinute = 0;
		}

		// 3. Check per-minute rate limit
		if (requestsThisMinute >= profile.requestsPerMinute) {
			const retryAfterMs = msUntilMinuteWindowExpires(state.minuteWindowStart, now);
			return {
				allowed: false,
				reason: 'rate_limit',
				retryAfterMs: Math.max(retryAfterMs, 1000) // At least 1 second
			};
		}

		// 4. Check day window - reset if expired (new UTC day)
		let requestsToday = state.requestsToday;
		if (isDayWindowExpired(state.dayWindowStart, now)) {
			await resetDayWindow(connectorId);
			requestsToday = 0;
		}

		// 5. Check daily budget (null = unlimited)
		if (profile.dailyBudget !== null && requestsToday >= profile.dailyBudget) {
			const retryAfterMs = msUntilMidnightUTC(now);

			// Set paused state for daily budget exhaustion
			const tomorrow = new Date(now);
			tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
			tomorrow.setUTCHours(0, 0, 0, 0);
			await setPausedUntil(connectorId, tomorrow, 'daily_budget_exhausted');

			return {
				allowed: false,
				reason: 'daily_budget_exhausted',
				retryAfterMs
			};
		}

		// All checks passed
		return { allowed: true };
	}

	/**
	 * Record a successful request dispatch.
	 * Atomically increments both minute and daily counters.
	 * Creates throttle state if it doesn't exist.
	 *
	 * @param connectorId - Connector ID
	 */
	async recordRequest(connectorId: number): Promise<void> {
		await incrementRequestCounters(connectorId);
	}

	/**
	 * Handle an HTTP 429 rate limit response from an *arr API.
	 * Sets pausedUntil based on Retry-After header or profile's rateLimitPauseSeconds.
	 *
	 * @param connectorId - Connector ID
	 * @param retryAfterSeconds - Optional Retry-After header value in seconds
	 */
	async handleRateLimitResponse(
		connectorId: number,
		retryAfterSeconds?: number
	): Promise<void> {
		const profile = await getThrottleProfileForConnector(connectorId);

		// Use Retry-After if provided, otherwise use profile's rateLimitPauseSeconds
		const pauseSeconds = retryAfterSeconds ?? profile.rateLimitPauseSeconds;

		const now = new Date();
		const pauseUntil = new Date(now.getTime() + pauseSeconds * 1000);

		await setPausedUntil(connectorId, pauseUntil, 'rate_limit');
	}

	/**
	 * Get available capacity (requests remaining) in current minute window.
	 *
	 * @param connectorId - Connector ID
	 * @returns Number of requests remaining (0 if at limit, -1 if paused)
	 */
	async getAvailableCapacity(connectorId: number): Promise<number> {
		const now = new Date();
		const state = await getThrottleState(connectorId);
		const profile = await getThrottleProfileForConnector(connectorId);

		// If no state, full capacity available
		if (!state) {
			return profile.requestsPerMinute;
		}

		// If paused, no capacity
		if (state.pausedUntil && state.pausedUntil > now) {
			return -1;
		}

		// If minute window expired, full capacity
		if (isMinuteWindowExpired(state.minuteWindowStart, now)) {
			return profile.requestsPerMinute;
		}

		// Calculate remaining capacity
		return Math.max(0, profile.requestsPerMinute - state.requestsThisMinute);
	}

	/**
	 * Get detailed throttle status for a connector.
	 *
	 * @param connectorId - Connector ID
	 * @returns Detailed throttle status
	 */
	async getStatus(connectorId: number): Promise<ThrottleStatus> {
		const now = new Date();
		const state = await getOrCreateThrottleState(connectorId);
		const profile = await getThrottleProfileForConnector(connectorId);

		// Calculate current counts (accounting for expired windows)
		let requestsThisMinute = state.requestsThisMinute;
		if (isMinuteWindowExpired(state.minuteWindowStart, now)) {
			requestsThisMinute = 0;
		}

		let requestsToday = state.requestsToday;
		if (isDayWindowExpired(state.dayWindowStart, now)) {
			requestsToday = 0;
		}

		// Check pause state
		const isPaused = state.pausedUntil !== null && state.pausedUntil > now;
		const pauseExpiresInMs = isPaused && state.pausedUntil
			? state.pausedUntil.getTime() - now.getTime()
			: null;

		return {
			connectorId,
			profile,
			requestsThisMinute,
			requestsToday,
			remainingThisMinute: Math.max(0, profile.requestsPerMinute - requestsThisMinute),
			remainingToday: profile.dailyBudget !== null
				? Math.max(0, profile.dailyBudget - requestsToday)
				: null,
			isPaused,
			pauseReason: isPaused ? (state.pauseReason as PauseReason) : null,
			pauseExpiresInMs
		};
	}

	/**
	 * Reset expired windows for all connectors.
	 * Can be called periodically by a scheduled job.
	 *
	 * This resets:
	 * - Minute windows that have expired (> 60 seconds old)
	 * - Day windows that have expired (new UTC day)
	 * - Pause states that have expired
	 *
	 * @returns Count of resets performed
	 */
	async resetExpiredWindows(): Promise<WindowResetResult> {
		const [minuteResets, dayResets, pausesCleared] = await Promise.all([
			resetExpiredMinuteWindows(),
			resetExpiredDayWindows(),
			clearExpiredPauses()
		]);

		return {
			minuteResets,
			dayResets,
			pausesCleared
		};
	}

	/**
	 * Manually pause dispatch for a connector.
	 *
	 * @param connectorId - Connector ID
	 * @param durationSeconds - Duration of pause in seconds
	 */
	async pauseDispatch(connectorId: number, durationSeconds: number): Promise<void> {
		const pauseUntil = new Date(Date.now() + durationSeconds * 1000);
		await setPausedUntil(connectorId, pauseUntil, 'manual');
	}

	/**
	 * Resume dispatch for a connector by clearing the pause state.
	 *
	 * @param connectorId - Connector ID
	 */
	async resumeDispatch(connectorId: number): Promise<void> {
		await setPausedUntil(connectorId, null, null);
	}
}

// Export singleton instance
export const throttleEnforcer = new ThrottleEnforcer();
