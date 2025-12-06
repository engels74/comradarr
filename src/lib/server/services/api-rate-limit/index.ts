/**
 * API Rate Limiting service module.
 *
 * Requirement: 34.5
 *
 * Provides rate limiting enforcement for external API access via API keys.
 */

export {
	ApiKeyRateLimiter,
	apiKeyRateLimiter,
	type ApiKeyRateLimitResult,
	type RateLimitStatus
} from './api-key-rate-limiter';
