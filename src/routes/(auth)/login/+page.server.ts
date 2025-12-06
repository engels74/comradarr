/**
 * Login page server-side logic.
 */

import { fail, redirect } from '@sveltejs/kit';
import * as v from 'valibot';
import { LoginSchema } from '$lib/schemas/auth';
import { verifyPassword } from '$lib/server/auth/password';
import { createSession } from '$lib/server/auth/session';
import {
	getUserByUsername,
	checkAndResetLockout,
	getRemainingLockoutTime,
	recordFailedLogin,
	recordSuccessfulLogin,
	MAX_FAILED_ATTEMPTS
} from '$lib/server/db/queries/auth';
import type { Actions, PageServerLoad } from './$types';

/** Cookie name for session token (must match hooks.server.ts) */
const SESSION_COOKIE_NAME = 'session';

/** Session duration in seconds (7 days) */
const SESSION_MAX_AGE = 7 * 24 * 60 * 60;

/**
 * Load function - redirects authenticated users to dashboard.
 */
export const load: PageServerLoad = async ({ locals }) => {
	// If already authenticated, redirect to dashboard
	if (locals.user) {
		redirect(303, '/');
	}

	return {};
};

export const actions: Actions = {
	/**
	 * Default login action.
	 *
	 * 1. Validates form data
	 * 2. Looks up user by username
	 * 3. Checks account lockout
	 * 4. Verifies password
	 * 5. Creates session on success
	 */
	default: async ({ request, cookies, getClientAddress }) => {
		const formData = await request.formData();
		const data = {
			username: formData.get('username'),
			password: formData.get('password')
		};

		// Validate form data
		const result = v.safeParse(LoginSchema, data);
		if (!result.success) {
			const errors = result.issues.map((issue) => issue.message);
			return fail(400, {
				error: errors[0] ?? 'Invalid input',
				username: data.username?.toString() ?? ''
			});
		}

		const { username, password } = result.output;

		// Look up user by username
		const user = await getUserByUsername(username);

		// Use generic error message to prevent username enumeration
		if (!user) {
			return fail(400, {
				error: 'Invalid username or password',
				username
			});
		}

		// Check if account is locked (with auto-reset for expired lockouts - Req 35.3, 35.4)
		const isLocked = await checkAndResetLockout(user);
		if (isLocked) {
			const remainingSeconds = getRemainingLockoutTime(user);
			const remainingMinutes = Math.ceil((remainingSeconds ?? 0) / 60);
			return fail(400, {
				error: `Account is locked. Try again in ${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''}.`,
				username
			});
		}

		// Verify password
		const isValid = await verifyPassword(user.passwordHash, password);
		if (!isValid) {
			// Record failed login attempt (may trigger lockout - Req 35.1, 35.2)
			const loginResult = await recordFailedLogin(user.id);

			// If account was just locked, inform the user
			if (loginResult.isLocked) {
				return fail(400, {
					error: `Too many failed attempts. Account is locked for ${loginResult.lockoutMinutes} minutes.`,
					username
				});
			}

			// Show remaining attempts warning
			const remainingAttempts = MAX_FAILED_ATTEMPTS - loginResult.attemptCount;
			const warningMessage =
				remainingAttempts <= 2
					? ` (${remainingAttempts} attempt${remainingAttempts !== 1 ? 's' : ''} remaining)`
					: '';

			return fail(400, {
				error: `Invalid username or password${warningMessage}`,
				username
			});
		}

		// Record successful login (resets failed attempts counter)
		await recordSuccessfulLogin(user.id);

		// Create session
		const userAgent = request.headers.get('user-agent') ?? undefined;
		const ipAddress = getClientAddress();
		const sessionId = await createSession(user.id, userAgent, ipAddress);

		// Set session cookie
		cookies.set(SESSION_COOKIE_NAME, sessionId, {
			path: '/',
			httpOnly: true,
			secure: process.env.NODE_ENV === 'production',
			sameSite: 'lax',
			maxAge: SESSION_MAX_AGE
		});

		// Redirect to dashboard
		redirect(303, '/');
	}
};
