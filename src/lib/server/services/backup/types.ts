/**
 * Types for the backup service.
 *
 * @module services/backup/types
 * @requirements 33.1
 */

// =============================================================================
// Schema Version Types
// =============================================================================

/**
 * Schema version tracking for migrations during restore.
 */
export interface SchemaVersion {
	/** Application version at backup time (e.g., "0.0.1") */
	appVersion: string;

	/** Last applied Drizzle migration tag (e.g., "20251205072905_chemical_shard") */
	lastMigration: string;

	/** Migration index for ordering */
	migrationIndex: number;
}

// =============================================================================
// Backup Metadata Types
// =============================================================================

/**
 * Backup file metadata stored in the backup header.
 */
export interface BackupMetadata {
	/** Unique backup identifier (UUID) */
	id: string;

	/** ISO timestamp when backup was created */
	createdAt: string;

	/** Schema version information */
	schemaVersion: SchemaVersion;

	/** SHA-256 checksum of backup data (tables array) */
	checksum: string;

	/** Test encrypted value for SECRET_KEY validation on restore */
	secretKeyVerifier: string;

	/** Human-readable backup description */
	description?: string;

	/** Whether this was a manual or scheduled backup */
	type: 'manual' | 'scheduled';

	/** Total table count for validation */
	tableCount: number;
}

// =============================================================================
// Table Export Types
// =============================================================================

/**
 * Table data export format.
 * Each table's data is stored as an array of row objects.
 */
export interface TableExport {
	/** Table name (e.g., "connectors", "users") */
	tableName: string;

	/** Number of rows exported */
	rowCount: number;

	/** Row data (column values preserved as-is) */
	rows: Record<string, unknown>[];
}

// =============================================================================
// Backup File Structure
// =============================================================================

/**
 * Complete backup file structure.
 */
export interface BackupFile {
	/** Format version for backward compatibility */
	formatVersion: 1;

	/** Backup metadata */
	metadata: BackupMetadata;

	/** Table data exports */
	tables: TableExport[];
}

// =============================================================================
// Result Types
// =============================================================================

/**
 * Result of a backup creation operation.
 */
export interface BackupResult {
	/** Whether the backup completed successfully */
	success: boolean;

	/** Backup metadata if successful */
	metadata?: BackupMetadata;

	/** Path to backup file if stored locally */
	filePath?: string;

	/** Backup file size in bytes */
	fileSizeBytes?: number;

	/** Duration of backup operation in milliseconds */
	durationMs: number;

	/** Error message if backup failed */
	error?: string;
}

/**
 * Information about an existing backup file.
 */
export interface BackupInfo {
	/** Backup ID (from metadata) */
	id: string;

	/** File path */
	filePath: string;

	/** Backup metadata */
	metadata: BackupMetadata;

	/** File size in bytes */
	fileSizeBytes: number;
}

/**
 * Options for creating a backup.
 */
export interface BackupOptions {
	/** Human-readable description of the backup */
	description?: string | undefined;

	/** Whether this is a manual or scheduled backup */
	type?: 'manual' | 'scheduled' | undefined;
}

// =============================================================================
// Error Types
// =============================================================================

/**
 * Backup-specific error codes.
 */
export type BackupErrorCode =
	| 'EXPORT_FAILED'
	| 'CHECKSUM_FAILED'
	| 'STORAGE_FAILED'
	| 'ENCRYPTION_FAILED'
	| 'SCHEMA_VERSION_FAILED'
	| 'NOT_FOUND';

/**
 * Backup-specific error class.
 */
export class BackupError extends Error {
	constructor(
		message: string,
		public readonly code: BackupErrorCode,
		public readonly recoverable: boolean = false
	) {
		super(message);
		this.name = 'BackupError';
	}
}

// =============================================================================
// Table Export Order
// =============================================================================

/**
 * Tables to export in dependency order.
 * Tables with foreign keys are exported after their dependencies.
 *
 * This order ensures that when importing:
 * 1. Independent tables are imported first
 * 2. Tables with foreign keys are imported after their referenced tables
 */
