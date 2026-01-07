// Per-minute rate limiting for external API keys (no daily budget, no pause states)

import {
	getOrCreateRateLimitState,
	getRateLimitState,
	incrementRequestCounter,
	isMinuteWindowExpired,
	msUntilMinuteWindowExpires,
	resetExpiredMinuteWindows,
	resetMinuteWindow
} from '$lib/server/db/queries/api-key-rate-limit';

export interface ApiKeyRateLimitResult {
	allowed: boolean;
	reason?: 'rate_limit';
	retryAfterMs?: number;
}

export interface RateLimitStatus {
	apiKeyId: number;
	limit: number | null;
	remaining: number | null;
	resetInSeconds: number;
}

export class ApiKeyRateLimiter {
	// null rateLimitPerMinute = unlimited
	async canMakeRequest(
		apiKeyId: number,
		rateLimitPerMinute: number | null
	): Promise<ApiKeyRateLimitResult> {
		if (rateLimitPerMinute === null) {
			return { allowed: true };
		}

		const now = new Date();
		const state = await getOrCreateRateLimitState(apiKeyId);

		let requestsThisMinute = state.requestsThisMinute;
		if (isMinuteWindowExpired(state.minuteWindowStart, now)) {
			await resetMinuteWindow(apiKeyId);
			requestsThisMinute = 0;
		}

		if (requestsThisMinute >= rateLimitPerMinute) {
			const retryAfterMs = msUntilMinuteWindowExpires(state.minuteWindowStart, now);
			return {
				allowed: false,
				reason: 'rate_limit',
				retryAfterMs: Math.max(retryAfterMs, 1000)
			};
		}

		return { allowed: true };
	}

	async recordRequest(apiKeyId: number): Promise<void> {
		await incrementRequestCounter(apiKeyId);
	}

	async getRateLimitStatus(
		apiKeyId: number,
		rateLimitPerMinute: number | null
	): Promise<RateLimitStatus> {
		const now = new Date();
		const state = await getRateLimitState(apiKeyId);

		let requestsThisMinute = 0;
		let resetInSeconds = 60;

		if (state) {
			if (isMinuteWindowExpired(state.minuteWindowStart, now)) {
				requestsThisMinute = 0;
				resetInSeconds = 60;
			} else {
				requestsThisMinute = state.requestsThisMinute;
				resetInSeconds = Math.ceil(msUntilMinuteWindowExpires(state.minuteWindowStart, now) / 1000);
			}
		}

		const remaining =
			rateLimitPerMinute !== null ? Math.max(0, rateLimitPerMinute - requestsThisMinute) : null;

		return {
			apiKeyId,
			limit: rateLimitPerMinute,
			remaining,
			resetInSeconds
		};
	}

	async resetExpiredWindows(): Promise<number> {
		return resetExpiredMinuteWindows();
	}
}

export const apiKeyRateLimiter = new ApiKeyRateLimiter();
