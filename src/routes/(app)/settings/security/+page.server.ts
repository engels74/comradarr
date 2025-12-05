/**
 * Security settings page server load and actions.
 *
 * Requirements: 21.5, 10.3
 */

import type { PageServerLoad, Actions } from './$types';
import { getSecuritySettings, updateSecuritySettings } from '$lib/server/db/queries/settings';
import {
	getUserById,
	getUserSessions,
	deleteUserSession,
	deleteOtherUserSessions,
	updateUserPassword
} from '$lib/server/db/queries/auth';
import { hashPassword, verifyPassword } from '$lib/server/auth';
import { fail } from '@sveltejs/kit';
import * as v from 'valibot';
import { AuthModeSchema, PasswordChangeSchema } from '$lib/schemas/settings';

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
	/**
	 * Update authentication mode.
	 */
	updateAuthMode: async ({ request }) => {
		const formData = await request.formData();

		// Parse form data
		const data = {
			authMode: formData.get('authMode')
		};

		// Preserve form values for error display
		const formValues = {
			authMode: data.authMode?.toString() ?? ''
		};

		// Validate form data
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

		// Update the setting
		try {
			await updateSecuritySettings({ authMode: config.authMode });
		} catch (err) {
			console.error('[security] Failed to update auth mode:', err);
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

	/**
	 * Change password for current user.
	 */
	changePassword: async ({ request, locals }) => {
		// Cannot change password for bypass users
		if (locals.isLocalBypass || !locals.user || locals.user.id === 0) {
			return fail(403, {
				action: 'changePassword',
				error: 'Cannot change password in local network bypass mode'
			});
		}

		const formData = await request.formData();

		// Parse form data
		const data = {
			currentPassword: formData.get('currentPassword')?.toString() ?? '',
			newPassword: formData.get('newPassword')?.toString() ?? '',
			confirmPassword: formData.get('confirmPassword')?.toString() ?? ''
		};

		// Validate form data
		const result = v.safeParse(PasswordChangeSchema, data);
		if (!result.success) {
			const errors = result.issues.map((issue) => issue.message);
			return fail(400, {
				action: 'changePassword',
				error: errors[0] ?? 'Invalid input'
			});
		}

		const config = result.output;

		// Get current user to verify password
		const user = await getUserById(locals.user.id);
		if (!user) {
			return fail(400, {
				action: 'changePassword',
				error: 'User not found'
			});
		}

		// Verify current password
		const passwordValid = await verifyPassword(user.passwordHash, config.currentPassword);
		if (!passwordValid) {
			return fail(400, {
				action: 'changePassword',
				error: 'Current password is incorrect'
			});
		}

		// Hash and update new password
		try {
			const newPasswordHash = await hashPassword(config.newPassword);
			await updateUserPassword(locals.user.id, newPasswordHash);
		} catch (err) {
			console.error('[security] Failed to update password:', err);
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

	/**
	 * Revoke a specific session.
	 */
	revokeSession: async ({ request, locals }) => {
		// Cannot revoke sessions for bypass users
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

		// Cannot revoke current session
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
			console.error('[security] Failed to revoke session:', err);
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

	/**
	 * Revoke all sessions except current.
	 */
	revokeAllSessions: async ({ locals }) => {
		// Cannot revoke sessions for bypass users
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
				message: count > 0 ? `Revoked ${count} session${count === 1 ? '' : 's'}` : 'No other sessions to revoke'
			};
		} catch (err) {
			console.error('[security] Failed to revoke all sessions:', err);
			return fail(500, {
				action: 'revokeAllSessions',
				error: 'Failed to revoke sessions. Please try again.'
			});
		}
	}
};
