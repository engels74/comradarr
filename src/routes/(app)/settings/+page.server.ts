/**
 * Settings page server load and actions.
 */

import type { PageServerLoad, Actions } from './$types';
import { getGeneralSettings, updateGeneralSettings } from '$lib/server/db/queries/settings';
import { fail } from '@sveltejs/kit';
import * as v from 'valibot';
import { GeneralSettingsSchema, type LogLevel } from '$lib/schemas/settings';
import { createLogger, setLogLevel } from '$lib/server/logger';

const logger = createLogger('settings');

export const load: PageServerLoad = async () => {
	const settings = await getGeneralSettings();

	return {
		settings
	};
};

export const actions: Actions = {
	/**
	 * Update general settings.
	 */
	update: async ({ request }) => {
		const formData = await request.formData();

		// Parse form data
		const data = {
			appName: formData.get('appName'),
			timezone: formData.get('timezone'),
			logLevel: formData.get('logLevel'),
			checkForUpdates: formData.get('checkForUpdates') === 'on'
		};

		// Preserve form values for error display
		const formValues = {
			appName: data.appName?.toString() ?? '',
			timezone: data.timezone?.toString() ?? '',
			logLevel: data.logLevel?.toString() ?? '',
			checkForUpdates: data.checkForUpdates
		};

		// Validate form data
		const result = v.safeParse(GeneralSettingsSchema, data);
		if (!result.success) {
			const errors = result.issues.map((issue) => issue.message);
			return fail(400, {
				error: errors[0] ?? 'Invalid input',
				...formValues
			});
		}

		const config = result.output;

		// Validate timezone is valid (using Intl API)
		try {
			Intl.DateTimeFormat(undefined, { timeZone: config.timezone });
		} catch {
			return fail(400, {
				error: 'Invalid timezone selected',
				...formValues
			});
		}

		// Update the settings
		try {
			await updateGeneralSettings({
				appName: config.appName,
				timezone: config.timezone,
				logLevel: config.logLevel,
				checkForUpdates: config.checkForUpdates
			});

			// Apply log level change immediately without restart
			setLogLevel(config.logLevel as LogLevel);
		} catch (err) {
			logger.error('Failed to update settings', { error: err instanceof Error ? err.message : String(err) });
			return fail(500, {
				error: 'Failed to update settings. Please try again.',
				...formValues
			});
		}

		// Return success
		return {
			success: true,
			message: 'Settings saved successfully',
			...formValues
		};
	}
};
