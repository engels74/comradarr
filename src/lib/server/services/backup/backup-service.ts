/**
 * Backup service for database export.
 *
 * Exports all database tables to a downloadable JSON file with:
 * - All table data in dependency order
 * - Encrypted fields preserved (already safe with AES-256-GCM)
 * - Schema version for migration detection
 * - SECRET_KEY verifier for restore validation
 * - SHA-256 checksum for integrity
 *
 * @module services/backup/backup-service

 */

import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { encrypt } from '$lib/server/crypto';
import { db } from '$lib/server/db';
// Import schema tables for dynamic querying
import * as schema from '$lib/server/db/schema';
import { createLogger } from '$lib/server/logger';
import {
	BackupError,
	type BackupFile,
	type BackupInfo,
	type BackupMetadata,
	type BackupOptions,
	type BackupResult,
	type SchemaVersion,
	SECRET_KEY_VERIFIER_PLAINTEXT,
	TABLE_EXPORT_ORDER,
	type TableExport
} from './types';

const logger = createLogger('backup');

// =============================================================================
// Configuration
// =============================================================================

/** Default backup directory relative to project root */
const DEFAULT_BACKUP_DIR = './backups';

/** Backup file extension */
const BACKUP_EXTENSION = '.json';

/** Application version for schema tracking */
const APP_VERSION = '0.0.1';

// =============================================================================
// Table Name to Schema Mapping
// =============================================================================

/**
 * Maps table names to Drizzle schema table objects.
 * Uses snake_case table names as stored in the database.
 */
const tableNameToSchema: Record<string, (typeof schema)[keyof typeof schema]> = {
	throttle_profiles: schema.throttleProfiles,
	app_settings: schema.appSettings,
	users: schema.users,
	connectors: schema.connectors,
	sweep_schedules: schema.sweepSchedules,
	throttle_state: schema.throttleState,
	series: schema.series,
	movies: schema.movies,
	sync_state: schema.syncState,
	completion_snapshots: schema.completionSnapshots,
	analytics_events: schema.analyticsEvents,
	analytics_hourly_stats: schema.analyticsHourlyStats,
	analytics_daily_stats: schema.analyticsDailyStats,
	seasons: schema.seasons,
	episodes: schema.episodes,
	search_registry: schema.searchRegistry,
	request_queue: schema.requestQueue,
	search_history: schema.searchHistory,
	sessions: schema.sessions,
	prowlarr_instances: schema.prowlarrInstances,
	prowlarr_indexer_health: schema.prowlarrIndexerHealth,
	notification_channels: schema.notificationChannels,
	notification_history: schema.notificationHistory
};

// =============================================================================
// Internal Helpers
// =============================================================================

/**
 * Gets the backup directory path.
 * Creates the directory if it doesn't exist.
 */
async function getBackupDirectory(): Promise<string> {
	const backupDir = DEFAULT_BACKUP_DIR;

	try {
		await mkdir(backupDir, { recursive: true });
	} catch {
		// Directory may already exist
	}

	return backupDir;
}

/**
 * Generates backup filename from backup ID.
 */
function getBackupFilename(backupId: string): string {
	return `comradarr-backup-${backupId}${BACKUP_EXTENSION}`;
}

/**
 * Exports a single table's data.
 *
 * @param tableName - The table name (snake_case)
 * @returns TableExport with all rows
 */
async function exportTable(tableName: string): Promise<TableExport> {
	const schemaTable = tableNameToSchema[tableName];

	if (!schemaTable) {
		throw new BackupError(`Unknown table: ${tableName}`, 'EXPORT_FAILED', false);
	}

	// Export all rows from the table
	// biome-ignore lint/suspicious/noExplicitAny: dynamic table selection requires type assertion
	const rows = await db.select().from(schemaTable as any);

	return {
		tableName,
		rowCount: rows.length,
		rows: rows as Record<string, unknown>[]
	};
}

/**
 * Generates SHA-256 checksum of the tables array.
 * Uses Web Crypto API for consistent hashing.
 *
 * @param tables - Array of table exports
 * @returns Checksum string prefixed with "sha256:"
 */
