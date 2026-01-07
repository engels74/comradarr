import * as v from 'valibot';

export const logLevels = ['error', 'warn', 'info', 'debug', 'trace'] as const;
export type LogLevel = (typeof logLevels)[number];

export const logLevelLabels: Record<LogLevel, string> = {
	error: 'Error',
	warn: 'Warning',
	info: 'Info',
	debug: 'Debug',
	trace: 'Trace'
};

export const logLevelDescriptions: Record<LogLevel, string> = {
	error: 'Only show errors',
	warn: 'Show warnings and errors',
	info: 'Show general information, warnings, and errors',
	debug: 'Show debug information for troubleshooting',
	trace: 'Show all log messages including detailed traces'
};

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

export const authModes = ['full', 'local_bypass'] as const;
export type AuthMode = (typeof authModes)[number];

export const authModeLabels: Record<AuthMode, string> = {
	full: 'Full Authentication',
	local_bypass: 'Local Network Bypass'
};

export const authModeDescriptions: Record<AuthMode, string> = {
	full: 'Always require authentication for all access',
	local_bypass:
		'Allow unauthenticated access from local network (RFC1918 addresses: 10.x.x.x, 172.16-31.x.x, 192.168.x.x)'
};

export const AuthModeSchema = v.object({
	authMode: v.pipe(
		v.string('Authentication mode is required'),
		v.picklist(authModes, 'Invalid authentication mode')
	)
});

export type AuthModeInput = v.InferInput<typeof AuthModeSchema>;
export type AuthModeOutput = v.InferOutput<typeof AuthModeSchema>;

export const PasswordChangeSchema = v.pipe(
	v.object({
		currentPassword: v.pipe(
			v.string('Current password is required'),
			v.minLength(1, 'Current password is required')
		),
		newPassword: v.pipe(
			v.string('New password is required'),
			v.minLength(8, 'Password must be at least 8 characters')
		),
		confirmPassword: v.pipe(
			v.string('Please confirm your password'),
			v.minLength(1, 'Please confirm your password')
		)
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

export const BackupSettingsSchema = v.object({
	scheduledEnabled: v.boolean('Scheduled enabled must be a boolean'),
	scheduledCron: v.pipe(
		v.string('Cron expression is required'),
		v.trim(),
		v.minLength(9, 'Invalid cron expression'),
		v.maxLength(100, 'Cron expression is too long')
	),
	retentionCount: v.pipe(
		v.number('Retention count must be a number'),
		v.minValue(1, 'Retention count must be at least 1'),
		v.maxValue(100, 'Retention count cannot exceed 100')
	)
});

export type BackupSettingsInput = v.InferInput<typeof BackupSettingsSchema>;
export type BackupSettingsOutput = v.InferOutput<typeof BackupSettingsSchema>;

export const apiKeyScopes = ['read', 'full'] as const;
export type ApiKeyScope = (typeof apiKeyScopes)[number];

export const apiKeyScopeLabels: Record<ApiKeyScope, string> = {
	read: 'Read Only',
	full: 'Full Access'
};

export const apiKeyScopeDescriptions: Record<ApiKeyScope, string> = {
	read: 'Can only read data (GET requests)',
	full: 'Full access to all API operations'
};

export const apiKeyExpirations = ['never', '30d', '90d', '365d'] as const;
export type ApiKeyExpiration = (typeof apiKeyExpirations)[number];

export const apiKeyExpirationLabels: Record<ApiKeyExpiration, string> = {
	never: 'Never',
	'30d': '30 days',
	'90d': '90 days',
	'365d': '1 year'
};

export const apiKeyRateLimitPresets = ['unlimited', '60', '120', 'custom'] as const;
export type ApiKeyRateLimitPreset = (typeof apiKeyRateLimitPresets)[number];

export const apiKeyRateLimitPresetLabels: Record<ApiKeyRateLimitPreset, string> = {
	unlimited: 'Unlimited',
	'60': '60/minute (Standard)',
	'120': '120/minute (Elevated)',
	custom: 'Custom'
};

export const apiKeyRateLimitPresetDescriptions: Record<ApiKeyRateLimitPreset, string> = {
	unlimited: 'No rate limit applied',
	'60': 'Standard rate limit for most use cases',
	'120': 'Elevated rate limit for high-frequency integrations',
	custom: 'Set a custom rate limit'
};

export const CreateApiKeySchema = v.object({
	name: v.pipe(
		v.string('Name is required'),
		v.trim(),
		v.minLength(1, 'Name is required'),
		v.maxLength(100, 'Name must be 100 characters or less')
	),
	description: v.optional(
		v.pipe(v.string(), v.trim(), v.maxLength(500, 'Description must be 500 characters or less'))
	),
	scope: v.pipe(v.string('Scope is required'), v.picklist(apiKeyScopes, 'Invalid scope')),
	expiresIn: v.optional(v.pipe(v.string(), v.picklist(apiKeyExpirations, 'Invalid expiration'))),
	rateLimitPreset: v.optional(
		v.pipe(v.string(), v.picklist(apiKeyRateLimitPresets, 'Invalid rate limit preset'))
	),
	rateLimitCustom: v.optional(
		v.pipe(
			v.number('Custom rate limit must be a number'),
			v.minValue(1, 'Rate limit must be at least 1'),
			v.maxValue(1000, 'Rate limit cannot exceed 1000')
		)
	)
});

export type CreateApiKeyInput = v.InferInput<typeof CreateApiKeySchema>;
export type CreateApiKeyOutput = v.InferOutput<typeof CreateApiKeySchema>;

export const UpdateApiKeyRateLimitSchema = v.object({
	rateLimitPreset: v.pipe(
		v.string('Rate limit preset is required'),
		v.picklist(apiKeyRateLimitPresets, 'Invalid rate limit preset')
	),
	rateLimitCustom: v.optional(
		v.pipe(
			v.number('Custom rate limit must be a number'),
			v.minValue(1, 'Rate limit must be at least 1'),
			v.maxValue(1000, 'Rate limit cannot exceed 1000')
		)
	)
});

export type UpdateApiKeyRateLimitInput = v.InferInput<typeof UpdateApiKeyRateLimitSchema>;
export type UpdateApiKeyRateLimitOutput = v.InferOutput<typeof UpdateApiKeyRateLimitSchema>;

export function parseRateLimitValue(
	preset: ApiKeyRateLimitPreset | undefined,
	custom: number | undefined
): number | null {
	if (!preset || preset === 'unlimited') {
		return null;
	}
	if (preset === 'custom') {
		return custom ?? null;
	}
	return parseInt(preset, 10);
}

export function toRateLimitFormValues(rateLimitPerMinute: number | null): {
	preset: ApiKeyRateLimitPreset;
	custom?: number;
} {
	if (rateLimitPerMinute === null) {
		return { preset: 'unlimited' };
	}
	if (rateLimitPerMinute === 60) {
		return { preset: '60' };
	}
	if (rateLimitPerMinute === 120) {
		return { preset: '120' };
	}
	return { preset: 'custom', custom: rateLimitPerMinute };
}
