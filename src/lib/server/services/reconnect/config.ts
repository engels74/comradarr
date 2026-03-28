export const RECONNECT_CONFIG = {
	BASE_DELAY_MS: 30_000, // 30 seconds
	MAX_DELAY_MS: 600_000, // 10 minutes
	MULTIPLIER: 2,
	JITTER: 0.25 // ±25%
} as const;
