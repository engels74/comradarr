import * as v from 'valibot';

export const sweepTypes = ['incremental', 'full_reconciliation'] as const;
export type SweepType = (typeof sweepTypes)[number];

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
	timezone: v.pipe(
		v.string('Timezone is required'),
		v.trim(),
		v.minLength(1, 'Timezone is required')
	),
	connectorId: v.optional(
		v.nullable(
			v.pipe(
				v.number('Connector ID must be a number'),
				v.integer('Connector ID must be an integer')
			)
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

export const ScheduleUpdateSchema = ScheduleSchema;

export type ScheduleUpdateInput = v.InferInput<typeof ScheduleUpdateSchema>;
export type ScheduleUpdateOutput = v.InferOutput<typeof ScheduleUpdateSchema>;
