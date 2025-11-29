import type { Handle } from '@sveltejs/kit';
import { validateSession } from '$lib/server/auth';

/** Cookie name for session token */
const SESSION_COOKIE_NAME = 'session';

export const handle: Handle = async ({ event, resolve }) => {
	// Generate correlation ID for request tracing
	const correlationId = event.request.headers.get('x-correlation-id') ?? crypto.randomUUID();
	event.locals.correlationId = correlationId;

	// Session validation (Requirements 10.1, 10.2)
	const sessionId = event.cookies.get(SESSION_COOKIE_NAME);
	if (sessionId) {
		event.locals.user = await validateSession(sessionId);
	} else {
		event.locals.user = null;
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
