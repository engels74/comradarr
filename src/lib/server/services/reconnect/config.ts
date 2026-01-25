export const RECONNECT_CONFIG = {
	BASE_DELAY_MS: 30_000, // 30 seconds
	MAX_DELAY_MS: 600_000, // 10 minutes
	MULTIPLIER: 2,
	JITTER: 0.25, // ±25%
	MAX_ATTEMPTS: 0 // 0 = infinite (capped delay)
} as const;

export type ReconnectConfig = typeof RECONNECT_CONFIG;
