import { readFile } from 'node:fs/promises';
import { sql } from 'drizzle-orm';
import { getTableColumns } from 'drizzle-orm/utils';
import { DecryptionError, decrypt } from '$lib/server/crypto';
import { db } from '$lib/server/db';
import * as schema from '$lib/server/db/schema';
import { createLogger } from '$lib/server/logger';
import { createBackup, loadBackup } from './backup-service';
import {
	type BackupFile,
	RestoreError,
	type RestoreOptions,
	type RestoreResult,
	type RestoreValidation,
	type SchemaVersion,
	SECRET_KEY_VERIFIER_PLAINTEXT,
	TABLE_DELETE_ORDER,
	type TableExport
} from './types';

const logger = createLogger('restore-service');

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

function validateFormatVersion(backup: BackupFile): boolean {
	return backup.formatVersion === 1;
}

async function validateChecksum(backup: BackupFile): Promise<boolean> {
	const encoder = new TextEncoder();
	const data = encoder.encode(JSON.stringify(backup.tables));

	const hashBuffer = await crypto.subtle.digest('SHA-256', data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

	return backup.metadata.checksum === `sha256:${hashHex}`;
}

async function validateSecretKeyMatch(secretKeyVerifier: string): Promise<boolean> {
	try {
		const decrypted = await decrypt(secretKeyVerifier);
		return decrypted === SECRET_KEY_VERIFIER_PLAINTEXT;
	} catch (error) {
		if (error instanceof DecryptionError) {
			return false;
		}
		throw error;
	}
}

async function _getCurrentSchemaVersion(): Promise<SchemaVersion> {
	try {
		const journalPath = './drizzle/meta/_journal.json';
		const journalContent = await readFile(journalPath, 'utf-8');
		const journal = JSON.parse(journalContent) as {
			entries: Array<{ idx: number; tag: string }>;
		};

		const lastEntry = journal.entries.at(-1);

		if (!lastEntry) {
			return {
				appVersion: '0.0.1',
				lastMigration: 'none',
				migrationIndex: -1
			};
		}

		return {
			appVersion: '0.0.1',
			lastMigration: lastEntry.tag,
			migrationIndex: lastEntry.idx
		};
	} catch {
		return {
			appVersion: '0.0.1',
			lastMigration: 'unknown',
			migrationIndex: -1
		};
	}
}

async function getPendingMigrations(backupSchemaVersion: SchemaVersion): Promise<string[]> {
	try {
		const journalPath = './drizzle/meta/_journal.json';
		const journalContent = await readFile(journalPath, 'utf-8');
		const journal = JSON.parse(journalContent) as {
			entries: Array<{ idx: number; tag: string }>;
		};

		return journal.entries
			.filter((entry) => entry.idx > backupSchemaVersion.migrationIndex)
			.map((entry) => entry.tag);
	} catch {
		return [];
	}
}

async function clearAllTables(): Promise<void> {
	logger.info('Clearing all tables');

	// Build list of all tables
	const tableList = TABLE_DELETE_ORDER.map((t) => `"${t}"`).join(', ');

	// TRUNCATE all tables at once with CASCADE and restart identity
	await db.execute(sql.raw(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`));

	logger.info('All tables cleared');
}

function escapeSqlValue(value: unknown): string {
	if (value === null || value === undefined) {
		return 'NULL';
	}

	if (typeof value === 'boolean') {
		return value ? 'TRUE' : 'FALSE';
	}

	if (typeof value === 'number') {
		return String(value);
	}

	if (typeof value === 'object') {
		// Handle JSON/JSONB values
		const jsonStr = JSON.stringify(value);
		// Escape single quotes by doubling them
		const escaped = jsonStr.replace(/'/g, "''");
		return `'${escaped}'::jsonb`;
	}

	if (typeof value === 'string') {
		// Check if it looks like a timestamp
		if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
			// Escape single quotes in the string
			const escaped = value.replace(/'/g, "''");
			return `'${escaped}'::timestamptz`;
		}

		// Regular string - escape single quotes
		const escaped = value.replace(/'/g, "''");
		return `'${escaped}'`;
	}

	// Fallback - convert to string and escape
	const escaped = String(value).replace(/'/g, "''");
	return `'${escaped}'`;
}

async function insertTableData(tableExport: TableExport): Promise<number> {
	const { tableName, rows } = tableExport;

	if (rows.length === 0) {
		logger.info('Table is empty', { tableName, rowCount: 0 });
		return 0;
	}

	// Verify table exists in schema
	if (!tableNameToSchema[tableName]) {
		logger.warn('Unknown table, skipping', { tableName });
		return 0;
	}

	const rawColumns = Object.keys(rows[0] as Record<string, unknown>);

	const schemaTable = tableNameToSchema[tableName];
	const schemaColumns = getTableColumns(schemaTable);

	// Build mapping from JS property key (camelCase) → SQL column name (snake_case)
	// Backup data uses JS keys from db.select(), but INSERT needs SQL column names
	const jsKeyToSqlName = new Map<string, string>();
	for (const [jsKey, col] of Object.entries(schemaColumns)) {
		jsKeyToSqlName.set(jsKey, col.name);
	}

	const invalidColumns = rawColumns.filter((c) => !jsKeyToSqlName.has(c));
	if (invalidColumns.length > 0) {
		logger.warn('Skipping unknown columns in backup data', { tableName, invalidColumns });
	}

	const validJsKeys = rawColumns.filter((c) => jsKeyToSqlName.has(c));

	if (validJsKeys.length === 0) {
		logger.warn('Table has no columns, skipping', { tableName });
		return 0;
	}

	// Build INSERT statement with OVERRIDING SYSTEM VALUE for IDENTITY columns
	// Use SQL column names for the INSERT column list
	const columnList = validJsKeys.map((k) => `"${jsKeyToSqlName.get(k)}"`).join(', ');

	// Insert in batches of 500 rows to avoid memory issues
	const BATCH_SIZE = 500;
	let insertedCount = 0;

	for (let i = 0; i < rows.length; i += BATCH_SIZE) {
		const batch = rows.slice(i, i + BATCH_SIZE);

		const valueRows = batch.map((row) => {
			const typedRow = row as Record<string, unknown>;
			const values = validJsKeys.map((jsKey) => escapeSqlValue(typedRow[jsKey]));
			return `(${values.join(', ')})`;
		});

		const insertSql = `INSERT INTO "${tableName}" (${columnList}) OVERRIDING SYSTEM VALUE VALUES ${valueRows.join(', ')}`;

		try {
			await db.execute(sql.raw(insertSql));
			insertedCount += batch.length;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			throw new RestoreError(
				`Failed to insert data into ${tableName}: ${errorMessage}`,
				'INSERT_DATA_FAILED',
				false,
				{ tableName, batchStart: i, batchSize: batch.length }
			);
		}
	}

	// Reset sequence to max ID + 1 for tables with identity columns
	// Most tables have an 'id' column that is GENERATED ALWAYS AS IDENTITY
	if (validJsKeys.includes('id')) {
		try {
			const sequenceName = `${tableName}_id_seq`;
			await db.execute(
				sql.raw(
					`SELECT setval('"${sequenceName}"', COALESCE((SELECT MAX(id) FROM "${tableName}"), 0) + 1, false)`
				)
			);
		} catch {
			// Sequence may not exist for all tables, that's ok
		}
	}

	logger.info('Table rows inserted', { tableName, rowCount: insertedCount });
	return insertedCount;
}

async function applyPendingMigrations(): Promise<number> {
	logger.info('Applying pending migrations');

	const { spawn } = await import('node:child_process');

	return new Promise((resolve, reject) => {
		const child = spawn('bunx', ['drizzle-kit', 'migrate'], {
			stdio: ['ignore', 'pipe', 'pipe'],
			env: process.env
		});

		let stdout = '';
		let stderr = '';

		child.stdout?.on('data', (data: Buffer) => {
			stdout += data.toString();
		});

		child.stderr?.on('data', (data: Buffer) => {
			stderr += data.toString();
		});

		child.on('close', (code) => {
			if (code === 0) {
				// Count migrations from output
				const migrationMatches = stdout.match(/Applied migration/gi);
				const count = migrationMatches ? migrationMatches.length : 0;
				logger.info('Migrations applied', { count });
				resolve(count);
			} else {
				reject(
					new RestoreError(
						`Database migration failed: ${stderr || stdout}`,
						'MIGRATION_FAILED',
						false,
						{ exitCode: code, stdout, stderr }
					)
				);
			}
		});

		child.on('error', (error) => {
			reject(
				new RestoreError(`Failed to run migrations: ${error.message}`, 'MIGRATION_FAILED', false, {
					error: error.message
				})
			);
		});
	});
}

async function clearSessions(): Promise<void> {
	logger.info('Clearing sessions');
	await db.delete(schema.sessions);
}

export async function validateBackup(backupId: string): Promise<RestoreValidation> {
	const errors: string[] = [];
	const warnings: string[] = [];

	logger.info('Validating backup', { backupId });

	// Load backup
	const backup = await loadBackup(backupId);

	if (!backup) {
		return {
			isValid: false,
			formatVersionValid: false,
			checksumValid: false,
			secretKeyValid: false,
			migrationsRequired: false,
			pendingMigrationCount: 0,
			pendingMigrations: [],
			errors: [`Backup not found: ${backupId}`],
			warnings: []
		};
	}

	// Validate format version
	const formatVersionValid = validateFormatVersion(backup);
	if (!formatVersionValid) {
		errors.push(`Unsupported backup format version: ${backup.formatVersion}`);
	}

	// Validate checksum (Req 33.2)
	const checksumValid = await validateChecksum(backup);
	if (!checksumValid) {
		errors.push('Backup integrity check failed: data may be corrupted');
	}

	// Validate SECRET_KEY (Req 33.3)
	const secretKeyValid = await validateSecretKeyMatch(backup.metadata.secretKeyVerifier);
	if (!secretKeyValid) {
		errors.push(
			'Backup was encrypted with a different SECRET_KEY. Cannot restore without the original SECRET_KEY used when the backup was created.'
		);
	}

	// Check table count
	if (backup.tables.length !== backup.metadata.tableCount) {
		warnings.push(
			`Table count mismatch: expected ${backup.metadata.tableCount}, found ${backup.tables.length}`
		);
	}

	// Check for pending migrations (Req 33.4)
	const pendingMigrations = await getPendingMigrations(backup.metadata.schemaVersion);
	const migrationsRequired = pendingMigrations.length > 0;

	if (migrationsRequired) {
		warnings.push(
			`Backup is from an older schema version. ${pendingMigrations.length} migration(s) will be applied after restore.`
		);
	}

	const isValid = formatVersionValid && checksumValid && secretKeyValid && errors.length === 0;

	logger.info('Validation complete', {
		backupId,
		isValid,
		errorCount: errors.length,
		warningCount: warnings.length,
		migrationsRequired
	});

	return {
		isValid,
		formatVersionValid,
		checksumValid,
		secretKeyValid,
		migrationsRequired,
		pendingMigrationCount: pendingMigrations.length,
		pendingMigrations,
		errors,
		warnings
	};
}

export async function restoreBackup(
	backupId: string,
	options: RestoreOptions = {}
): Promise<RestoreResult> {
	const startTime = Date.now();
	const {
		skipSecretKeyVerification = false,
		allowMigrations = true,
		createBackupBeforeRestore = true,
		clearSessionsAfterRestore = true
	} = options;

	logger.info('Starting restore', { backupId, options });

	let preRestoreBackupId: string | undefined;

	try {
		// 1. Load backup
		const backup = await loadBackup(backupId);

		if (!backup) {
			return {
				success: false,
				backupId,
				tablesRestored: 0,
				totalRowsInserted: 0,
				migrationsApplied: false,
				migrationCount: 0,
				durationMs: Date.now() - startTime,
				error: `Backup not found: ${backupId}`,
				errorCode: 'BACKUP_NOT_FOUND'
			};
		}

		// 2. Validate backup
		logger.info('Validating backup for restore');

		// Format version
		if (!validateFormatVersion(backup)) {
			return {
				success: false,
				backupId,
				tablesRestored: 0,
				totalRowsInserted: 0,
				migrationsApplied: false,
				migrationCount: 0,
				durationMs: Date.now() - startTime,
				error: `Unsupported backup format version: ${backup.formatVersion}`,
				errorCode: 'INVALID_FORMAT'
			};
		}

		// Checksum (Req 33.2)
		const checksumValid = await validateChecksum(backup);
		if (!checksumValid) {
			return {
				success: false,
				backupId,
				tablesRestored: 0,
				totalRowsInserted: 0,
				migrationsApplied: false,
				migrationCount: 0,
				durationMs: Date.now() - startTime,
				error: 'Backup integrity check failed: data may be corrupted',
				errorCode: 'CHECKSUM_MISMATCH'
			};
		}

		// SECRET_KEY (Req 33.3)
		if (!skipSecretKeyVerification) {
			const secretKeyValid = await validateSecretKeyMatch(backup.metadata.secretKeyVerifier);
			if (!secretKeyValid) {
				return {
					success: false,
					backupId,
					tablesRestored: 0,
					totalRowsInserted: 0,
					migrationsApplied: false,
					migrationCount: 0,
					durationMs: Date.now() - startTime,
					error:
						'Backup was encrypted with a different SECRET_KEY. Cannot restore without the original SECRET_KEY used when the backup was created.',
					errorCode: 'SECRET_KEY_MISMATCH'
				};
			}
		}

		// Check migrations (Req 33.4)
		const pendingMigrations = await getPendingMigrations(backup.metadata.schemaVersion);
		const migrationsRequired = pendingMigrations.length > 0;

		if (migrationsRequired && !allowMigrations) {
			return {
				success: false,
				backupId,
				tablesRestored: 0,
				totalRowsInserted: 0,
				migrationsApplied: false,
				migrationCount: 0,
				durationMs: Date.now() - startTime,
				error: `Backup requires ${pendingMigrations.length} migration(s) but allowMigrations is false`,
				errorCode: 'SCHEMA_INCOMPATIBLE'
			};
		}

		// 3. Create pre-restore backup
		if (createBackupBeforeRestore) {
			logger.info('Creating pre-restore backup');
			const preRestoreResult = await createBackup({
				description: `Pre-restore backup before restoring ${backupId}`,
				type: 'manual'
			});

			if (preRestoreResult.success && preRestoreResult.metadata) {
				preRestoreBackupId = preRestoreResult.metadata.id;
				logger.info('Pre-restore backup created', { preRestoreBackupId });
			} else {
				logger.warn('Failed to create pre-restore backup', { error: preRestoreResult.error });
			}
		}

		// 4. Clear all existing data
		logger.info('Clearing existing data');
		try {
			await clearAllTables();
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				backupId,
				preRestoreBackupId,
				tablesRestored: 0,
				totalRowsInserted: 0,
				migrationsApplied: false,
				migrationCount: 0,
				durationMs: Date.now() - startTime,
				error: `Failed to clear existing data: ${errorMessage}`,
				errorCode: 'CLEAR_DATA_FAILED'
			};
		}

		// 5. Insert backup data
		logger.info('Inserting backup data');
		let totalRowsInserted = 0;
		let tablesRestored = 0;

		for (const tableExport of backup.tables) {
			try {
				const rowsInserted = await insertTableData(tableExport);
				totalRowsInserted += rowsInserted;
				tablesRestored++;
			} catch (error) {
				if (error instanceof RestoreError) {
					return {
						success: false,
						backupId,
						preRestoreBackupId,
						tablesRestored,
						totalRowsInserted,
						migrationsApplied: false,
						migrationCount: 0,
						durationMs: Date.now() - startTime,
						error: error.message,
						errorCode: error.code
					};
				}
				throw error;
			}
		}

		// 6. Apply pending migrations (Req 33.4)
		let migrationCount = 0;
		if (migrationsRequired) {
			logger.info('Applying migrations');
			try {
				migrationCount = await applyPendingMigrations();
			} catch (error) {
				if (error instanceof RestoreError) {
					return {
						success: false,
						backupId,
						preRestoreBackupId,
						tablesRestored,
						totalRowsInserted,
						migrationsApplied: false,
						migrationCount: 0,
						durationMs: Date.now() - startTime,
						error: error.message,
						errorCode: error.code
					};
				}
				throw error;
			}
		}

		// 7. Clear sessions if requested
		if (clearSessionsAfterRestore) {
			await clearSessions();
		}

		const durationMs = Date.now() - startTime;

		logger.info('Restore completed successfully', {
			backupId,
			tablesRestored,
			totalRowsInserted,
			migrationsApplied: migrationsRequired,
			migrationCount,
			durationMs
		});

		return {
			success: true,
			backupId,
			preRestoreBackupId,
			tablesRestored,
			totalRowsInserted,
			migrationsApplied: migrationsRequired,
			migrationCount,
			durationMs
		};
	} catch (error) {
		const durationMs = Date.now() - startTime;
		const errorMessage = error instanceof Error ? error.message : String(error);

		logger.error('Restore failed', {
			backupId,
			error: errorMessage,
			durationMs
		});

		return {
			success: false,
			backupId,
			preRestoreBackupId,
			tablesRestored: 0,
			totalRowsInserted: 0,
			migrationsApplied: false,
			migrationCount: 0,
			durationMs,
			error: errorMessage,
			errorCode: 'TRANSACTION_FAILED'
		};
	}
}
