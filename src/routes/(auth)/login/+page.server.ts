/**
 * Login page server-side logic.
 */

import { fail, redirect } from '@sveltejs/kit';
import * as v from 'valibot';
import { LoginSchema } from '$lib/schemas/auth';
import { verifyPassword } from '$lib/server/auth/password';
import { createSession } from '$lib/server/auth/session';
import {
	checkAndResetLockout,
	getRemainingLockoutTime,
	getUserByUsername,
	MAX_FAILED_ATTEMPTS,
	recordFailedLogin,
	recordSuccessfulLogin
} from '$lib/server/db/queries/auth';
import { createLogger } from '$lib/server/logger';
import type { Actions, PageServerLoad } from './$types';

const logger = createLogger('auth');

/** Cookie name for session token (must match hooks.server.ts) */
const SESSION_COOKIE_NAME = 'session';

/** Session duration in seconds (7 days) */
const SESSION_MAX_AGE = 7 * 24 * 60 * 60;

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.user) {
		redirect(303, '/');
	}

	return {};
};

export const actions: Actions = {
	default: async ({ request, cookies, getClientAddress }) => {
		const formData = await request.formData();
		const data = {
			username: formData.get('username'),
			password: formData.get('password')
		};

		const result = v.safeParse(LoginSchema, data);
		if (!result.success) {
			const errors = result.issues.map((issue) => issue.message);
			return fail(400, {
				error: errors[0] ?? 'Invalid input',
				username: data.username?.toString() ?? ''
			});
		}

		const { username, password } = result.output;
		const ipAddress = getClientAddress();

		const user = await getUserByUsername(username);

		// Use generic error message to prevent username enumeration
		if (!user) {
			return fail(400, {
				error: 'Invalid username or password',
				username
			});
		}

		const isLocked = await checkAndResetLockout(user);
		if (isLocked) {
			const remainingSeconds = getRemainingLockoutTime(user);
			const remainingMinutes = Math.ceil((remainingSeconds ?? 0) / 60);
			logger.warn('Login attempt on locked account', {
				username,
				ipAddress,
				lockoutMinutesRemaining: remainingMinutes
			});
			return fail(400, {
				error: `Account is locked. Try again in ${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''}.`,
				username
			});
		}

		const isValid = await verifyPassword(user.passwordHash, password);
		if (!isValid) {
			const loginResult = await recordFailedLogin(user.id);

			if (loginResult.isLocked) {
				logger.warn('Account locked after failed attempts', {
					username,
					lockoutMinutes: loginResult.lockoutMinutes
				});
				return fail(400, {
					error: `Too many failed attempts. Account is locked for ${loginResult.lockoutMinutes} minutes.`,
					username
				});
			}

			const remainingAttempts = MAX_FAILED_ATTEMPTS - loginResult.attemptCount;
			logger.warn('Login failed - invalid credentials', {
				username,
				ipAddress,
				attemptsRemaining: remainingAttempts
			});
			const warningMessage =
				remainingAttempts <= 2
					? ` (${remainingAttempts} attempt${remainingAttempts !== 1 ? 's' : ''} remaining)`
					: '';

			return fail(400, {
				error: `Invalid username or password${warningMessage}`,
				username
			});
		}

		await recordSuccessfulLogin(user.id);

		const userAgent = request.headers.get('user-agent') ?? undefined;
		const sessionId = await createSession(user.id, userAgent, ipAddress);
		logger.debug('Session created for user', { userId: user.id, username });

		cookies.set(SESSION_COOKIE_NAME, sessionId, {
			path: '/',
			httpOnly: true,
			secure: process.env.NODE_ENV === 'production',
			sameSite: 'lax',
			maxAge: SESSION_MAX_AGE
		});

		logger.info('User logged in', { username, ipAddress });

		redirect(303, '/');
	}
};
