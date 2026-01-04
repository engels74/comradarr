/**
 * API Rate Limiting service module.
 *
 *
 * Provides rate limiting enforcement for external API access via API keys.
 */

export {
	ApiKeyRateLimiter,
	type ApiKeyRateLimitResult,
	apiKeyRateLimiter,
	type RateLimitStatus
} from './api-key-rate-limiter';
