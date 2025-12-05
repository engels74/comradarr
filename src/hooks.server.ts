import type { Handle } from '@sveltejs/kit';
import { validateSession, isLocalNetworkIP, getClientIP } from '$lib/server/auth';
import { getSecuritySettings } from '$lib/server/db/queries/settings';
import { initializeScheduler } from '$lib/server/scheduler';

/** Cookie name for session token */
const SESSION_COOKIE_NAME = 'session';

// =============================================================================
// Scheduler Initialization
// =============================================================================

/**
 * Initialize scheduled jobs on server startup.
 * Only runs in non-test environments to avoid interference with tests.
 * The initializeScheduler function is idempotent (safe to call multiple times).
 *
 * Requirements: 7.4 - Reset counters at configured intervals
 */
if (process.env.NODE_ENV !== 'test') {
	initializeScheduler();
}

export const handle: Handle = async ({ event, resolve }) => {
	// Generate correlation ID for request tracing
	const correlationId = event.request.headers.get('x-correlation-id') ?? crypto.randomUUID();
	event.locals.correlationId = correlationId;

	// Session validation (Requirements 10.1, 10.2)
	const sessionId = event.cookies.get(SESSION_COOKIE_NAME);
	if (sessionId) {
		event.locals.user = await validateSession(sessionId);
		if (event.locals.user) {
			event.locals.sessionId = sessionId;
		}
	} else {
		event.locals.user = null;
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

	const response = await resolve(event);

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
};
