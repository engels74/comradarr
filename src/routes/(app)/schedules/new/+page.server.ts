/**
 * New schedule page server load and actions.
 */

import type { PageServerLoad, Actions } from './$types';
import { getAllConnectors } from '$lib/server/db/queries/connectors';
import { getAllThrottleProfiles } from '$lib/server/db/queries/throttle';
import { createSchedule } from '$lib/server/db/queries/schedules';
import { refreshDynamicSchedules } from '$lib/server/scheduler';
import { fail, redirect } from '@sveltejs/kit';
import * as v from 'valibot';
import { ScheduleSchema } from '$lib/schemas/schedules';
import { Cron } from 'croner';

export const load: PageServerLoad = async () => {
	const [connectors, throttleProfiles] = await Promise.all([
		getAllConnectors(),
		getAllThrottleProfiles()
	]);

	return {
		connectors,
		throttleProfiles
	};
};

export const actions: Actions = {
	/**
	 * Create a new schedule.
	 */
	create: async ({ request }) => {
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
			name: data.name?.toString() ?? '',
			sweepType: data.sweepType?.toString() ?? '',
			cronExpression: data.cronExpression?.toString() ?? '',
			timezone: data.timezone?.toString() ?? 'UTC',
			connectorId: rawConnectorId?.toString() ?? '',
			throttleProfileId: rawThrottleProfileId?.toString() ?? ''
		};

		// Validate form data
		const result = v.safeParse(ScheduleSchema, data);
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

		// Create the schedule
		try {
			await createSchedule({
				name: config.name,
				sweepType: config.sweepType,
				cronExpression: config.cronExpression,
				timezone: config.timezone,
				connectorId: config.connectorId ?? null,
				throttleProfileId: config.throttleProfileId ?? null,
				enabled: true
			});

			// Refresh scheduler to pick up new schedule
			await refreshDynamicSchedules();
		} catch (err) {
			console.error('[schedules/new] Failed to create schedule:', err);
			return fail(500, {
				error: 'Failed to create schedule. Please try again.',
				...formValues
			});
		}

		// Redirect to schedules list
		redirect(303, '/schedules');
	}
};