async function generateChecksum(tables: TableExport[]): Promise<string> {
	const encoder = new TextEncoder();
	const data = encoder.encode(JSON.stringify(tables));

	const hashBuffer = await crypto.subtle.digest('SHA-256', data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

	return `sha256:${hashHex}`;
}

/**
 * Creates the SECRET_KEY verifier by encrypting a known value.
 * On restore, this can be decrypted to verify the SECRET_KEY matches.
 *
 * @returns Encrypted verifier string (iv:authTag:ciphertext format)
 */
async function createSecretKeyVerifier(): Promise<string> {
	return encrypt(SECRET_KEY_VERIFIER_PLAINTEXT);
}

/**
 * Gets the current schema version from Drizzle migration journal.
 *
 * @returns Schema version information
 */
async function getSchemaVersion(): Promise<SchemaVersion> {
	try {
		const journalPath = './drizzle/meta/_journal.json';
		const journalContent = await readFile(journalPath, 'utf-8');
		const journal = JSON.parse(journalContent) as {
			entries: Array<{ idx: number; tag: string }>;
		};

		// Get the last migration entry
		const lastEntry = journal.entries.at(-1);

		if (!lastEntry) {
			return {
				appVersion: APP_VERSION,
				lastMigration: 'none',
				migrationIndex: -1
			};
		}

		return {
			appVersion: APP_VERSION,
			lastMigration: lastEntry.tag,
			migrationIndex: lastEntry.idx
		};
	} catch {
		// If journal doesn't exist, return defaults
		return {
			appVersion: APP_VERSION,
			lastMigration: 'unknown',
			migrationIndex: -1
		};
	}
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Creates a backup of all database tables.
 *
 * Exports all 21 tables in dependency order with:
 * - Full row data (encrypted fields remain encrypted)
 * - SHA-256 checksum for integrity verification
 * - SECRET_KEY verifier for restore validation
 * - Schema version for migration detection
 *
 * @param options - Optional backup configuration
 * @returns BackupResult with success status and metadata
 *

 *
 * @example
 * ```typescript
 * const result = await createBackup({ description: 'Before upgrade' });
 * if (result.success) {
 *   console.log('Backup created:', result.filePath);
 * }
 * ```
 */
export async function createBackup(options?: BackupOptions): Promise<BackupResult> {
	const startTime = Date.now();
	const backupId = crypto.randomUUID();

	logger.info('Starting database backup', { backupId });

	try {
		// 1. Export all tables in dependency order
		logger.info('Exporting tables');
		const tables: TableExport[] = [];

		for (const tableName of TABLE_EXPORT_ORDER) {
			const tableExport = await exportTable(tableName);
			tables.push(tableExport);
			logger.info('Exported table', { tableName, rowCount: tableExport.rowCount });
		}

		// 2. Generate checksum
		logger.info('Generating checksum');
		const checksum = await generateChecksum(tables);

		// 3. Create SECRET_KEY verifier
		logger.info('Creating SECRET_KEY verifier');
		const secretKeyVerifier = await createSecretKeyVerifier();

		// 4. Get schema version
		const schemaVersion = await getSchemaVersion();

		// 5. Create backup file structure
		const metadata: BackupMetadata = {
			id: backupId,
			createdAt: new Date().toISOString(),
			schemaVersion,
			checksum,
			secretKeyVerifier,
			...(options?.description !== undefined && { description: options.description }),
			type: options?.type ?? 'manual',
			tableCount: tables.length
		};

		const backupFile: BackupFile = {
			formatVersion: 1,
			metadata,
			tables
		};

		// 6. Save to file
		const backupDir = await getBackupDirectory();
		const filename = getBackupFilename(backupId);
		const filePath = join(backupDir, filename);

		logger.info('Saving backup to file', { filePath });
		const backupJson = JSON.stringify(backupFile, null, 2);
		await writeFile(filePath, backupJson, 'utf-8');

		// Get file size
		const fileStats = await stat(filePath);
		const fileSizeBytes = fileStats.size;

		const durationMs = Date.now() - startTime;

		logger.info('Backup completed successfully', {
			backupId,
			filePath,
			fileSizeBytes,
			tableCount: tables.length,
			totalRows: tables.reduce((sum, t) => sum + t.rowCount, 0),
			durationMs
		});

		return {
			success: true,
			metadata,
			filePath,
			fileSizeBytes,
			durationMs
		};
	} catch (error) {
		const durationMs = Date.now() - startTime;
		const errorMessage = error instanceof Error ? error.message : String(error);

		logger.error('Backup failed', {
			backupId,
			error: errorMessage,
			durationMs
		});

		return {
			success: false,
			durationMs,
			error: errorMessage
		};
	}
}

/**
 * Lists all available backups in the backup directory.
 *
 * @returns Array of backup information
 *
 * @example
 * ```typescript
 * const backups = await listBackups();
 * for (const backup of backups) {
 *   console.log(backup.metadata.createdAt, backup.fileSizeBytes);
 * }
 * ```
 */
export async function listBackups(): Promise<BackupInfo[]> {
	const backupDir = await getBackupDirectory();
	const backups: BackupInfo[] = [];

	try {
		const files = await readdir(backupDir);

		for (const file of files) {
			if (!file.endsWith(BACKUP_EXTENSION) || !file.startsWith('comradarr-backup-')) {
				continue;
			}

			try {
				const filePath = join(backupDir, file);
				const content = await readFile(filePath, 'utf-8');
				const backup = JSON.parse(content) as BackupFile;
				const fileStats = await stat(filePath);

				backups.push({
					id: backup.metadata.id,
					filePath,
					metadata: backup.metadata,
					fileSizeBytes: fileStats.size
				});
			} catch {
				// Skip invalid backup files
				logger.warn('Skipping invalid backup file', { file });
			}
		}

		// Sort by creation date (newest first)
		backups.sort(
			(a, b) => new Date(b.metadata.createdAt).getTime() - new Date(a.metadata.createdAt).getTime()
		);

		return backups;
	} catch {
		// Backup directory may not exist
		return [];
	}
}

/**
 * Loads a backup by ID.
 *
 * @param backupId - The backup ID
 * @returns BackupFile or null if not found
 *
 * @example
 * ```typescript
 * const backup = await loadBackup('550e8400-e29b-41d4-a716-446655440000');
 * if (backup) {
 *   console.log('Loaded backup with', backup.tables.length, 'tables');
 * }
 * ```
 */
export async function loadBackup(backupId: string): Promise<BackupFile | null> {
	const backupDir = await getBackupDirectory();
	const filename = getBackupFilename(backupId);
	const filePath = join(backupDir, filename);

	try {
		const content = await readFile(filePath, 'utf-8');
		return JSON.parse(content) as BackupFile;
	} catch {
		return null;
	}
}

/**
 * Deletes a backup by ID.
 *
 * @param backupId - The backup ID to delete
 * @returns True if deleted, false if not found
 *
 * @example
 * ```typescript
 * const deleted = await deleteBackup('550e8400-e29b-41d4-a716-446655440000');
 * if (deleted) {
 *   console.log('Backup deleted');
 * }
 * ```
 */
export async function deleteBackup(backupId: string): Promise<boolean> {
	const backupDir = await getBackupDirectory();
	const filename = getBackupFilename(backupId);
	const filePath = join(backupDir, filename);

	try {
		await rm(filePath);
		logger.info('Deleted backup', { backupId, filePath });
		return true;
	} catch {
		return false;
	}
}

/**
 * Gets a backup's file size and path by ID.
 *
 * @param backupId - The backup ID
 * @returns Backup info or null if not found
 */
export async function getBackupInfo(backupId: string): Promise<BackupInfo | null> {
	const backupDir = await getBackupDirectory();
	const filename = getBackupFilename(backupId);
	const filePath = join(backupDir, filename);

	try {
		const content = await readFile(filePath, 'utf-8');
		const backup = JSON.parse(content) as BackupFile;
		const fileStats = await stat(filePath);

		return {
			id: backup.metadata.id,
			filePath,
			metadata: backup.metadata,
			fileSizeBytes: fileStats.size
		};
	} catch {
		return null;
	}
}

// =============================================================================
// Scheduled Backup Cleanup
// =============================================================================

/**
 * Result of scheduled backup cleanup operation.
 */
export interface CleanupResult {
	/** Whether the cleanup completed successfully */
	success: boolean;
	/** Number of scheduled backups deleted */
	deletedCount: number;
	/** Error message if cleanup failed */
	error?: string;
}

/**
 * Cleans up old scheduled backups, keeping only the most recent ones.
 *
 * Only deletes backups with type: 'scheduled'. Manual backups are preserved.
 *
 * @param retentionCount - Number of scheduled backups to retain
 * @returns CleanupResult with success status and deleted count
 *

 *
 * @example
 * ```typescript
 * const result = await cleanupOldScheduledBackups(7);
 * if (result.success) {
 *   console.log('Deleted', result.deletedCount, 'old scheduled backups');
 * }
 * ```
 */
export async function cleanupOldScheduledBackups(retentionCount: number): Promise<CleanupResult> {
	try {
		// Get all backups
		const allBackups = await listBackups();

		// Filter to only scheduled backups
		const scheduledBackups = allBackups.filter((backup) => backup.metadata.type === 'scheduled');

		// If we have fewer or equal to retention count, nothing to delete
		if (scheduledBackups.length <= retentionCount) {
			return {
				success: true,
				deletedCount: 0
			};
		}

		// Backups are already sorted by creation date (newest first)
		// Delete backups beyond the retention count
		const backupsToDelete = scheduledBackups.slice(retentionCount);
		let deletedCount = 0;

		for (const backup of backupsToDelete) {
			const deleted = await deleteBackup(backup.id);
			if (deleted) {
				deletedCount++;
				logger.info('Cleaned up old scheduled backup', {
					backupId: backup.id,
					createdAt: backup.metadata.createdAt
				});
			}
		}

		logger.info('Scheduled backup cleanup completed', {
			totalScheduled: scheduledBackups.length,
			retained: retentionCount,
			deleted: deletedCount
		});

		return {
			success: true,
			deletedCount
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		logger.error('Scheduled backup cleanup failed', { error: errorMessage });

		return {
			success: false,
			deletedCount: 0,
			error: errorMessage
		};
	}
}
