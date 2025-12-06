import type { Handle } from '@sveltejs/kit';
import { validateSession, isLocalNetworkIP, getClientIP } from '$lib/server/auth';
import { runWithContext, type RequestContext } from '$lib/server/context';
import { getSecuritySettings } from '$lib/server/db/queries/settings';
import { validateApiKey, logApiKeyUsage } from '$lib/server/db/queries/api-keys';
import { db } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { initializeScheduler } from '$lib/server/scheduler';
import { initializeLogLevel } from '$lib/server/logger';

/** Cookie name for session token */
const SESSION_COOKIE_NAME = 'session';

// =============================================================================
// Application Initialization
// =============================================================================

/**
 * Initialize application on server startup.
 * Only runs in non-test environments to avoid interference with tests.
 *
 * Requirements:
 * - 31.5: Initialize log level from database settings
 * - 7.4: Reset throttle counters at configured intervals
 */
if (process.env.NODE_ENV !== 'test') {
	// Initialize log level from database (Requirement 31.5)
	// This allows log level to persist across restarts
	initializeLogLevel().catch(() => {
		// Silently handle errors - logger will fall back to env/default
	});

	// Initialize scheduled jobs (Requirement 7.4)
	// The initializeScheduler function is idempotent (safe to call multiple times).
	initializeScheduler();
}

export const handle: Handle = async ({ event, resolve }) => {
	// Track request start time for API key usage logging (Requirement 34.4)
	const startTime = Date.now();

	// Generate correlation ID for request tracing (Requirement 31.2)
	const correlationId = event.request.headers.get('x-correlation-id') ?? crypto.randomUUID();
	event.locals.correlationId = correlationId;

	// API key authentication (Requirement 34.2)
	// Check X-API-Key header before session validation
	const apiKey = event.request.headers.get('x-api-key');
	if (apiKey) {
		const apiKeyResult = await validateApiKey(apiKey);
		if (apiKeyResult) {
			// Look up user data for the API key owner
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

			const user = userResult[0];
			if (user) {
				event.locals.user = user;
				event.locals.isApiKey = true;
				event.locals.apiKeyScope = apiKeyResult.scope;
				event.locals.apiKeyId = apiKeyResult.keyId;
			}
		}
	}

	// Session validation (Requirements 10.1, 10.2)
	// Only check session if not already authenticated via API key
	if (!event.locals.user) {
		const sessionId = event.cookies.get(SESSION_COOKIE_NAME);
		if (sessionId) {
			event.locals.user = await validateSession(sessionId);
			if (event.locals.user) {
				event.locals.sessionId = sessionId;
			}
		} else {
			event.locals.user = null;
		}
	}

	// Local network bypass (Requirement 10.3)
	// Only check bypass if no valid session exists
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

	// Create request context for correlation ID propagation (Requirement 31.2)
	// All async operations within this context will have access to the correlation ID
	const context: RequestContext = {
		correlationId,
		source: 'http',
		...(event.locals.user?.id !== undefined && { userId: event.locals.user.id })
	};

	// Execute request handling within context
	return runWithContext(context, async () => {
		const response = await resolve(event);

		// Log API key usage after request completes (Requirement 34.4)
		// Fire and forget - don't block the response
		if (event.locals.isApiKey && event.locals.apiKeyId) {
			const responseTimeMs = Date.now() - startTime;
			const clientIP = getClientIP(event.request, event.getClientAddress);
			logApiKeyUsage({
				apiKeyId: event.locals.apiKeyId,
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

		// Security headers (Requirement 10.5)
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
