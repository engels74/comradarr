/**
 * Backup settings page server load and actions.
 */

import type { PageServerLoad, Actions } from './$types';
import {
	getBackupSettings,
	updateBackupSettings,
	type BackupSettings
} from '$lib/server/db/queries/settings';
import { listBackups, deleteBackup } from '$lib/server/services/backup';
import { refreshScheduledBackup, getSchedulerStatus } from '$lib/server/scheduler';
import { fail } from '@sveltejs/kit';
import * as v from 'valibot';
import { BackupSettingsSchema } from '$lib/schemas/settings';
import { createLogger } from '$lib/server/logger';

const logger = createLogger('backup-settings');

export const load: PageServerLoad = async () => {
	const [settings, backups, schedulerStatus] = await Promise.all([
		getBackupSettings(),
		listBackups(),
		Promise.resolve(getSchedulerStatus())
	]);

	// Get next scheduled backup time from scheduler status
	const nextBackupRun = schedulerStatus.scheduledBackup?.nextRun ?? null;

	return {
		settings,
		backups: backups.map((backup) => ({
			id: backup.id,
			createdAt: backup.metadata.createdAt,
			description: backup.metadata.description,
			type: backup.metadata.type,
			tableCount: backup.metadata.tableCount,
			fileSizeBytes: backup.fileSizeBytes,
			schemaVersion: backup.metadata.schemaVersion
		})),
		nextBackupRun: nextBackupRun?.toISOString() ?? null
	};
};

export const actions: Actions = {
	/**
	 * Update backup settings.
	 */
	update: async ({ request }) => {
		const formData = await request.formData();

		// Parse form data
		const data = {
			scheduledEnabled: formData.get('scheduledEnabled') === 'on',
			scheduledCron: formData.get('scheduledCron'),
			retentionCount: Number(formData.get('retentionCount'))
		};

		// Preserve form values for error display
		const formValues = {
			scheduledEnabled: data.scheduledEnabled,
			scheduledCron: data.scheduledCron?.toString() ?? '',
			retentionCount: data.retentionCount
		};

		// Validate form data
		const result = v.safeParse(BackupSettingsSchema, data);
		if (!result.success) {
			const errors = result.issues.map((issue) => issue.message);
			return fail(400, {
				error: errors[0] ?? 'Invalid input',
				...formValues
			});
		}

		const config = result.output;

		// Update the settings
		try {
			await updateBackupSettings({
				scheduledEnabled: config.scheduledEnabled,
				scheduledCron: config.scheduledCron,
				retentionCount: config.retentionCount
			});

			// Refresh the scheduled backup job with new settings
			await refreshScheduledBackup();
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
			message: 'Backup settings saved successfully',
			...formValues
		};
	},

	/**
	 * Delete a backup.
	 */
	delete: async ({ request }) => {
		const formData = await request.formData();
		const backupId = formData.get('backupId')?.toString();

		if (!backupId) {
			return fail(400, { deleteError: 'Backup ID is required' });
		}

		try {
			const deleted = await deleteBackup(backupId);
			if (!deleted) {
				return fail(404, { deleteError: 'Backup not found' });
			}
		} catch (err) {
			logger.error('Failed to delete backup', { error: err instanceof Error ? err.message : String(err) });
			return fail(500, { deleteError: 'Failed to delete backup. Please try again.' });
		}

		return {
			deleteSuccess: true,
			deleteMessage: 'Backup deleted successfully'
		};
	}
};
