/**
 * Validation schemas for throttle profile forms.
 *
 * Requirements: 21.2
 */

import * as v from 'valibot';

/**
 * Throttle profile form validation schema.
 *
 * - name: Required string, 1-50 characters
 * - description: Optional string, max 500 characters
 * - requestsPerMinute: Required number, 1-60 range
 * - dailyBudget: Optional number (null = unlimited), 10-10000 when set
 * - batchSize: Required number, 1-50 range
 * - batchCooldownSeconds: Required number, 10-3600 range
 * - rateLimitPauseSeconds: Required number, 60-3600 range
 * - isDefault: Optional boolean
 */
export const ThrottleProfileSchema = v.object({
	name: v.pipe(
		v.string('Profile name is required'),
		v.trim(),
		v.minLength(1, 'Profile name is required'),
		v.maxLength(50, 'Profile name must be 50 characters or less')
	),
	description: v.optional(
		v.pipe(v.string(), v.trim(), v.maxLength(500, 'Description must be 500 characters or less'))
	),
	requestsPerMinute: v.pipe(
		v.number('Requests per minute must be a number'),
		v.integer('Requests per minute must be a whole number'),
		v.minValue(1, 'Requests per minute must be at least 1'),
		v.maxValue(60, 'Requests per minute must be at most 60')
	),
	dailyBudget: v.optional(
		v.nullable(
			v.pipe(
				v.number('Daily budget must be a number'),
				v.integer('Daily budget must be a whole number'),
				v.minValue(10, 'Daily budget must be at least 10'),
				v.maxValue(10000, 'Daily budget must be at most 10,000')
			)
		)
	),
	batchSize: v.pipe(
		v.number('Batch size must be a number'),
		v.integer('Batch size must be a whole number'),
		v.minValue(1, 'Batch size must be at least 1'),
		v.maxValue(50, 'Batch size must be at most 50')
	),
	batchCooldownSeconds: v.pipe(
		v.number('Batch cooldown must be a number'),
		v.integer('Batch cooldown must be a whole number'),
		v.minValue(10, 'Batch cooldown must be at least 10 seconds'),
		v.maxValue(3600, 'Batch cooldown must be at most 3,600 seconds (1 hour)')
	),
	rateLimitPauseSeconds: v.pipe(
		v.number('Rate limit pause must be a number'),
		v.integer('Rate limit pause must be a whole number'),
		v.minValue(60, 'Rate limit pause must be at least 60 seconds'),
		v.maxValue(3600, 'Rate limit pause must be at most 3,600 seconds (1 hour)')
	),
	isDefault: v.optional(v.boolean())
});

export type ThrottleProfileInput = v.InferInput<typeof ThrottleProfileSchema>;
export type ThrottleProfileOutput = v.InferOutput<typeof ThrottleProfileSchema>;

/**
 * Field labels for UI display.
 */
export const throttleProfileLabels: Record<keyof ThrottleProfileOutput, string> = {
	name: 'Profile Name',
	description: 'Description',
	requestsPerMinute: 'Requests per Minute',
	dailyBudget: 'Daily Budget',
	batchSize: 'Batch Size',
	batchCooldownSeconds: 'Batch Cooldown (seconds)',
	rateLimitPauseSeconds: 'Rate Limit Pause (seconds)',
	isDefault: 'Set as Default'
};

/**
 * Field descriptions for UI help text.
 */
export const throttleProfileDescriptions: Record<keyof ThrottleProfileOutput, string> = {
	name: 'A unique name to identify this throttle profile',
	description: 'Optional description of when to use this profile',
	requestsPerMinute: 'Maximum search requests per minute (1-60)',
	dailyBudget: 'Maximum requests per day (leave empty for unlimited)',
	batchSize: 'Number of items to process per batch (1-50)',
	batchCooldownSeconds: 'Seconds to wait between batches (10-3600)',
	rateLimitPauseSeconds: 'Seconds to pause when rate limited (60-3600)',
	isDefault: 'Use this profile when no connector-specific profile is set'
};
