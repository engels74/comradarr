/**
 * Unit tests for sync health utilities.
 *
 * determineHealthStatus(), shouldRetrySync(), and calculateSyncBackoffDelay() tests
 * are covered by integration tests in tests/integration/sync-failure-handling.test.ts.
 */

import { describe, expect, it } from 'vitest';
import { SYNC_CONFIG } from '../../src/lib/server/services/sync/config';
import { determineHealthFromChecks } from '../../src/lib/server/services/sync/health-utils';

describe('SYNC_CONFIG', () => {
	it('should have expected default threshold values', () => {
		expect(SYNC_CONFIG.UNHEALTHY_THRESHOLD).toBe(5);
	});

	it('should have expected retry configuration', () => {
		expect(SYNC_CONFIG.MAX_SYNC_RETRIES).toBe(3);
		expect(SYNC_CONFIG.SYNC_RETRY_BASE_DELAY).toBe(30_000);
		expect(SYNC_CONFIG.SYNC_RETRY_MAX_DELAY).toBe(300_000);
		expect(SYNC_CONFIG.SYNC_RETRY_MULTIPLIER).toBe(2);
	});
});

describe('determineHealthFromChecks', () => {
	describe('healthy scenarios', () => {
		it('should return healthy for empty checks array', () => {
			const status = determineHealthFromChecks([]);
			expect(status).toBe('healthy');
		});

		it('should return healthy when all checks are ok', () => {
			const checks = [{ type: 'ok' as const }, { type: 'ok' as const }];
			const status = determineHealthFromChecks(checks);
			expect(status).toBe('healthy');
		});

		it('should return healthy when checks contain only notices', () => {
			const checks = [{ type: 'notice' as const }, { type: 'ok' as const }];
			const status = determineHealthFromChecks(checks);
			expect(status).toBe('healthy');
		});

		it('should return healthy when checks contain warnings but no errors', () => {
			const checks = [
				{ type: 'warning' as const },
				{ type: 'ok' as const },
				{ type: 'notice' as const }
			];
			const status = determineHealthFromChecks(checks);
			expect(status).toBe('healthy');
		});
	});

	describe('degraded scenarios', () => {
		it('should return degraded when checks contain any error', () => {
			const checks = [{ type: 'ok' as const }, { type: 'error' as const }];
			const status = determineHealthFromChecks(checks);
			expect(status).toBe('degraded');
		});

		it('should return degraded when checks contain multiple errors', () => {
			const checks = [
				{ type: 'error' as const },
				{ type: 'error' as const },
				{ type: 'ok' as const }
			];
			const status = determineHealthFromChecks(checks);
			expect(status).toBe('degraded');
		});

		it('should return degraded when checks contain error with warning', () => {
			const checks = [
				{ type: 'warning' as const },
				{ type: 'error' as const },
				{ type: 'notice' as const }
			];
			const status = determineHealthFromChecks(checks);
			expect(status).toBe('degraded');
		});
	});

	describe('edge cases', () => {
		it('should handle single ok check', () => {
			const status = determineHealthFromChecks([{ type: 'ok' }]);
			expect(status).toBe('healthy');
		});

		it('should handle single error check', () => {
			const status = determineHealthFromChecks([{ type: 'error' }]);
			expect(status).toBe('degraded');
		});

		it('should handle single warning check', () => {
			const status = determineHealthFromChecks([{ type: 'warning' }]);
			expect(status).toBe('healthy');
		});

		it('should handle single notice check', () => {
			const status = determineHealthFromChecks([{ type: 'notice' }]);
			expect(status).toBe('healthy');
		});
	});
});