export const TABLE_EXPORT_ORDER = [
	// Independent tables (no foreign keys)
	'throttle_profiles',
	'app_settings',
	'users',

	// Tables depending on throttle_profiles
	'connectors',
	'sweep_schedules',

	// Tables depending on connectors
	'throttle_state',
	'series',
	'movies',
	'sync_state',
	'completion_snapshots',
	'analytics_events',
	'analytics_hourly_stats',
	'analytics_daily_stats',

	// Tables depending on series
	'seasons',

	// Tables depending on seasons
	'episodes',

	// Tables depending on content (episodes/movies)
	'search_registry',

	// Tables depending on search_registry
	'request_queue',
	'search_history',

	// Tables depending on users
	'sessions',

	// Prowlarr tables
	'prowlarr_instances',
	'prowlarr_indexer_health',

	// Notification tables
	'notification_channels',
	'notification_history'
] as const;

/**
 * Known value used for SECRET_KEY verification.
 * This value is encrypted during backup and decrypted during restore
 * to verify that the same SECRET_KEY is being used.
 */
export const SECRET_KEY_VERIFIER_PLAINTEXT = 'comradarr-backup-verify';

/**
 * Tables to delete in reverse dependency order (for clearing before restore).
 * This is the reverse of TABLE_EXPORT_ORDER.
 */
export const TABLE_DELETE_ORDER = [...TABLE_EXPORT_ORDER].reverse();

// =============================================================================
// Restore Types
// =============================================================================

/**
 * Restore-specific error codes.
 * @requirements 33.2, 33.3, 33.4
 */
export type RestoreErrorCode =
	| 'BACKUP_NOT_FOUND'
	| 'INVALID_FORMAT'
	| 'CHECKSUM_MISMATCH'
	| 'SECRET_KEY_MISMATCH'
	| 'SCHEMA_INCOMPATIBLE'
	| 'MIGRATION_FAILED'
	| 'TRANSACTION_FAILED'
	| 'CLEAR_DATA_FAILED'
	| 'INSERT_DATA_FAILED'
	| 'VALIDATION_FAILED';

/**
 * Restore-specific error class.
 */
export class RestoreError extends Error {
	constructor(
		message: string,
		public readonly code: RestoreErrorCode,
		public readonly recoverable: boolean = false,
		public readonly details?: Record<string, unknown>
	) {
		super(message);
		this.name = 'RestoreError';
	}
}

/**
 * Options for restore operation.
 */
export interface RestoreOptions {
	/** Skip SECRET_KEY verification (not recommended, for recovery scenarios only) */
	skipSecretKeyVerification?: boolean;

	/** Force restore even if schema versions don't match (requires migrations) */
	allowMigrations?: boolean;

	/** Create a backup before restoring (recommended) */
	createBackupBeforeRestore?: boolean;

	/** Clear sessions after restore (invalidate all logins) */
	clearSessionsAfterRestore?: boolean;
}

/**
 * Result of backup validation before restore.
 * @requirements 33.2, 33.3, 33.4
 */
export interface RestoreValidation {
	/** Whether the backup is valid for restore */
	isValid: boolean;

	/** Format version check */
	formatVersionValid: boolean;

	/** Checksum integrity check (Req 33.2) */
	checksumValid: boolean;

	/** SECRET_KEY compatibility check (Req 33.3) */
	secretKeyValid: boolean;

	/** Whether migrations are required (Req 33.4) */
	migrationsRequired: boolean;

	/** Number of pending migrations */
	pendingMigrationCount: number;

	/** List of pending migration tags */
	pendingMigrations: string[];

	/** Any validation errors */
	errors: string[];

	/** Any validation warnings */
	warnings: string[];
}

/**
 * Result of a restore operation.
 */
export interface RestoreResult {
	/** Whether the restore completed successfully */
	success: boolean;

	/** Backup ID that was restored */
	backupId: string;

	/** ID of pre-restore backup if created */
	preRestoreBackupId?: string | undefined;

	/** Number of tables restored */
	tablesRestored: number;

	/** Total rows inserted */
	totalRowsInserted: number;

	/** Whether migrations were applied */
	migrationsApplied: boolean;

	/** Number of migrations applied */
	migrationCount: number;

	/** Duration of restore operation in milliseconds */
	durationMs: number;

	/** Error message if restore failed */
	error?: string | undefined;

	/** Error code if restore failed */
	errorCode?: RestoreErrorCode | undefined;
}
