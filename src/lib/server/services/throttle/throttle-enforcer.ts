// Rate limiting for search dispatch: per-minute limits, daily budget, pause handling
// Profile resolution: connector profile -> default profile -> Moderate preset

import {
	type EffectiveThrottleConfig,
	getThrottleProfileForConnector
} from '$lib/server/db/queries/throttle';
import {
	clearExpiredPauses,
	getOrCreateThrottleState,
	getThrottleState,
	incrementRequestCounters,
	isDayWindowExpired,
	isMinuteWindowExpired,
	msUntilMidnightUTC,
	msUntilMinuteWindowExpires,
	resetDayWindow,
	resetExpiredDayWindows,
	resetExpiredMinuteWindows,
	resetMinuteWindow,
	setPausedUntil,
	tryAcquireRequestSlot
} from '$lib/server/db/queries/throttle-state';

export type PauseReason = 'rate_limit' | 'daily_budget_exhausted' | 'manual';

export interface ThrottleResult {
	allowed: boolean;
	reason?: PauseReason;
	retryAfterMs?: number;
	slotAcquired?: boolean;
}

export interface WindowResetResult {
	minuteResets: number;
	dayResets: number;
	pausesCleared: number;
}

export interface ThrottleStatus {
	connectorId: number;
	profile: EffectiveThrottleConfig;
	requestsThisMinute: number;
	requestsToday: number;
	remainingThisMinute: number;
	remainingToday: number | null;
	isPaused: boolean;
	pauseReason: PauseReason | null;
	pauseExpiresInMs: number | null;
}

export class ThrottleEnforcer {
	// Check order: paused? -> daily budget -> atomic per-minute slot acquisition
	async canDispatch(connectorId: number): Promise<ThrottleResult> {
		const now = new Date();
		const state = await getOrCreateThrottleState(connectorId);
		const profile = await getThrottleProfileForConnector(connectorId);

		// Check 1: Is connector paused?
		if (state.pausedUntil && state.pausedUntil > now) {
			return {
				allowed: false,
				reason: (state.pauseReason as PauseReason) ?? 'manual',
				retryAfterMs: state.pausedUntil.getTime() - now.getTime()
			};
		}

		// Check 2: Daily budget (check before minute limit to avoid counting towards exhausted budget)
		let requestsToday = state.requestsToday;
		if (isDayWindowExpired(state.dayWindowStart, now)) {
			await resetDayWindow(connectorId);
			requestsToday = 0;
		}

		if (profile.dailyBudget !== null && requestsToday >= profile.dailyBudget) {
			const retryAfterMs = msUntilMidnightUTC(now);
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

		// Check 3: Per-minute limit with atomic slot acquisition
		// This prevents race conditions where multiple parallel requests pass the check
		let slotResult = await tryAcquireRequestSlot(connectorId, profile.requestsPerMinute);

		// If window expired, reset it and try again
		if (slotResult.windowExpired) {
			await resetMinuteWindow(connectorId);
			slotResult = await tryAcquireRequestSlot(connectorId, profile.requestsPerMinute);
		}

		if (slotResult.acquired) {
			return { allowed: true, slotAcquired: true };
		}

		// At per-minute limit
		const retryAfterMs = msUntilMinuteWindowExpires(state.minuteWindowStart, now);
		return {
			allowed: false,
			reason: 'rate_limit',
			retryAfterMs: Math.max(retryAfterMs, 1000)
		};
	}

	async recordRequest(connectorId: number): Promise<void> {
		await incrementRequestCounters(connectorId);
	}

	// Handle HTTP 429: uses Retry-After header or profile's rateLimitPauseSeconds
	async handleRateLimitResponse(connectorId: number, retryAfterSeconds?: number): Promise<void> {
		const profile = await getThrottleProfileForConnector(connectorId);
		const pauseSeconds = retryAfterSeconds ?? profile.rateLimitPauseSeconds;
		const now = new Date();
		const pauseUntil = new Date(now.getTime() + pauseSeconds * 1000);
		await setPausedUntil(connectorId, pauseUntil, 'rate_limit');
	}

	// Returns remaining requests (0 if at limit, -1 if paused)
	async getAvailableCapacity(connectorId: number): Promise<number> {
		const now = new Date();
		const state = await getThrottleState(connectorId);
		const profile = await getThrottleProfileForConnector(connectorId);

		if (!state) {
			return profile.requestsPerMinute;
		}

		if (state.pausedUntil && state.pausedUntil > now) {
			return -1;
		}

		if (isMinuteWindowExpired(state.minuteWindowStart, now)) {
			return profile.requestsPerMinute;
		}

		return Math.max(0, profile.requestsPerMinute - state.requestsThisMinute);
	}

	async getStatus(connectorId: number): Promise<ThrottleStatus> {
		const now = new Date();
		const state = await getOrCreateThrottleState(connectorId);
		const profile = await getThrottleProfileForConnector(connectorId);

		let requestsThisMinute = state.requestsThisMinute;
		if (isMinuteWindowExpired(state.minuteWindowStart, now)) {
			requestsThisMinute = 0;
		}

		let requestsToday = state.requestsToday;
		if (isDayWindowExpired(state.dayWindowStart, now)) {
			requestsToday = 0;
		}

		const isPaused = state.pausedUntil !== null && state.pausedUntil > now;
		const pauseExpiresInMs =
			isPaused && state.pausedUntil ? state.pausedUntil.getTime() - now.getTime() : null;

		return {
			connectorId,
			profile,
			requestsThisMinute,
			requestsToday,
			remainingThisMinute: Math.max(0, profile.requestsPerMinute - requestsThisMinute),
			remainingToday:
				profile.dailyBudget !== null ? Math.max(0, profile.dailyBudget - requestsToday) : null,
			isPaused,
			pauseReason: isPaused ? (state.pauseReason as PauseReason) : null,
			pauseExpiresInMs
		};
	}

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

	async pauseDispatch(connectorId: number, durationSeconds: number): Promise<void> {
		const pauseUntil = new Date(Date.now() + durationSeconds * 1000);
		await setPausedUntil(connectorId, pauseUntil, 'manual');
	}

	async resumeDispatch(connectorId: number): Promise<void> {
		await setPausedUntil(connectorId, null, null);
	}
}

export const throttleEnforcer = new ThrottleEnforcer();
