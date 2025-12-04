/**
 * Edit schedule page server load and actions.
 *
 * Requirements: 19.2
 */

import type { PageServerLoad, Actions } from './$types';
import { getAllConnectors } from '$lib/server/db/queries/connectors';
import { getAllThrottleProfiles } from '$lib/server/db/queries/throttle';
import {
	getScheduleById,
	updateSchedule,
	deleteSchedule
} from '$lib/server/db/queries/schedules';
import { refreshDynamicSchedules } from '$lib/server/scheduler';
import { error, fail, redirect } from '@sveltejs/kit';
import * as v from 'valibot';
import { ScheduleUpdateSchema } from '$lib/schemas/schedules';
import { Cron } from 'croner';

export const load: PageServerLoad = async ({ params }) => {
	const id = parseInt(params.id, 10);

	if (isNaN(id)) {
		error(404, 'Schedule not found');
	}

	const [schedule, connectors, throttleProfiles] = await Promise.all([
		getScheduleById(id),
		getAllConnectors(),
		getAllThrottleProfiles()
	]);

	if (!schedule) {
		error(404, 'Schedule not found');
	}

	return {
		schedule,
		connectors,
		throttleProfiles
	};
};

export const actions: Actions = {
	/**
	 * Update an existing schedule.
	 */
	update: async ({ request, params }) => {
		const id = parseInt(params.id, 10);

		if (isNaN(id)) {
			return fail(400, { error: 'Invalid schedule ID' });
		}

		const existingSchedule = await getScheduleById(id);
		if (!existingSchedule) {
			return fail(404, { error: 'Schedule not found' });
		}

		const formData = await request.formData();

		// Parse form data
		const rawConnectorId = formData.get('connectorId');
		const rawThrottleProfileId = formData.get('throttleProfileId');

		const data = {
			name: formData.get('name'),
			sweepType: formData.get('sweepType'),
			cronExpression: formData.get('cronExpression'),
			timezone: formData.get('timezone'),
			connectorId:
				rawConnectorId === '' || rawConnectorId === null
					? null
					: parseInt(rawConnectorId.toString(), 10),
			throttleProfileId:
				rawThrottleProfileId === '' || rawThrottleProfileId === null
					? null
					: parseInt(rawThrottleProfileId.toString(), 10)
		};

		// Preserve form values for error display
		const formValues = {
			name: data.name?.toString() ?? existingSchedule.name,
			sweepType: data.sweepType?.toString() ?? existingSchedule.sweepType,
			cronExpression: data.cronExpression?.toString() ?? existingSchedule.cronExpression,
			timezone: data.timezone?.toString() ?? existingSchedule.timezone,
			connectorId: rawConnectorId?.toString() ?? (existingSchedule.connectorId?.toString() ?? ''),
			throttleProfileId:
				rawThrottleProfileId?.toString() ?? (existingSchedule.throttleProfileId?.toString() ?? '')
		};

		// Validate form data
		const result = v.safeParse(ScheduleUpdateSchema, data);
		if (!result.success) {
			const errors = result.issues.map((issue) => issue.message);
			return fail(400, {
				error: errors[0] ?? 'Invalid input',
				...formValues
			});
		}

		const config = result.output;

		// Validate cron expression with Croner
		try {
			new Cron(config.cronExpression, { timezone: config.timezone });
		} catch (err) {
			return fail(400, {
				error: `Invalid cron expression: ${err instanceof Error ? err.message : 'Unknown error'}`,
				...formValues
			});
		}

		// Validate connectorId exists if provided
		if (config.connectorId !== null && config.connectorId !== undefined) {
			const connectors = await getAllConnectors();
			const connectorExists = connectors.some((c) => c.id === config.connectorId);
			if (!connectorExists) {
				return fail(400, {
					error: 'Selected connector does not exist',
					...formValues
				});
			}
		}

		// Validate throttleProfileId exists if provided
		if (config.throttleProfileId !== null && config.throttleProfileId !== undefined) {
			const profiles = await getAllThrottleProfiles();
			const profileExists = profiles.some((p) => p.id === config.throttleProfileId);
			if (!profileExists) {
				return fail(400, {
					error: 'Selected throttle profile does not exist',
					...formValues
				});
			}
		}

		// Update the schedule
		try {
			await updateSchedule(id, {
				name: config.name,
				sweepType: config.sweepType,
				cronExpression: config.cronExpression,
				timezone: config.timezone,
				throttleProfileId: config.throttleProfileId ?? null
			});

			// Refresh scheduler to pick up changes
			await refreshDynamicSchedules();
		} catch (err) {
			console.error('[schedules/edit] Failed to update schedule:', err);
			return fail(500, {
				error: 'Failed to update schedule. Please try again.',
				...formValues
			});
		}

		// Redirect to schedules list
		redirect(303, '/schedules');
	},

	/**
	 * Delete a schedule.
	 */
	delete: async ({ params }) => {
		const id = parseInt(params.id, 10);

		if (isNaN(id)) {
			return fail(400, { error: 'Invalid schedule ID' });
		}

		try {
			const deleted = await deleteSchedule(id);

			if (!deleted) {
				return fail(404, { error: 'Schedule not found' });
			}

			// Refresh scheduler to remove the deleted schedule
			await refreshDynamicSchedules();
		} catch (err) {
			console.error('[schedules/edit] Failed to delete schedule:', err);
			return fail(500, { error: 'Failed to delete schedule. Please try again.' });
		}

		// Redirect to schedules list
		redirect(303, '/schedules');
	}
};
