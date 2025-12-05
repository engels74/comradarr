/**
 * Validation schemas for settings forms.
 *
 * Requirements: 21.1, 21.5
 */

import * as v from 'valibot';

/**
 * Supported log levels.
 */
export const logLevels = ['error', 'warn', 'info', 'debug', 'trace'] as const;
export type LogLevel = (typeof logLevels)[number];

/**
 * Log level display names for UI.
 */
export const logLevelLabels: Record<LogLevel, string> = {
	error: 'Error',
	warn: 'Warning',
	info: 'Info',
	debug: 'Debug',
	trace: 'Trace'
};

/**
 * Log level descriptions for UI.
 */
export const logLevelDescriptions: Record<LogLevel, string> = {
	error: 'Only show errors',
	warn: 'Show warnings and errors',
	info: 'Show general information, warnings, and errors',
	debug: 'Show debug information for troubleshooting',
	trace: 'Show all log messages including detailed traces'
};

/**
 * General settings form validation schema.
 *
 * - appName: Required string, 1-100 characters
 * - timezone: Required string (valid IANA timezone)
 * - logLevel: Required, one of 'error' | 'warn' | 'info' | 'debug' | 'trace'
 * - checkForUpdates: Required boolean
 */
export const GeneralSettingsSchema = v.object({
	appName: v.pipe(
		v.string('Application name is required'),
		v.trim(),
		v.minLength(1, 'Application name is required'),
		v.maxLength(100, 'Application name must be 100 characters or less')
	),
	timezone: v.pipe(
		v.string('Timezone is required'),
		v.trim(),
		v.minLength(1, 'Timezone is required')
	),
	logLevel: v.pipe(v.string('Log level is required'), v.picklist(logLevels, 'Invalid log level')),
	checkForUpdates: v.boolean('Check for updates must be a boolean')
});

export type GeneralSettingsInput = v.InferInput<typeof GeneralSettingsSchema>;
export type GeneralSettingsOutput = v.InferOutput<typeof GeneralSettingsSchema>;

// =============================================================================
// Security Settings (Requirements: 21.5, 10.3)
// =============================================================================

/**
 * Supported authentication modes.
 *
 * - full: Always require authentication for all access
 * - local_bypass: Allow unauthenticated access from RFC1918 addresses
 */
export const authModes = ['full', 'local_bypass'] as const;
export type AuthMode = (typeof authModes)[number];

/**
 * Authentication mode display names for UI.
 */
export const authModeLabels: Record<AuthMode, string> = {
	full: 'Full Authentication',
	local_bypass: 'Local Network Bypass'
};

/**
 * Authentication mode descriptions for UI.
 */
export const authModeDescriptions: Record<AuthMode, string> = {
	full: 'Always require authentication for all access',
	local_bypass: 'Allow unauthenticated access from local network (RFC1918 addresses: 10.x.x.x, 172.16-31.x.x, 192.168.x.x)'
};

/**
 * Authentication mode update validation schema.
 */
export const AuthModeSchema = v.object({
	authMode: v.pipe(v.string('Authentication mode is required'), v.picklist(authModes, 'Invalid authentication mode'))
});

export type AuthModeInput = v.InferInput<typeof AuthModeSchema>;
export type AuthModeOutput = v.InferOutput<typeof AuthModeSchema>;

/**
 * Password change validation schema.
 *
 * Validates:
 * - Current password is provided
 * - New password is at least 8 characters
 * - Confirm password matches new password
 */
export const PasswordChangeSchema = v.pipe(
	v.object({
		currentPassword: v.pipe(v.string('Current password is required'), v.minLength(1, 'Current password is required')),
		newPassword: v.pipe(
			v.string('New password is required'),
			v.minLength(8, 'Password must be at least 8 characters')
		),
		confirmPassword: v.pipe(v.string('Please confirm your password'), v.minLength(1, 'Please confirm your password'))
	}),
	v.forward(
		v.partialCheck(
			[['newPassword'], ['confirmPassword']],
			(input) => input.newPassword === input.confirmPassword,
			'Passwords do not match'
		),
		['confirmPassword']
	)
);

export type PasswordChangeInput = v.InferInput<typeof PasswordChangeSchema>;
export type PasswordChangeOutput = v.InferOutput<typeof PasswordChangeSchema>;
