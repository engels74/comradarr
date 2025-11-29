import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
	// Generate correlation ID for request tracing
	const correlationId = event.request.headers.get('x-correlation-id') ?? crypto.randomUUID();
	event.locals.correlationId = correlationId;

	// Initialize user as null (authentication will be added later)
	event.locals.user = null;

	const response = await resolve(event);

	// Security headers per steering docs
	response.headers.set('X-Frame-Options', 'SAMEORIGIN');
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

	// Include correlation ID in response for client-side correlation
	response.headers.set('X-Correlation-ID', correlationId);

	return response;
};
