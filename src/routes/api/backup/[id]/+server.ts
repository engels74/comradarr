/**
 * API endpoints for individual backup management.
 *
 * GET /api/backup/[id] - Download a backup file
 * DELETE /api/backup/[id] - Delete a backup
 *

 */

import { error, json } from '@sveltejs/kit';
import { requireScope } from '$lib/server/auth';
import { deleteBackup, getBackupInfo, loadBackup } from '$lib/server/services/backup';
import type { RequestHandler } from './$types';

/**
 * GET /api/backup/[id]
 *
 * Downloads a backup file.
 *
 * Path Parameters:
 * - id: Backup ID (UUID)
 *
 * Returns:
 * - 200: JSON backup file (Content-Disposition: attachment)
 * - 401: Not authenticated
 * - 404: Backup not found
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	requireScope(locals, 'read');

	const { id } = params;

	const backup = await loadBackup(id);

	if (!backup) {
		error(404, 'Backup not found');
	}

	const filename = `comradarr-backup-${id}.json`;
	const backupJson = JSON.stringify(backup, null, 2);

	return new Response(backupJson, {
		headers: {
			'Content-Type': 'application/json; charset=utf-8',
			'Content-Disposition': `attachment; filename="${filename}"`,
			'Cache-Control': 'no-cache'
		}
	});
};

/**
 * DELETE /api/backup/[id]
 *
 * Deletes a backup.
 *
 * Path Parameters:
 * - id: Backup ID (UUID)
 *
 * Returns:
 * - 200: Success confirmation
 * - 401: Not authenticated
 * - 403: Insufficient scope (API key with read-only access)
 * - 404: Backup not found
 */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	requireScope(locals, 'full');

	const { id } = params;

	// Check if backup exists first
	const backupInfo = await getBackupInfo(id);

	if (!backupInfo) {
		error(404, 'Backup not found');
	}

	const deleted = await deleteBackup(id);

	if (!deleted) {
		error(500, 'Failed to delete backup');
	}

	return json({
		success: true,
		message: `Backup ${id} deleted`
	});
};
