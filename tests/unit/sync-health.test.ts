/**
 * Unit tests for sync failure handling - health status determination and backoff
 *
 * Tests cover:
 * - determineHealthStatus() threshold logic
 * - shouldRetrySync() retry decision
 * - calculateSyncBackoffDelay() exponential backoff
 * - SYNC_CONFIG default values
 *
 * @requirements 2.6
 */

import { describe, it, expect } from 'vitest';
import {
	determineHealthStatus,
	shouldRetrySync,
	calculateSyncBackoffDelay,
	determineHealthFromChecks
} from '../../src/lib/server/services/sync/health-utils';
import { SYNC_CONFIG } from '../../src/lib/server/services/sync/config';
import {
	AuthenticationError,
	NetworkError,
	ServerError,
	RateLimitError,
	TimeoutError,
	NotFoundError,
	SSLError,
	ValidationError
} from '../../src/lib/server/connectors/common/errors';

describe('SYNC_CONFIG', () => {
	it('should have expected default threshold values', () => {
		expect(SYNC_CONFIG.UNHEALTHY_THRESHOLD).toBe(5);
		expect(SYNC_CONFIG.DEGRADED_THRESHOLD).toBe(2);
	});

	it('should have expected retry configuration', () => {
		expect(SYNC_CONFIG.MAX_SYNC_RETRIES).toBe(3);
		expect(SYNC_CONFIG.SYNC_RETRY_BASE_DELAY).toBe(30_000);
		expect(SYNC_CONFIG.SYNC_RETRY_MAX_DELAY).toBe(300_000);
		expect(SYNC_CONFIG.SYNC_RETRY_MULTIPLIER).toBe(2);
	});
});

describe('determineHealthStatus', () => {
	describe('success scenarios', () => {
		it('should return healthy when sync succeeds', () => {
			const status = determineHealthStatus(true, 0);
			expect(status).toBe('healthy');
		});

		it('should return healthy when sync succeeds regardless of previous failure count', () => {
			// Even if there were previous failures, success resets to healthy
			const status = determineHealthStatus(true, 10);
			expect(status).toBe('healthy');
		});
	});

	describe('failure scenarios - authentication errors', () => {
		it('should return unhealthy immediately for AuthenticationError', () => {
			const error = new AuthenticationError();
			const status = determineHealthStatus(false, 1, error);
			expect(status).toBe('unhealthy');
		});

		it('should return unhealthy for AuthenticationError even with low failure count', () => {
			const error = new AuthenticationError();
			const status = determineHealthStatus(false, 1, error);
			expect(status).toBe('unhealthy');
		});
	});

	describe('failure scenarios - consecutive failures threshold', () => {
		it('should return degraded for 1 consecutive failure', () => {
			const error = new NetworkError('Connection failed', 'connection_refused');
			const status = determineHealthStatus(false, 1, error);
			expect(status).toBe('degraded');
		});

		it('should return degraded at DEGRADED_THRESHOLD', () => {
			const error = new NetworkError('Connection failed', 'connection_refused');
			const status = determineHealthStatus(false, SYNC_CONFIG.DEGRADED_THRESHOLD, error);
			expect(status).toBe('degraded');
		});

		it('should return degraded below UNHEALTHY_THRESHOLD', () => {
			const error = new NetworkError('Connection failed', 'connection_refused');
			const status = determineHealthStatus(false, SYNC_CONFIG.UNHEALTHY_THRESHOLD - 1, error);
			expect(status).toBe('degraded');
		});

		it('should return unhealthy at UNHEALTHY_THRESHOLD', () => {
			const error = new NetworkError('Connection failed', 'connection_refused');
			const status = determineHealthStatus(false, SYNC_CONFIG.UNHEALTHY_THRESHOLD, error);
			expect(status).toBe('unhealthy');
		});

		it('should return unhealthy above UNHEALTHY_THRESHOLD', () => {
			const error = new NetworkError('Connection failed', 'connection_refused');
			const status = determineHealthStatus(false, SYNC_CONFIG.UNHEALTHY_THRESHOLD + 5, error);
			expect(status).toBe('unhealthy');
		});
	});

	describe('failure scenarios - no error provided', () => {
		it('should return degraded for first failure without error', () => {
			const status = determineHealthStatus(false, 1);
			expect(status).toBe('degraded');
		});

		it('should return unhealthy at threshold without error', () => {
			const status = determineHealthStatus(false, SYNC_CONFIG.UNHEALTHY_THRESHOLD);
			expect(status).toBe('unhealthy');
		});
	});
});

