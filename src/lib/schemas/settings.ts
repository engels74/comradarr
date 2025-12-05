/**
 * Validation schemas for settings forms.
 *
 * Requirements: 21.1
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
