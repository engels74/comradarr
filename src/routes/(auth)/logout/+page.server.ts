/**
 * Logout page server-side logic.
 */

import { redirect } from '@sveltejs/kit';
import { deleteSession } from '$lib/server/auth/session';
import type { Actions, PageServerLoad } from './$types';

/** Cookie name for session token (must match hooks.server.ts) */
const SESSION_COOKIE_NAME = 'session';

/**
 * Load function - performs logout on page load (GET request).
 * This allows logout via simple link/redirect.
 */
export const load: PageServerLoad = async ({ cookies }) => {
	const sessionId = cookies.get(SESSION_COOKIE_NAME);

	if (sessionId) {
		// Delete session from database
		await deleteSession(sessionId);

		// Clear session cookie
		cookies.delete(SESSION_COOKIE_NAME, { path: '/' });
	}

	// Redirect to login page
	redirect(303, '/login');
};

export const actions: Actions = {
	/**
	 * Default logout action for POST requests.
	 * Provides alternative logout method via form submission.
	 */
	default: async ({ cookies }) => {
		const sessionId = cookies.get(SESSION_COOKIE_NAME);

		if (sessionId) {
			// Delete session from database
			await deleteSession(sessionId);

			// Clear session cookie
			cookies.delete(SESSION_COOKIE_NAME, { path: '/' });
		}

		// Redirect to login page
		redirect(303, '/login');
	}
};