describe('shouldRetrySync', () => {
	describe('retry limits', () => {
		it('should return true for first attempt with retryable error', () => {
			const error = new NetworkError('Connection failed', 'connection_refused');
			expect(shouldRetrySync(error, 0)).toBe(true);
		});

		it('should return true for attempts below max retries', () => {
			const error = new NetworkError('Connection failed', 'connection_refused');
			expect(shouldRetrySync(error, SYNC_CONFIG.MAX_SYNC_RETRIES - 1)).toBe(true);
		});

		it('should return false when max retries reached', () => {
			const error = new NetworkError('Connection failed', 'connection_refused');
			expect(shouldRetrySync(error, SYNC_CONFIG.MAX_SYNC_RETRIES)).toBe(false);
		});

		it('should return false when max retries exceeded', () => {
			const error = new NetworkError('Connection failed', 'connection_refused');
			expect(shouldRetrySync(error, SYNC_CONFIG.MAX_SYNC_RETRIES + 1)).toBe(false);
		});
	});

	describe('non-retryable errors', () => {
		it('should return false for AuthenticationError', () => {
			const error = new AuthenticationError();
			expect(shouldRetrySync(error, 0)).toBe(false);
		});

		it('should return false for NotFoundError', () => {
			const error = new NotFoundError('series/123');
			expect(shouldRetrySync(error, 0)).toBe(false);
		});

		it('should return false for SSLError', () => {
			const error = new SSLError('Certificate invalid');
			expect(shouldRetrySync(error, 0)).toBe(false);
		});

		it('should return false for ValidationError', () => {
			const error = new ValidationError('Invalid data');
			expect(shouldRetrySync(error, 0)).toBe(false);
		});
	});

	describe('retryable errors', () => {
		it('should return true for NetworkError', () => {
			const error = new NetworkError('Connection failed', 'connection_refused');
			expect(shouldRetrySync(error, 0)).toBe(true);
		});

		it('should return true for ServerError', () => {
			const error = new ServerError(500, 'Internal Server Error');
			expect(shouldRetrySync(error, 0)).toBe(true);
		});

		it('should return true for RateLimitError', () => {
			const error = new RateLimitError();
			expect(shouldRetrySync(error, 0)).toBe(true);
		});

		it('should return true for TimeoutError', () => {
			const error = new TimeoutError(30000);
			expect(shouldRetrySync(error, 0)).toBe(true);
		});
	});

	describe('edge cases', () => {
		it('should return true for undefined error within retry limit', () => {
			expect(shouldRetrySync(undefined, 0)).toBe(true);
		});

		it('should return true for non-ArrClientError within retry limit', () => {
			const error = new Error('Generic error');
			expect(shouldRetrySync(error, 0)).toBe(true);
		});

		it('should return false for undefined error at max retries', () => {
			expect(shouldRetrySync(undefined, SYNC_CONFIG.MAX_SYNC_RETRIES)).toBe(false);
		});
	});
});

describe('calculateSyncBackoffDelay', () => {
	describe('exponential growth', () => {
		it('should return base delay for attempt 0', () => {
			const delay = calculateSyncBackoffDelay(0);
			expect(delay).toBe(SYNC_CONFIG.SYNC_RETRY_BASE_DELAY); // 30000
		});

		it('should double delay for each attempt', () => {
			expect(calculateSyncBackoffDelay(0)).toBe(30_000); // 30000 * 2^0
			expect(calculateSyncBackoffDelay(1)).toBe(60_000); // 30000 * 2^1
			expect(calculateSyncBackoffDelay(2)).toBe(120_000); // 30000 * 2^2
			expect(calculateSyncBackoffDelay(3)).toBe(240_000); // 30000 * 2^3
		});
	});

	describe('max delay cap', () => {
		it('should cap delay at max delay', () => {
			// 30000 * 2^4 = 480000, which exceeds 300000 max
			const delay = calculateSyncBackoffDelay(4);
			expect(delay).toBe(SYNC_CONFIG.SYNC_RETRY_MAX_DELAY); // 300000
		});

		it('should cap delay for very high attempt numbers', () => {
			const delay = calculateSyncBackoffDelay(10);
			expect(delay).toBe(SYNC_CONFIG.SYNC_RETRY_MAX_DELAY);
		});
	});

	describe('edge cases', () => {
		it('should handle attempt 0', () => {
			const delay = calculateSyncBackoffDelay(0);
			expect(delay).toBeGreaterThan(0);
		});

		it('should always return positive delay', () => {
			for (let i = 0; i <= 10; i++) {
				const delay = calculateSyncBackoffDelay(i);
				expect(delay).toBeGreaterThan(0);
			}
		});

		it('should return delay within expected range', () => {
			for (let i = 0; i <= 10; i++) {
				const delay = calculateSyncBackoffDelay(i);
				expect(delay).toBeGreaterThanOrEqual(SYNC_CONFIG.SYNC_RETRY_BASE_DELAY);
				expect(delay).toBeLessThanOrEqual(SYNC_CONFIG.SYNC_RETRY_MAX_DELAY);
			}
		});
	});
});

describe('determineHealthFromChecks', () => {
	describe('healthy scenarios', () => {
		it('should return healthy for empty checks array', () => {
			const status = determineHealthFromChecks([]);
			expect(status).toBe('healthy');
		});

		it('should return healthy when all checks are ok', () => {
			const checks = [
				{ type: 'ok' as const },
				{ type: 'ok' as const }
			];
			const status = determineHealthFromChecks(checks);
			expect(status).toBe('healthy');
		});

		it('should return healthy when checks contain only notices', () => {
			const checks = [
				{ type: 'notice' as const },
				{ type: 'ok' as const }
			];
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
			const checks = [
				{ type: 'ok' as const },
				{ type: 'error' as const }
			];
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
