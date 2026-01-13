import type { Handle } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { getClientIP, isLocalNetworkIP, validateSession } from '$lib/server/auth';
import { type RequestContext, runWithContext } from '$lib/server/context';
import { db } from '$lib/server/db';
import { logApiKeyUsage, validateApiKey } from '$lib/server/db/queries/api-keys';
import { getSecuritySettings } from '$lib/server/db/queries/settings';
import { users } from '$lib/server/db/schema';
import { initializeLogLevel } from '$lib/server/logger';
import { initializeScheduler } from '$lib/server/scheduler';
import { apiKeyRateLimiter } from '$lib/server/services/api-rate-limit';

/** Cookie name for session token */
const SESSION_COOKIE_NAME = 'session';

// =============================================================================
// Application Initialization
// =============================================================================

/**
 * Initialize application on server startup.
 * Only runs in non-test environments to avoid interference with tests.
 */
if (process.env.NODE_ENV !== 'test') {
	// Log level persists across restarts via database
	initializeLogLevel().catch(() => {
		// Silently handle errors - logger will fall back to env/default
	});

	// Scheduler is idempotent (safe to call multiple times)
	initializeScheduler();
}

export const handle: Handle = async ({ event, resolve }) => {
	const startTime = Date.now();

	// Use existing correlation ID from header or generate new one
	const correlationId = event.request.headers.get('x-correlation-id') ?? crypto.randomUUID();
	event.locals.correlationId = correlationId;

	// Check X-API-Key header before session validation
	const apiKey = event.request.headers.get('x-api-key');
	if (apiKey) {
		let apiKeyResult: Awaited<ReturnType<typeof validateApiKey>> | null = null;
		let apiKeyUser: {
			id: number;
			username: string;
			displayName: string | null;
			role: string;
		} | null = null;

		// Step 1: Validate API key and fetch user (auth errors fail gracefully)
		try {
			apiKeyResult = await validateApiKey(apiKey);
			if (apiKeyResult) {
				const userResult = await db
					.select({
						id: users.id,
						username: users.username,
						displayName: users.displayName,
						role: users.role
					})
					.from(users)
					.where(eq(users.id, apiKeyResult.userId))
					.limit(1);
				apiKeyUser = userResult[0] ?? null;
			}
		} catch {
			// Database error during API key/user validation - continue without API key auth
			// Session validation or local bypass will handle authentication
		}

		// Step 2: Check rate limit (rate limiter errors fail closed for security)
		if (apiKeyResult && apiKeyUser) {
			try {
				const rateLimitResult = await apiKeyRateLimiter.canMakeRequest(
					apiKeyResult.keyId,
					apiKeyResult.rateLimitPerMinute
				);

				if (!rateLimitResult.allowed) {
					const retryAfterSeconds = Math.ceil(rateLimitResult.retryAfterMs! / 1000);
					const rateLimitStatus = await apiKeyRateLimiter.getRateLimitStatus(
						apiKeyResult.keyId,
						apiKeyResult.rateLimitPerMinute
					);

					return json(
						{
							error: 'Too Many Requests',
							message: 'Rate limit exceeded. Please try again later.',
							retryAfter: retryAfterSeconds
						},
						{
							status: 429,
							headers: {
								'Retry-After': String(retryAfterSeconds),
								'X-RateLimit-Limit': String(rateLimitStatus.limit ?? 'unlimited'),
								'X-RateLimit-Remaining': String(rateLimitStatus.remaining ?? 'unlimited'),
								'X-RateLimit-Reset': String(rateLimitStatus.resetInSeconds),
								'X-Correlation-ID': correlationId
							}
						}
					);
				}

				// Rate limit passed - set up API key auth context
				event.locals.user = apiKeyUser;
				event.locals.isApiKey = true;
				event.locals.apiKeyScope = apiKeyResult.scope;
				event.locals.apiKeyId = apiKeyResult.keyId;
				event.locals.apiKeyRateLimitPerMinute = apiKeyResult.rateLimitPerMinute;
			} catch {
				// Rate limiter error - fail closed by rejecting the request
				return json(
					{
						error: 'Service Unavailable',
						message: 'Rate limiting service temporarily unavailable. Please try again.'
					},
					{
						status: 503,
						headers: {
							'Retry-After': '5',
							'X-Correlation-ID': correlationId
						}
					}
				);
			}
		}
	}

	// Only check session if not already authenticated via API key
	if (!event.locals.user) {
		const sessionId = event.cookies.get(SESSION_COOKIE_NAME);
		if (sessionId) {
			try {
				event.locals.user = await validateSession(sessionId);
				if (event.locals.user) {
					event.locals.sessionId = sessionId;
				}
			} catch {
				// Database error during session validation - treat as unauthenticated
				// but preserve the cookie so the session works when the DB recovers
				event.locals.user = null;
			}
		} else {
			event.locals.user = null;
		}
	}

	// Only check local network bypass if no valid session exists
	if (!event.locals.user) {
		try {
			const securitySettings = await getSecuritySettings();
			if (securitySettings.authMode === 'local_bypass') {
				const clientIP = getClientIP(event.request, event.getClientAddress);
				if (isLocalNetworkIP(clientIP)) {
					event.locals.isLocalBypass = true;
					// Set synthetic user for bypass access with admin role
					event.locals.user = {
						id: 0,
						username: 'local',
						displayName: 'Local Network',
						role: 'admin'
					};
				}
			}
		} catch {
			// If settings fetch fails, continue without bypass
			// This ensures the app works even if DB is unavailable
		}
	}

	// All async operations within this context will have access to the correlation ID
	const context: RequestContext = {
		correlationId,
		source: 'http',
		...(event.locals.user?.id !== undefined && { userId: event.locals.user.id })
	};

	// Execute request handling within context
	return runWithContext(context, async () => {
		const response = await resolve(event);

		if (event.locals.isApiKey && event.locals.apiKeyId) {
			const apiKeyId = event.locals.apiKeyId;
			const rateLimitPerMinute = event.locals.apiKeyRateLimitPerMinute ?? null;

			// Only record if rate limit is configured (not unlimited)
			if (rateLimitPerMinute !== null) {
				apiKeyRateLimiter.recordRequest(apiKeyId).catch(() => {
					/* Fire and forget - ignore errors */
				});
			}

			if (rateLimitPerMinute !== null) {
				const rateLimitStatus = await apiKeyRateLimiter.getRateLimitStatus(
					apiKeyId,
					rateLimitPerMinute
				);
				response.headers.set('X-RateLimit-Limit', String(rateLimitStatus.limit ?? 'unlimited'));
				response.headers.set(
					'X-RateLimit-Remaining',
					String(rateLimitStatus.remaining ?? 'unlimited')
				);
				response.headers.set('X-RateLimit-Reset', String(rateLimitStatus.resetInSeconds));
			}

			// Fire and forget - don't block the response
			const responseTimeMs = Date.now() - startTime;
			const clientIP = getClientIP(event.request, event.getClientAddress);
			logApiKeyUsage({
				apiKeyId,
				endpoint: event.url.pathname,
				method: event.request.method,
				statusCode: response.status,
				responseTimeMs,
				ipAddress: clientIP ?? undefined,
				userAgent: event.request.headers.get('user-agent')?.substring(0, 500) ?? undefined
			}).catch(() => {
				/* Fire and forget - ignore errors to avoid impacting response */
			});
		}

		// Security headers
		response.headers.set('X-Frame-Options', 'SAMEORIGIN');
		response.headers.set('X-Content-Type-Options', 'nosniff');
		response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

		// HSTS header in production only (don't break local HTTP dev)
		if (process.env.NODE_ENV === 'production') {
			response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
		}

		// Include correlation ID in response for client-side correlation
		response.headers.set('X-Correlation-ID', correlationId);

		return response;
	});
};
