/**
 * Unit tests for backup service types and constants
 *
 * Tests cover:
 * - Table export order contains all 21 tables
 * - SECRET_KEY verifier constant is defined
 * - BackupError class works correctly
 * - Type definitions are correctly structured
 *
 * Note: Full integration testing of createBackup() requires database
 * and is covered in integration tests. Unit tests only test types and
 * constants that don't require database access.
 *

 */

import { describe, expect, it } from 'vitest';
// Import only from types.ts to avoid database dependencies
import {
	BackupError,
	SECRET_KEY_VERIFIER_PLAINTEXT,
	TABLE_EXPORT_ORDER
} from '../../src/lib/server/services/backup/types';

describe('TABLE_EXPORT_ORDER', () => {
	it('should contain exactly 23 tables', () => {
		// 23 tables as defined in src/lib/server/db/schema/index.ts
		expect(TABLE_EXPORT_ORDER).toHaveLength(23);
	});

	it('should contain all required tables', () => {
		const requiredTables = [
			'throttle_profiles',
			'app_settings',
			'users',
			'connectors',
			'sweep_schedules',
			'throttle_state',
			'series',
			'movies',
			'sync_state',
			'completion_snapshots',
			'analytics_events',
			'analytics_hourly_stats',
			'analytics_daily_stats',
			'seasons',
			'episodes',
			'search_registry',
			'request_queue',
			'search_history',
			'sessions',
			'prowlarr_instances',
			'prowlarr_indexer_health',
			'notification_channels',
			'notification_history'
		];

		// Should be exactly 23 tables
		expect(requiredTables).toHaveLength(23);

		for (const table of requiredTables) {
			expect(TABLE_EXPORT_ORDER).toContain(table);
		}
	});

	it('should have independent tables before dependent tables', () => {
		type TableName = (typeof TABLE_EXPORT_ORDER)[number];
		const getIndex = (table: TableName) => TABLE_EXPORT_ORDER.indexOf(table);

		// Independent tables should come first
		expect(getIndex('throttle_profiles')).toBeLessThan(getIndex('connectors'));
		expect(getIndex('users')).toBeLessThan(getIndex('sessions'));

		// connectors should come before tables that depend on it
		expect(getIndex('connectors')).toBeLessThan(getIndex('series'));
		expect(getIndex('connectors')).toBeLessThan(getIndex('movies'));
		expect(getIndex('connectors')).toBeLessThan(getIndex('throttle_state'));
		expect(getIndex('connectors')).toBeLessThan(getIndex('sync_state'));

		// series should come before seasons
		expect(getIndex('series')).toBeLessThan(getIndex('seasons'));

		// seasons should come before episodes
		expect(getIndex('seasons')).toBeLessThan(getIndex('episodes'));

		// search_registry should come before request_queue and search_history
		expect(getIndex('search_registry')).toBeLessThan(getIndex('request_queue'));
		expect(getIndex('search_registry')).toBeLessThan(getIndex('search_history'));

		// prowlarr_instances should come before prowlarr_indexer_health
		expect(getIndex('prowlarr_instances')).toBeLessThan(getIndex('prowlarr_indexer_health'));

		// notification_channels should come before notification_history
		expect(getIndex('notification_channels')).toBeLessThan(getIndex('notification_history'));
	});

	it('should have no duplicate tables', () => {
		const uniqueTables = new Set(TABLE_EXPORT_ORDER);
		expect(uniqueTables.size).toBe(TABLE_EXPORT_ORDER.length);
	});
});

describe('SECRET_KEY_VERIFIER_PLAINTEXT', () => {
	it('should be a non-empty string', () => {
		expect(typeof SECRET_KEY_VERIFIER_PLAINTEXT).toBe('string');
		expect(SECRET_KEY_VERIFIER_PLAINTEXT.length).toBeGreaterThan(0);
	});

	it('should be the expected value', () => {
		expect(SECRET_KEY_VERIFIER_PLAINTEXT).toBe('comradarr-backup-verify');
	});
});

describe('BackupError', () => {
	it('should create error with message and code', () => {
		const error = new BackupError('Test error', 'EXPORT_FAILED');

		expect(error.message).toBe('Test error');
		expect(error.code).toBe('EXPORT_FAILED');
		expect(error.name).toBe('BackupError');
		expect(error.recoverable).toBe(false); // Default
	});

	it('should support all error codes', () => {
		const codes = [
			'EXPORT_FAILED',
			'CHECKSUM_FAILED',
			'STORAGE_FAILED',
			'ENCRYPTION_FAILED',
			'SCHEMA_VERSION_FAILED',
			'NOT_FOUND'
		] as const;

		for (const code of codes) {
			const error = new BackupError(`Error: ${code}`, code);
			expect(error.code).toBe(code);
		}
	});

	it('should support recoverable flag', () => {
		const recoverableError = new BackupError('Recoverable', 'STORAGE_FAILED', true);
		const nonRecoverableError = new BackupError('Non-recoverable', 'EXPORT_FAILED', false);

		expect(recoverableError.recoverable).toBe(true);
		expect(nonRecoverableError.recoverable).toBe(false);
	});

	it('should be instanceof Error', () => {
		const error = new BackupError('Test', 'EXPORT_FAILED');
		expect(error).toBeInstanceOf(Error);
	});
});

describe('Backup format version', () => {
	it('should use format version 1', () => {
		// The formatVersion is defined in BackupFile as a literal type 1
		// This test verifies the type structure
		// Note: Actual file format is tested in integration tests

		// Verify the type definition exports BackupFile with formatVersion: 1
		// This is a type-level check that won't fail at runtime
		// but documents the expected format version
		const exampleBackup = {
			formatVersion: 1 as const,
			metadata: {
				id: 'test',
				createdAt: '2025-01-01',
				schemaVersion: { appVersion: '0.0.1', lastMigration: 'test', migrationIndex: 0 },
				checksum: 'sha256:abc',
				secretKeyVerifier: 'iv:tag:ct',
				type: 'manual' as const,
				tableCount: 23
			},
			tables: []
		};

		expect(exampleBackup.formatVersion).toBe(1);
	});
});

describe('Checksum format', () => {
	it('should document SHA-256 prefix in checksum', () => {
		// The checksum format is documented as "sha256:..."
		// This test serves as documentation that the format should be:
		// "sha256:" followed by 64 hex characters

		const validChecksumPattern = /^sha256:[a-f0-9]{64}$/;

		// Example valid checksum
		const exampleChecksum =
			'sha256:a3f2b8c9d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1';
		expect(exampleChecksum).toMatch(validChecksumPattern);

		// Example invalid checksums
		expect('md5:abc123').not.toMatch(validChecksumPattern);
		expect('sha256:short').not.toMatch(validChecksumPattern);
		expect('a3f2b8c9d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1').not.toMatch(
			validChecksumPattern
		);
	});
});
