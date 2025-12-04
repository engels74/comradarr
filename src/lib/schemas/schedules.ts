/**
 * Validation schemas for schedule forms.
 *
 * Requirements: 19.2, 19.3
 */

import * as v from 'valibot';

/**
 * Supported sweep types.
 */
export const sweepTypes = ['incremental', 'full_reconciliation'] as const;
export type SweepType = (typeof sweepTypes)[number];

/**
 * Common timezone options for schedule forms.
 */
export const timezoneOptions = [
	'UTC',
	'America/New_York',
	'America/Chicago',
	'America/Denver',
	'America/Los_Angeles',
	'Europe/London',
	'Europe/Paris',
	'Europe/Berlin',
	'Asia/Tokyo',
	'Australia/Sydney'
] as const;

/**
 * Create schedule form validation schema.
 *
 * - name: Required string, 1-100 characters
 * - sweepType: Required, one of 'incremental' | 'full_reconciliation'
 * - cronExpression: Required string (validated server-side via Croner)
 * - timezone: Required string, defaults to 'UTC'
 * - connectorId: Optional number or null (null = all connectors)
 * - throttleProfileId: Optional number or null (null = use default)
 */
export const ScheduleSchema = v.object({
	name: v.pipe(
		v.string('Name is required'),
		v.trim(),
		v.minLength(1, 'Name is required'),
		v.maxLength(100, 'Name must be 100 characters or less')
	),
	sweepType: v.pipe(
		v.string('Sweep type is required'),
		v.picklist(sweepTypes, 'Invalid sweep type')
	),
	cronExpression: v.pipe(
		v.string('Cron expression is required'),
		v.trim(),
		v.minLength(1, 'Cron expression is required'),
		v.maxLength(100, 'Cron expression must be 100 characters or less')
	),
	timezone: v.pipe(v.string('Timezone is required'), v.trim(), v.minLength(1, 'Timezone is required')),
	connectorId: v.optional(
		v.nullable(
			v.pipe(v.number('Connector ID must be a number'), v.integer('Connector ID must be an integer'))
		)
	),
	throttleProfileId: v.optional(
		v.nullable(
			v.pipe(
				v.number('Throttle profile ID must be a number'),
				v.integer('Throttle profile ID must be an integer')
			)
		)
	)
});

export type ScheduleInput = v.InferInput<typeof ScheduleSchema>;
export type ScheduleOutput = v.InferOutput<typeof ScheduleSchema>;

/**
 * Update schedule form validation schema.
 * Same as create schema, all fields required for consistency.
 */
export const ScheduleUpdateSchema = ScheduleSchema;

export type ScheduleUpdateInput = v.InferInput<typeof ScheduleUpdateSchema>;
export type ScheduleUpdateOutput = v.InferOutput<typeof ScheduleUpdateSchema>;
