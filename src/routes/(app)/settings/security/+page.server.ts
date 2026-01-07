/**
 * Security settings page server load and actions.
 */

import { fail } from '@sveltejs/kit';
import * as v from 'valibot';
import { AuthModeSchema, PasswordChangeSchema } from '$lib/schemas/settings';
import { hashPassword, verifyPassword } from '$lib/server/auth';
import {
	deleteOtherUserSessions,
	deleteUserSession,
	getUserById,
	getUserSessions,
	updateUserPassword
} from '$lib/server/db/queries/auth';
import { getSecuritySettings, updateSecuritySettings } from '$lib/server/db/queries/settings';
import { createLogger } from '$lib/server/logger';
import type { Actions, PageServerLoad } from './$types';

const logger = createLogger('security');

export const load: PageServerLoad = async ({ locals }) => {
	const securitySettings = await getSecuritySettings();

	// Get user sessions (only for authenticated users, not bypass)
	let sessions: Awaited<ReturnType<typeof getUserSessions>> = [];
	if (locals.user && !locals.isLocalBypass && locals.sessionId) {
		sessions = await getUserSessions(locals.user.id, locals.sessionId);
	}

	return {
		securitySettings,
		sessions,
		currentSessionId: locals.sessionId ?? null,
		isLocalBypass: locals.isLocalBypass ?? false
	};
};

export const actions: Actions = {
	updateAuthMode: async ({ request }) => {
		const formData = await request.formData();

		const data = {
			authMode: formData.get('authMode')
		};

		const formValues = {
			authMode: data.authMode?.toString() ?? ''
		};

		const result = v.safeParse(AuthModeSchema, data);
		if (!result.success) {
			const errors = result.issues.map((issue) => issue.message);
			return fail(400, {
				action: 'updateAuthMode',
				error: errors[0] ?? 'Invalid input',
				...formValues
			});
		}

		const config = result.output;

		try {
			await updateSecuritySettings({ authMode: config.authMode });
		} catch (err) {
			logger.error('Failed to update auth mode', {
				error: err instanceof Error ? err.message : String(err)
			});
			return fail(500, {
				action: 'updateAuthMode',
				error: 'Failed to update authentication mode. Please try again.',
				...formValues
			});
		}

		return {
			action: 'updateAuthMode',
			success: true,
			message: 'Authentication mode updated successfully',
			...formValues
		};
	},

	changePassword: async ({ request, locals }) => {
		if (locals.isLocalBypass || !locals.user || locals.user.id === 0) {
			return fail(403, {
				action: 'changePassword',
				error: 'Cannot change password in local network bypass mode'
			});
		}

		const formData = await request.formData();

		const data = {
			currentPassword: formData.get('currentPassword')?.toString() ?? '',
			newPassword: formData.get('newPassword')?.toString() ?? '',
			confirmPassword: formData.get('confirmPassword')?.toString() ?? ''
		};

		const result = v.safeParse(PasswordChangeSchema, data);
		if (!result.success) {
			const errors = result.issues.map((issue) => issue.message);
			return fail(400, {
				action: 'changePassword',
				error: errors[0] ?? 'Invalid input'
			});
		}

		const config = result.output;

		const user = await getUserById(locals.user.id);
		if (!user) {
			return fail(400, {
				action: 'changePassword',
				error: 'User not found'
			});
		}

		const passwordValid = await verifyPassword(user.passwordHash, config.currentPassword);
		if (!passwordValid) {
			return fail(400, {
				action: 'changePassword',
				error: 'Current password is incorrect'
			});
		}

		try {
			const newPasswordHash = await hashPassword(config.newPassword);
			await updateUserPassword(locals.user.id, newPasswordHash);
		} catch (err) {
			logger.error('Failed to update password', {
				error: err instanceof Error ? err.message : String(err)
			});
			return fail(500, {
				action: 'changePassword',
				error: 'Failed to update password. Please try again.'
			});
		}

		return {
			action: 'changePassword',
			success: true,
			message: 'Password changed successfully'
		};
	},

	revokeSession: async ({ request, locals }) => {
		if (locals.isLocalBypass || !locals.user || locals.user.id === 0) {
			return fail(403, {
				action: 'revokeSession',
				error: 'Cannot manage sessions in local network bypass mode'
			});
		}

		const formData = await request.formData();
		const sessionId = formData.get('sessionId')?.toString();

		if (!sessionId) {
			return fail(400, {
				action: 'revokeSession',
				error: 'Session ID is required'
			});
		}

		if (sessionId === locals.sessionId) {
			return fail(400, {
				action: 'revokeSession',
				error: 'Cannot revoke your current session. Use logout instead.'
			});
		}

		try {
			const deleted = await deleteUserSession(locals.user.id, sessionId);
			if (!deleted) {
				return fail(404, {
					action: 'revokeSession',
					error: 'Session not found'
				});
			}
		} catch (err) {
			logger.error('Failed to revoke session', {
				error: err instanceof Error ? err.message : String(err)
			});
			return fail(500, {
				action: 'revokeSession',
				error: 'Failed to revoke session. Please try again.'
			});
		}

		return {
			action: 'revokeSession',
			success: true,
			message: 'Session revoked successfully'
		};
	},

	revokeAllSessions: async ({ locals }) => {
		if (locals.isLocalBypass || !locals.user || locals.user.id === 0 || !locals.sessionId) {
			return fail(403, {
				action: 'revokeAllSessions',
				error: 'Cannot manage sessions in local network bypass mode'
			});
		}

		try {
			const count = await deleteOtherUserSessions(locals.user.id, locals.sessionId);
			return {
				action: 'revokeAllSessions',
				success: true,
				message:
					count > 0
						? `Revoked ${count} session${count === 1 ? '' : 's'}`
						: 'No other sessions to revoke'
			};
		} catch (err) {
			logger.error('Failed to revoke all sessions', {
				error: err instanceof Error ? err.message : String(err)
			});
			return fail(500, {
				action: 'revokeAllSessions',
				error: 'Failed to revoke sessions. Please try again.'
			});
		}
	}
};
