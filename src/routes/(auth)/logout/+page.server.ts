/**
 * Logout page server-side logic.
 */

import { redirect } from '@sveltejs/kit';
import { deleteSession } from '$lib/server/auth/session';
import type { Actions, PageServerLoad } from './$types';

const SESSION_COOKIE_NAME = 'session';

export const load: PageServerLoad = async ({ cookies }) => {
	const sessionId = cookies.get(SESSION_COOKIE_NAME);

	if (sessionId) {
		await deleteSession(sessionId);
		cookies.delete(SESSION_COOKIE_NAME, { path: '/' });
	}

	redirect(303, '/login');
};

export const actions: Actions = {
	default: async ({ cookies }) => {
		const sessionId = cookies.get(SESSION_COOKIE_NAME);

		if (sessionId) {
			await deleteSession(sessionId);
			cookies.delete(SESSION_COOKIE_NAME, { path: '/' });
		}

		redirect(303, '/login');
	}
};
