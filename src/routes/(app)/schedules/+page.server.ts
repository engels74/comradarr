/**
 * Schedule list page server load and actions.
 *
 * Requirements: 19.1
 */

import type { PageServerLoad, Actions } from './$types';
import { getAllSchedules, toggleScheduleEnabled } from '$lib/server/db/queries/schedules';
import { getAllConnectors } from '$lib/server/db/queries/connectors';
import { fail } from '@sveltejs/kit';
import { refreshDynamicSchedules } from '$lib/server/scheduler';

export const load: PageServerLoad = async () => {
	const [schedules, connectors] = await Promise.all([getAllSchedules(), getAllConnectors()]);

	return {
		schedules,
		connectors
	};
};

export const actions: Actions = {
	/**
	 * Toggle schedule enabled status.
	 */
	toggle: async ({ request }) => {
		const data = await request.formData();
		const id = Number(data.get('id'));
		const enabled = data.get('enabled') === 'true';

		if (isNaN(id)) {
			return fail(400, { error: 'Invalid schedule ID' });
		}

		const updated = await toggleScheduleEnabled(id, enabled);

		if (!updated) {
			return fail(404, { error: 'Schedule not found' });
		}

		// Refresh scheduler to pick up changes
		await refreshDynamicSchedules();

		return { success: true };
	}
};
