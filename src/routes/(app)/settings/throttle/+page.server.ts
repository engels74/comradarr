/**
 * Throttle profiles settings page server load and actions.
 */

import type { PageServerLoad, Actions } from './$types';
import {
	getAllThrottleProfiles,
	getConnectorCountUsingProfile,
	createThrottleProfile,
	updateThrottleProfile,
	deleteThrottleProfile,
	throttleProfileNameExists,
	setDefaultThrottleProfile
} from '$lib/server/db/queries/throttle';
import { fail } from '@sveltejs/kit';
import * as v from 'valibot';
import { ThrottleProfileSchema } from '$lib/schemas/throttle-profile';

/**
 * Profile with connector usage count for display.
 */
export interface ProfileWithUsage {
	id: number;
	name: string;
	description: string | null;
	requestsPerMinute: number;
	dailyBudget: number | null;
	batchSize: number;
	batchCooldownSeconds: number;
	rateLimitPauseSeconds: number;
	isDefault: boolean;
	createdAt: Date;
	updatedAt: Date;
	connectorCount: number;
}

export const load: PageServerLoad = async () => {
	const profiles = await getAllThrottleProfiles();

	// Get connector usage count for each profile
	const profilesWithUsage: ProfileWithUsage[] = await Promise.all(
		profiles.map(async (profile) => ({
			...profile,
			connectorCount: await getConnectorCountUsingProfile(profile.id)
		}))
	);

	return { profiles: profilesWithUsage };
};

/**
 * Parse form data into typed object for validation.
 */
function parseFormData(formData: FormData) {
	const dailyBudgetStr = formData.get('dailyBudget')?.toString();
	const dailyBudget =
		dailyBudgetStr === '' || dailyBudgetStr === undefined || dailyBudgetStr === null
			? null
			: Number(dailyBudgetStr);

	return {
		name: formData.get('name')?.toString() ?? '',
		description: formData.get('description')?.toString() || undefined,
		requestsPerMinute: Number(formData.get('requestsPerMinute')),
		dailyBudget,
		batchSize: Number(formData.get('batchSize')),
		batchCooldownSeconds: Number(formData.get('batchCooldownSeconds')),
		rateLimitPauseSeconds: Number(formData.get('rateLimitPauseSeconds')),
		isDefault: formData.get('isDefault') === 'on'
	};
}

export const actions: Actions = {
	/**
	 * Create a new custom throttle profile.
	 */
	create: async ({ request }) => {
		const formData = await request.formData();
		const data = parseFormData(formData);

		// Validate form data
		const result = v.safeParse(ThrottleProfileSchema, data);
		if (!result.success) {
			const errors = result.issues.map((issue) => issue.message);
			return fail(400, {
				action: 'create',
				error: errors[0] ?? 'Invalid input',
				values: data
			});
		}

		const config = result.output;

		// Check if name is unique
		const nameExists = await throttleProfileNameExists(config.name);
		if (nameExists) {
			return fail(400, {
				action: 'create',
				error: 'A profile with this name already exists',
				values: data
			});
		}

		// Create the profile
		try {
			await createThrottleProfile({
				name: config.name,
				...(config.description !== undefined && { description: config.description }),
				requestsPerMinute: config.requestsPerMinute,
				dailyBudget: config.dailyBudget ?? null,
				batchSize: config.batchSize,
				batchCooldownSeconds: config.batchCooldownSeconds,
				rateLimitPauseSeconds: config.rateLimitPauseSeconds,
				isDefault: config.isDefault ?? false
			});
		} catch (err) {
			console.error('[throttle-profiles] Failed to create profile:', err);
			return fail(500, {
				action: 'create',
				error: 'Failed to create profile. Please try again.',
				values: data
			});
		}

		return { success: true, message: 'Profile created successfully' };
	},

	/**
	 * Update an existing throttle profile.
	 */
	update: async ({ request }) => {
		const formData = await request.formData();
		const id = Number(formData.get('id'));

		if (!id || isNaN(id)) {
			return fail(400, {
				action: 'update',
				error: 'Invalid profile ID'
			});
		}

		const data = parseFormData(formData);

		// Validate form data
		const result = v.safeParse(ThrottleProfileSchema, data);
		if (!result.success) {
			const errors = result.issues.map((issue) => issue.message);
			return fail(400, {
				action: 'update',
				error: errors[0] ?? 'Invalid input',
				values: { ...data, id }
			});
		}

		const config = result.output;

		// Check if name is unique (excluding current profile)
		const nameExists = await throttleProfileNameExists(config.name, id);
		if (nameExists) {
			return fail(400, {
				action: 'update',
				error: 'A profile with this name already exists',
				values: { ...data, id }
			});
		}

		// Update the profile
		try {
			const updated = await updateThrottleProfile(id, {
				name: config.name,
				...(config.description !== undefined && { description: config.description }),
				requestsPerMinute: config.requestsPerMinute,
				dailyBudget: config.dailyBudget ?? null,
				batchSize: config.batchSize,
				batchCooldownSeconds: config.batchCooldownSeconds,
				rateLimitPauseSeconds: config.rateLimitPauseSeconds,
				isDefault: config.isDefault ?? false
			});

			if (!updated) {
				return fail(404, {
					action: 'update',
					error: 'Profile not found'
				});
			}
		} catch (err) {
			console.error('[throttle-profiles] Failed to update profile:', err);
			return fail(500, {
				action: 'update',
				error: 'Failed to update profile. Please try again.',
				values: { ...data, id }
			});
		}

		return { success: true, message: 'Profile updated successfully' };
	},

	/**
	 * Delete a throttle profile.
	 */
	delete: async ({ request }) => {
		const formData = await request.formData();
		const id = Number(formData.get('id'));

		if (!id || isNaN(id)) {
			return fail(400, {
				action: 'delete',
				error: 'Invalid profile ID'
			});
		}

		try {
			const deleted = await deleteThrottleProfile(id);
			if (!deleted) {
				return fail(404, {
					action: 'delete',
					error: 'Profile not found'
				});
			}
		} catch (err) {
			// Check if error is due to profile being in use
			if (err instanceof Error && err.message.includes('assigned to')) {
				return fail(400, {
					action: 'delete',
					error: err.message
				});
			}
			console.error('[throttle-profiles] Failed to delete profile:', err);
			return fail(500, {
				action: 'delete',
				error: 'Failed to delete profile. Please try again.'
			});
		}

		return { success: true, message: 'Profile deleted successfully' };
	},

	/**
	 * Set a profile as the default.
	 */
	setDefault: async ({ request }) => {
		const formData = await request.formData();
		const id = Number(formData.get('id'));

		if (!id || isNaN(id)) {
			return fail(400, {
				action: 'setDefault',
				error: 'Invalid profile ID'
			});
		}

		try {
			const updated = await setDefaultThrottleProfile(id);
			if (!updated) {
				return fail(404, {
					action: 'setDefault',
					error: 'Profile not found'
				});
			}
		} catch (err) {
			console.error('[throttle-profiles] Failed to set default profile:', err);
			return fail(500, {
				action: 'setDefault',
				error: 'Failed to set default profile. Please try again.'
			});
		}

		return { success: true, message: 'Default profile updated successfully' };
	}
};
