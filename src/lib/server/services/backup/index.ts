/**
 * Backup and restore services for database management.
 *
 * Provides:
 * - Database backup creation (export all tables to JSON)
 * - Database restore from backup files
 * - Backup listing and management
 * - Integrity verification with SHA-256 checksum
 * - SECRET_KEY verification for restore compatibility
 * - Migration support for older backups
 *
 * Usage:
 * ```typescript
 * import {
 *   createBackup, listBackups, loadBackup, deleteBackup,
 *   validateBackup, restoreBackup
 * } from '$lib/server/services/backup';
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
 * // Validate a backup before restore
 * const validation = await validateBackup('backup-id');
 * if (validation.isValid) {
 *   // Restore the backup
 *   const restoreResult = await restoreBackup('backup-id');
 * }
 *
 * // Delete a backup
 * await deleteBackup('backup-id');
 * ```
 *
 * @module services/backup
 * @requirements 33.1, 33.2, 33.3, 33.4
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
	RestoreOptions,
	RestoreResult,
	RestoreValidation,
	SchemaVersion,
	TableExport
} from './types';

export {
	BackupError,
	RestoreError,
	SECRET_KEY_VERIFIER_PLAINTEXT,
	TABLE_DELETE_ORDER,
	TABLE_EXPORT_ORDER
} from './types';

// =============================================================================
// Backup Services
// =============================================================================

export {
	cleanupOldScheduledBackups,
	createBackup,
	deleteBackup,
	getBackupInfo,
	listBackups,
	loadBackup,
	type CleanupResult
} from './backup-service';

// =============================================================================
// Restore Services
// =============================================================================

export { restoreBackup, validateBackup } from './restore-service';
