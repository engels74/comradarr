/**
 * Search behavior settings page server load and actions.
 */

import type { PageServerLoad, Actions } from './$types';
import { getSearchSettings, updateSearchSettings } from '$lib/server/db/queries/settings';
import { invalidateSearchConfigCache } from '$lib/server/services/queue/config';
import { fail } from '@sveltejs/kit';
import * as v from 'valibot';
import { SearchSettingsSchema, SEARCH_SETTINGS_DEFAULTS } from '$lib/schemas/search-settings';
import { createLogger } from '$lib/server/logger';

const logger = createLogger('search-settings');

export const load: PageServerLoad = async () => {
	const settings = await getSearchSettings();

	return {
		settings
	};
};

export const actions: Actions = {
	/**
	 * Update search behavior settings.
	 */
	update: async ({ request }) => {
		const formData = await request.formData();

		// Parse form data
		const data = {
			priorityWeights: {
				contentAge: Number(formData.get('contentAge')),
				missingDuration: Number(formData.get('missingDuration')),
				userPriority: Number(formData.get('userPriority')),
				failurePenalty: Number(formData.get('failurePenalty')),
				gapBonus: Number(formData.get('gapBonus'))
			},
			seasonPackThresholds: {
				minMissingPercent: Number(formData.get('minMissingPercent')),
				minMissingCount: Number(formData.get('minMissingCount'))
			},
			cooldownConfig: {
				baseDelayHours: Number(formData.get('baseDelayHours')),
				maxDelayHours: Number(formData.get('maxDelayHours')),
				multiplier: Number(formData.get('multiplier')),
				jitter: formData.get('jitter') === 'on'
			},
			retryConfig: {
				maxAttempts: Number(formData.get('maxAttempts'))
			}
		};

		// Validate form data
		const result = v.safeParse(SearchSettingsSchema, data);
		if (!result.success) {
			const errors = result.issues.map((issue) => issue.message);
			return fail(400, {
				error: errors[0] ?? 'Invalid input',
				values: data
			});
		}

		// Custom validation: maxDelayHours >= baseDelayHours
		if (data.cooldownConfig.maxDelayHours < data.cooldownConfig.baseDelayHours) {
			return fail(400, {
				error: 'Maximum delay must be greater than or equal to base delay',
				values: data
			});
		}

		// Update settings
		try {
			await updateSearchSettings(result.output);
			invalidateSearchConfigCache();
		} catch (err) {
			logger.error('Failed to update settings', {
				error: err instanceof Error ? err.message : String(err)
			});
			return fail(500, {
				error: 'Failed to update settings. Please try again.',
				values: data
			});
		}

		return {
			success: true,
			message: 'Search behavior settings saved successfully'
		};
	},

	/**
	 * Reset search behavior settings to defaults.
	 */
	reset: async () => {
		try {
			await updateSearchSettings(SEARCH_SETTINGS_DEFAULTS);
			invalidateSearchConfigCache();
		} catch (err) {
			logger.error('Failed to reset settings', {
				error: err instanceof Error ? err.message : String(err)
			});
			return fail(500, {
				error: 'Failed to reset settings. Please try again.'
			});
		}

		return {
			success: true,
			message: 'Search behavior settings reset to defaults'
		};
	}
};
