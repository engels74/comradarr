/**
 * Backup service for database export.
 *
 * Provides:
 * - Database backup creation (export all tables to JSON)
 * - Backup listing and management
 * - Integrity verification with SHA-256 checksum
 * - SECRET_KEY verification for restore compatibility
 *
 * Usage:
 * ```typescript
 * import { createBackup, listBackups, loadBackup, deleteBackup } from '$lib/server/services/backup';
 *
 * // Create a new backup
 * const result = await createBackup({ description: 'Before upgrade' });
 * if (result.success) {
 *   console.log('Backup saved to:', result.filePath);
 * }
 *
 * // List all backups
 * const backups = await listBackups();
 *
 * // Load a specific backup
 * const backup = await loadBackup('backup-id');
 *
 * // Delete a backup
 * await deleteBackup('backup-id');
 * ```
 *
 * @module services/backup
 * @requirements 33.1
 */

// =============================================================================
// Types
// =============================================================================

export type {
	BackupFile,
	BackupInfo,
	BackupMetadata,
	BackupOptions,
	BackupResult,
	SchemaVersion,
	TableExport
} from './types';

export { BackupError, SECRET_KEY_VERIFIER_PLAINTEXT, TABLE_EXPORT_ORDER } from './types';

// =============================================================================
// Services
// =============================================================================

export {
	createBackup,
	deleteBackup,
	getBackupInfo,
	listBackups,
	loadBackup
} from './backup-service';
