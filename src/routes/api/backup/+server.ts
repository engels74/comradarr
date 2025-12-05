/**
 * API endpoints for backup management.
 *
 * POST /api/backup - Create a new backup
 * GET /api/backup - List all available backups
 *
 * @requirements 33.1
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createBackup, listBackups } from '$lib/server/services/backup';

/**
 * POST /api/backup
 *
 * Creates a new database backup.
 *
 * Request Body (optional):
 * - description: Human-readable description of the backup
 *
 * Returns:
 * - 200: Backup metadata on success
 * - 500: Error message on failure
 */
export const POST: RequestHandler = async ({ request }) => {
	let description: string | undefined;

	try {
		const body = await request.json().catch(() => ({}));
		description = body.description;
	} catch {
		// Body is optional
	}

	const result = await createBackup({
		...(description !== undefined && { description }),
		type: 'manual'
	});

	if (!result.success) {
		error(500, result.error ?? 'Backup failed');
	}

	return json({
		success: true,
		metadata: result.metadata,
		filePath: result.filePath,
		fileSizeBytes: result.fileSizeBytes,
		durationMs: result.durationMs
	});
};

/**
 * GET /api/backup
 *
 * Lists all available backups sorted by creation date (newest first).
 *
 * Returns:
 * - 200: Array of backup info objects
 */
export const GET: RequestHandler = async () => {
	const backups = await listBackups();

	return json({
		backups: backups.map((backup) => ({
			id: backup.id,
			createdAt: backup.metadata.createdAt,
			description: backup.metadata.description,
			type: backup.metadata.type,
			tableCount: backup.metadata.tableCount,
			fileSizeBytes: backup.fileSizeBytes,
			schemaVersion: backup.metadata.schemaVersion
		}))
	});
};
