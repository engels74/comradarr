/**
 * Unit tests for structured logging module.
 *
 * Tests cover:
 * - Log entry structure (JSON format)
 * - Log level filtering
 * - Log level hierarchy
 * - Context merging
 * - Correlation ID inclusion
 * - Auto correlation ID from async context
 * - Environment variable precedence
 * - HTTP request/response logging
 * - Trace level body inclusion
 *

 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type RequestContext, runWithContext } from '../../src/lib/server/context';
import {
	clearLogLevelCache,
	createLogger,
	getCurrentLogLevel,
	initializeLogLevel,
	type LogEntry,
	Logger,
	setLogLevel,
	shouldLog
} from '../../src/lib/server/logger';

describe('Logger', () => {
	let consoleSpy: ReturnType<typeof vi.spyOn>;
	let originalEnv: string | undefined;

	beforeEach(() => {
		// Capture console.log output
		consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		// Store original env
		originalEnv = process.env.LOG_LEVEL;
		// Clear cache before each test
		clearLogLevelCache();
	});

	afterEach(() => {
		consoleSpy.mockRestore();
		// Restore original env
		if (originalEnv !== undefined) {
			process.env.LOG_LEVEL = originalEnv;
		} else {
			delete process.env.LOG_LEVEL;
		}
		clearLogLevelCache();
	});

	describe('createLogger', () => {
		it('should create a Logger instance with the given module name', () => {
			const logger = createLogger('test-module');
			expect(logger).toBeInstanceOf(Logger);
		});
	});

	describe('log entry structure (Requirement 31.1)', () => {
		it('should output valid JSON with required fields', () => {
			setLogLevel('info');
			const logger = createLogger('test');

			logger.info('Test message');

			expect(consoleSpy).toHaveBeenCalledTimes(1);
			const output = consoleSpy.mock.calls[0]![0] as string;
			const entry = JSON.parse(output) as LogEntry;

			expect(entry).toHaveProperty('timestamp');
			expect(entry).toHaveProperty('level', 'info');
			expect(entry).toHaveProperty('module', 'test');
			expect(entry).toHaveProperty('message', 'Test message');
		});

		it('should output ISO 8601 timestamp', () => {
			setLogLevel('info');
			const logger = createLogger('test');

			logger.info('Test');

			const output = consoleSpy.mock.calls[0]![0] as string;
			const entry = JSON.parse(output) as LogEntry;

			// ISO 8601 format check
			expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
		});

		it('should include correlation ID when provided', () => {
			setLogLevel('info');
			const logger = createLogger('test');

			logger.info('Test', { correlationId: '550e8400-e29b-41d4-a716-446655440000' });

			const output = consoleSpy.mock.calls[0]![0] as string;
			const entry = JSON.parse(output) as LogEntry;

			expect(entry.correlationId).toBe('550e8400-e29b-41d4-a716-446655440000');
		});

		it('should include additional context fields', () => {
			setLogLevel('info');
			const logger = createLogger('scheduler');

			logger.info('Sweep started', {
				connectorId: 1,
				sweepType: 'gap'
			});

			const output = consoleSpy.mock.calls[0]![0] as string;
			const entry = JSON.parse(output) as LogEntry;

			expect(entry.connectorId).toBe(1);
			expect(entry.sweepType).toBe('gap');
		});
	});

	describe('log level methods', () => {
		it('should log error messages at error level', () => {
			setLogLevel('error');
			const logger = createLogger('test');

			logger.error('Error occurred');

			const output = consoleSpy.mock.calls[0]![0] as string;
			const entry = JSON.parse(output) as LogEntry;
			expect(entry.level).toBe('error');
		});

		it('should log warn messages at warn level', () => {
			setLogLevel('warn');
			const logger = createLogger('test');

			logger.warn('Warning message');

			const output = consoleSpy.mock.calls[0]![0] as string;
			const entry = JSON.parse(output) as LogEntry;
			expect(entry.level).toBe('warn');
		});

		it('should log info messages at info level', () => {
			setLogLevel('info');
			const logger = createLogger('test');

			logger.info('Info message');

			const output = consoleSpy.mock.calls[0]![0] as string;
			const entry = JSON.parse(output) as LogEntry;
			expect(entry.level).toBe('info');
		});

		it('should log debug messages at debug level', () => {
			setLogLevel('debug');
			const logger = createLogger('test');

			logger.debug('Debug message');

			const output = consoleSpy.mock.calls[0]![0] as string;
			const entry = JSON.parse(output) as LogEntry;
			expect(entry.level).toBe('debug');
		});

		it('should log trace messages at trace level', () => {
			setLogLevel('trace');
			const logger = createLogger('test');

			logger.trace('Trace message');

			const output = consoleSpy.mock.calls[0]![0] as string;
			const entry = JSON.parse(output) as LogEntry;
			expect(entry.level).toBe('trace');
		});
	});

	describe('log level filtering', () => {
		it('should not log debug messages at info level', () => {
			setLogLevel('info');
			const logger = createLogger('test');

			logger.debug('Debug message');

			expect(consoleSpy).not.toHaveBeenCalled();
		});

		it('should not log trace messages at debug level', () => {
			setLogLevel('debug');
			const logger = createLogger('test');

			logger.trace('Trace message');

			expect(consoleSpy).not.toHaveBeenCalled();
		});

		it('should log error messages at any level', () => {
			setLogLevel('error');
			const logger = createLogger('test');

			logger.error('Error message');

			expect(consoleSpy).toHaveBeenCalledTimes(1);
		});

		it('should log all levels at trace level', () => {
			setLogLevel('trace');
			const logger = createLogger('test');

			logger.error('Error');
			logger.warn('Warn');
			logger.info('Info');
			logger.debug('Debug');
			logger.trace('Trace');

			expect(consoleSpy).toHaveBeenCalledTimes(5);
		});
	});

	describe('log level hierarchy', () => {
		const levels = ['error', 'warn', 'info', 'debug', 'trace'] as const;

		levels.forEach((currentLevel, currentIndex) => {
			levels.forEach((messageLevel, messageIndex) => {
				const shouldBeLogged = messageIndex <= currentIndex;
				const verb = shouldBeLogged ? 'should' : 'should NOT';

				it(`${verb} log ${messageLevel} messages at ${currentLevel} level`, () => {
					setLogLevel(currentLevel);
					const logger = createLogger('test');

					logger[messageLevel]('Test message');

					if (shouldBeLogged) {
						expect(consoleSpy).toHaveBeenCalledTimes(1);
					} else {
						expect(consoleSpy).not.toHaveBeenCalled();
					}
				});
			});
		});
	});
});

describe('shouldLog', () => {
	it('should return true for error at error level', () => {
		expect(shouldLog('error', 'error')).toBe(true);
	});

	it('should return true for error at trace level', () => {
		expect(shouldLog('error', 'trace')).toBe(true);
	});

	it('should return false for trace at info level', () => {
		expect(shouldLog('trace', 'info')).toBe(false);
	});

	it('should return true for debug at debug level', () => {
		expect(shouldLog('debug', 'debug')).toBe(true);
	});

	it('should return true for info at debug level', () => {
		expect(shouldLog('info', 'debug')).toBe(true);
	});
});

describe('getCurrentLogLevel', () => {
	beforeEach(() => {
		clearLogLevelCache();
	});

	afterEach(() => {
		clearLogLevelCache();
	});

	it('should default to info when LOG_LEVEL not set', () => {
		delete process.env.LOG_LEVEL;
		clearLogLevelCache();

		expect(getCurrentLogLevel()).toBe('info');
	});

	it('should use LOG_LEVEL environment variable', () => {
		process.env.LOG_LEVEL = 'debug';
		clearLogLevelCache();

		expect(getCurrentLogLevel()).toBe('debug');
	});

	it('should handle case-insensitive LOG_LEVEL', () => {
		process.env.LOG_LEVEL = 'DEBUG';
		clearLogLevelCache();

		expect(getCurrentLogLevel()).toBe('debug');
	});

	it('should default to info for invalid LOG_LEVEL', () => {
		process.env.LOG_LEVEL = 'invalid';
		clearLogLevelCache();

		expect(getCurrentLogLevel()).toBe('info');
	});

	it('should cache the log level', () => {
		process.env.LOG_LEVEL = 'debug';
		clearLogLevelCache();

		const first = getCurrentLogLevel();
		process.env.LOG_LEVEL = 'error';
		const second = getCurrentLogLevel();

		// Should still return cached value
		expect(first).toBe('debug');
		expect(second).toBe('debug');
	});
});

describe('setLogLevel', () => {
	beforeEach(() => {
		clearLogLevelCache();
	});

	afterEach(() => {
		clearLogLevelCache();
	});

	it('should override the log level', () => {
		process.env.LOG_LEVEL = 'error';
		clearLogLevelCache();

		expect(getCurrentLogLevel()).toBe('error');

		setLogLevel('trace');

		expect(getCurrentLogLevel()).toBe('trace');
	});
});

describe('HTTP logging methods', () => {
	let consoleSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		clearLogLevelCache();
	});

	afterEach(() => {
		consoleSpy.mockRestore();
		clearLogLevelCache();
	});

	describe('logRequest', () => {
		it('should log at debug level minimum', () => {
			setLogLevel('debug');
			const logger = createLogger('http');

			logger.logRequest('GET', 'http://example.com/api');

			expect(consoleSpy).toHaveBeenCalledTimes(1);
			const output = consoleSpy.mock.calls[0]![0] as string;
			const entry = JSON.parse(output) as LogEntry;
			expect(entry.level).toBe('debug');
		});

		it('should not log at info level', () => {
			setLogLevel('info');
			const logger = createLogger('http');

			logger.logRequest('GET', 'http://example.com/api');

			expect(consoleSpy).not.toHaveBeenCalled();
		});

		it('should include method and URL', () => {
			setLogLevel('debug');
			const logger = createLogger('http');

			logger.logRequest('POST', 'http://example.com/api/v3/command');

			const output = consoleSpy.mock.calls[0]![0] as string;
			const entry = JSON.parse(output) as LogEntry;
			expect(entry.method).toBe('POST');
			expect(entry.url).toBe('http://example.com/api/v3/command');
			expect(entry.message).toBe('HTTP POST http://example.com/api/v3/command');
		});

		it('should include correlation ID when provided', () => {
			setLogLevel('debug');
			const logger = createLogger('http');

			logger.logRequest('GET', 'http://example.com', {
				correlationId: 'abc-123'
			});

			const output = consoleSpy.mock.calls[0]![0] as string;
			const entry = JSON.parse(output) as LogEntry;
			expect(entry.correlationId).toBe('abc-123');
		});

		it('should redact sensitive headers', () => {
			setLogLevel('debug');
			const logger = createLogger('http');

			logger.logRequest('GET', 'http://example.com', {
				headers: {
					'Content-Type': 'application/json',
					'X-Api-Key': 'secret-key-12345',
					Authorization: 'Bearer token123'
				}
			});

			const output = consoleSpy.mock.calls[0]![0] as string;
			const entry = JSON.parse(output) as LogEntry;
			const headers = entry.headers as Record<string, string>;

			expect(headers['Content-Type']).toBe('application/json');
			expect(headers['X-Api-Key']).toBe('[REDACTED]');
			expect(headers.Authorization).toBe('[REDACTED]');
		});

		it('should NOT include body at debug level', () => {
			setLogLevel('debug');
			const logger = createLogger('http');

			logger.logRequest('POST', 'http://example.com', {
				body: { name: 'test', value: 123 }
			});

			const output = consoleSpy.mock.calls[0]![0] as string;
			const entry = JSON.parse(output) as LogEntry;
			expect(entry.body).toBeUndefined();
		});

		it('should include body at trace level (Requirement 31.4)', () => {
			setLogLevel('trace');
			const logger = createLogger('http');

			logger.logRequest('POST', 'http://example.com', {
				body: { name: 'test', value: 123 }
			});

			const output = consoleSpy.mock.calls[0]![0] as string;
			const entry = JSON.parse(output) as LogEntry;
			expect(entry.body).toEqual({ name: 'test', value: 123 });
		});
	});

	describe('logResponse', () => {
		it('should log at debug level minimum', () => {
			setLogLevel('debug');
			const logger = createLogger('http');

			logger.logResponse(200, 'http://example.com/api');

			expect(consoleSpy).toHaveBeenCalledTimes(1);
			const output = consoleSpy.mock.calls[0]![0] as string;
			const entry = JSON.parse(output) as LogEntry;
			expect(entry.level).toBe('debug');
		});

		it('should not log at info level', () => {
			setLogLevel('info');
			const logger = createLogger('http');

			logger.logResponse(200, 'http://example.com/api');

			expect(consoleSpy).not.toHaveBeenCalled();
		});

		it('should include status code and URL', () => {
			setLogLevel('debug');
			const logger = createLogger('http');

			logger.logResponse(201, 'http://example.com/api/v3/command');

			const output = consoleSpy.mock.calls[0]![0] as string;
			const entry = JSON.parse(output) as LogEntry;
			expect(entry.statusCode).toBe(201);
			expect(entry.url).toBe('http://example.com/api/v3/command');
			expect(entry.message).toBe('HTTP 201 http://example.com/api/v3/command');
		});

		it('should include duration when provided', () => {
			setLogLevel('debug');
			const logger = createLogger('http');

			logger.logResponse(200, 'http://example.com', {
				durationMs: 150
			});

			const output = consoleSpy.mock.calls[0]![0] as string;
			const entry = JSON.parse(output) as LogEntry;
			expect(entry.durationMs).toBe(150);
		});

		it('should include correlation ID when provided', () => {
			setLogLevel('debug');
			const logger = createLogger('http');

			logger.logResponse(200, 'http://example.com', {
				correlationId: 'xyz-789'
			});

			const output = consoleSpy.mock.calls[0]![0] as string;
			const entry = JSON.parse(output) as LogEntry;
			expect(entry.correlationId).toBe('xyz-789');
		});

		it('should NOT include body at debug level', () => {
			setLogLevel('debug');
			const logger = createLogger('http');

			logger.logResponse(200, 'http://example.com', {
				body: { success: true, data: [1, 2, 3] }
			});

			const output = consoleSpy.mock.calls[0]![0] as string;
			const entry = JSON.parse(output) as LogEntry;
			expect(entry.body).toBeUndefined();
		});

		it('should include body at trace level (Requirement 31.4)', () => {
			setLogLevel('trace');
			const logger = createLogger('http');

			logger.logResponse(200, 'http://example.com', {
				body: { success: true, data: [1, 2, 3] }
			});

			const output = consoleSpy.mock.calls[0]![0] as string;
			const entry = JSON.parse(output) as LogEntry;
			expect(entry.body).toEqual({ success: true, data: [1, 2, 3] });
		});

		it('should include headers when provided', () => {
			setLogLevel('debug');
			const logger = createLogger('http');

			logger.logResponse(200, 'http://example.com', {
				headers: {
					'Content-Type': 'application/json',
					'X-Request-Id': 'req-123'
				}
			});

			const output = consoleSpy.mock.calls[0]![0] as string;
			const entry = JSON.parse(output) as LogEntry;
			const headers = entry.headers as Record<string, string>;

			expect(headers['Content-Type']).toBe('application/json');
			expect(headers['X-Request-Id']).toBe('req-123');
		});
	});
});

describe('Auto correlation ID from async context (Requirement 31.2)', () => {
	let consoleSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		clearLogLevelCache();
	});

	afterEach(() => {
		consoleSpy.mockRestore();
		clearLogLevelCache();
	});

	describe('standard log methods', () => {
		it('should include correlation ID from async context when not provided', async () => {
			setLogLevel('info');
			const logger = createLogger('test');
			const context: RequestContext = {
				correlationId: 'auto-123',
				source: 'http'
			};

			await runWithContext(context, async () => {
				logger.info('Test message');
			});

			expect(consoleSpy).toHaveBeenCalledTimes(1);
			const output = consoleSpy.mock.calls[0]![0] as string;
			const entry = JSON.parse(output) as LogEntry;
			expect(entry.correlationId).toBe('auto-123');
		});

		it('should prefer explicit correlation ID over context', async () => {
			setLogLevel('info');
			const logger = createLogger('test');
			const context: RequestContext = {
				correlationId: 'context-id',
				source: 'http'
			};

			await runWithContext(context, async () => {
				logger.info('Test message', { correlationId: 'explicit-id' });
			});

			expect(consoleSpy).toHaveBeenCalledTimes(1);
			const output = consoleSpy.mock.calls[0]![0] as string;
			const entry = JSON.parse(output) as LogEntry;
			expect(entry.correlationId).toBe('explicit-id');
		});

		it('should work without context (no correlation ID)', () => {
			setLogLevel('info');
			const logger = createLogger('test');

			logger.info('Test message');

			expect(consoleSpy).toHaveBeenCalledTimes(1);
			const output = consoleSpy.mock.calls[0]![0] as string;
			const entry = JSON.parse(output) as LogEntry;
			expect(entry.correlationId).toBeUndefined();
		});

		it('should propagate correlation ID through async chains', async () => {
			setLogLevel('info');
			const logger = createLogger('test');
			const context: RequestContext = {
				correlationId: 'propagated-id',
				source: 'http'
			};

			const nestedLog = async () => {
				logger.info('Nested message');
			};

			await runWithContext(context, async () => {
				await nestedLog();
			});

			expect(consoleSpy).toHaveBeenCalledTimes(1);
			const output = consoleSpy.mock.calls[0]![0] as string;
			const entry = JSON.parse(output) as LogEntry;
			expect(entry.correlationId).toBe('propagated-id');
		});

		it('should work with error level logs', async () => {
			setLogLevel('error');
			const logger = createLogger('test');
			const context: RequestContext = {
				correlationId: 'error-context-id',
				source: 'http'
			};

			await runWithContext(context, async () => {
				logger.error('Error occurred', { errorCode: 'E001' });
			});

			expect(consoleSpy).toHaveBeenCalledTimes(1);
			const output = consoleSpy.mock.calls[0]![0] as string;
			const entry = JSON.parse(output) as LogEntry;
			expect(entry.correlationId).toBe('error-context-id');
			expect(entry.errorCode).toBe('E001');
		});
	});

	describe('HTTP logging methods', () => {
		it('should include correlation ID from context in logRequest', async () => {
			setLogLevel('debug');
			const logger = createLogger('http');
			const context: RequestContext = {
				correlationId: 'request-context-id',
				source: 'http'
			};

			await runWithContext(context, async () => {
				logger.logRequest('GET', 'http://example.com/api');
			});

			expect(consoleSpy).toHaveBeenCalledTimes(1);
			const output = consoleSpy.mock.calls[0]![0] as string;
			const entry = JSON.parse(output) as LogEntry;
			expect(entry.correlationId).toBe('request-context-id');
		});

		it('should include correlation ID from context in logResponse', async () => {
			setLogLevel('debug');
			const logger = createLogger('http');
			const context: RequestContext = {
				correlationId: 'response-context-id',
				source: 'http'
			};

			await runWithContext(context, async () => {
				logger.logResponse(200, 'http://example.com/api', { durationMs: 100 });
			});

			expect(consoleSpy).toHaveBeenCalledTimes(1);
			const output = consoleSpy.mock.calls[0]![0] as string;
			const entry = JSON.parse(output) as LogEntry;
			expect(entry.correlationId).toBe('response-context-id');
		});

		it('should prefer explicit correlation ID over context in HTTP methods', async () => {
			setLogLevel('debug');
			const logger = createLogger('http');
			const context: RequestContext = {
				correlationId: 'context-id',
				source: 'http'
			};

			await runWithContext(context, async () => {
				logger.logRequest('POST', 'http://example.com', {
					correlationId: 'explicit-http-id'
				});
			});

			expect(consoleSpy).toHaveBeenCalledTimes(1);
			const output = consoleSpy.mock.calls[0]![0] as string;
			const entry = JSON.parse(output) as LogEntry;
			expect(entry.correlationId).toBe('explicit-http-id');
		});
	});

	describe('scheduler context', () => {
		it('should include correlation ID from scheduler context', async () => {
			setLogLevel('info');
			const logger = createLogger('scheduler');
			const context: RequestContext = {
				correlationId: 'job-12345',
				source: 'scheduler',
				jobName: 'sync-connectors'
			};

			await runWithContext(context, async () => {
				logger.info('Job started', { jobName: 'sync-connectors' });
			});

			expect(consoleSpy).toHaveBeenCalledTimes(1);
			const output = consoleSpy.mock.calls[0]![0] as string;
			const entry = JSON.parse(output) as LogEntry;
			expect(entry.correlationId).toBe('job-12345');
			expect(entry.jobName).toBe('sync-connectors');
		});
	});
});

describe('initializeLogLevel (Requirement 31.5)', () => {
	let originalEnv: string | undefined;

	beforeEach(() => {
		originalEnv = process.env.LOG_LEVEL;
		clearLogLevelCache();
	});

	afterEach(() => {
		if (originalEnv !== undefined) {
			process.env.LOG_LEVEL = originalEnv;
		} else {
			delete process.env.LOG_LEVEL;
		}
		clearLogLevelCache();
	});

	it('should fall back to environment variable when database is unavailable', async () => {
		process.env.LOG_LEVEL = 'debug';
		clearLogLevelCache();

		// The database import will fail in test environment, so it falls back to env
		await initializeLogLevel();

		expect(getCurrentLogLevel()).toBe('debug');
	});

	it('should fall back to default when no env var and database unavailable', async () => {
		delete process.env.LOG_LEVEL;
		clearLogLevelCache();

		// The database import will fail in test environment, so it falls back to default
		await initializeLogLevel();

		expect(getCurrentLogLevel()).toBe('info');
	});

	it('should handle case-insensitive environment variable', async () => {
		process.env.LOG_LEVEL = 'TRACE';
		clearLogLevelCache();

		await initializeLogLevel();

		expect(getCurrentLogLevel()).toBe('trace');
	});

	it('should fall back to default for invalid environment variable', async () => {
		process.env.LOG_LEVEL = 'invalid_level';
		clearLogLevelCache();

		await initializeLogLevel();

		expect(getCurrentLogLevel()).toBe('info');
	});

	it('should not throw when database is unavailable', async () => {
		delete process.env.LOG_LEVEL;
		clearLogLevelCache();

		// Should not throw even if database is unavailable
		await expect(initializeLogLevel()).resolves.toBeUndefined();
	});
});

describe('Runtime log level change integration (Requirement 31.5)', () => {
	let consoleSpy: ReturnType<typeof vi.spyOn>;
	let originalEnv: string | undefined;

	beforeEach(() => {
		consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		originalEnv = process.env.LOG_LEVEL;
		clearLogLevelCache();
	});

	afterEach(() => {
		consoleSpy.mockRestore();
		if (originalEnv !== undefined) {
			process.env.LOG_LEVEL = originalEnv;
		} else {
			delete process.env.LOG_LEVEL;
		}
		clearLogLevelCache();
	});

	it('should change log level at runtime and take effect immediately', () => {
		// Start at info level
		setLogLevel('info');
		const logger = createLogger('test');

		// Debug should not be logged at info level
		logger.debug('Debug message before');
		expect(consoleSpy).not.toHaveBeenCalled();

		// Change to debug level at runtime
		setLogLevel('debug');

		// Now debug should be logged
		logger.debug('Debug message after');
		expect(consoleSpy).toHaveBeenCalledTimes(1);

		const output = consoleSpy.mock.calls[0]![0] as string;
		const entry = JSON.parse(output) as LogEntry;
		expect(entry.level).toBe('debug');
		expect(entry.message).toBe('Debug message after');
	});

	it('should allow changing from verbose to less verbose level', () => {
		// Start at trace level (most verbose)
		setLogLevel('trace');
		const logger = createLogger('test');

		// Trace should be logged
		logger.trace('Trace message');
		expect(consoleSpy).toHaveBeenCalledTimes(1);

		// Change to error level (least verbose)
		setLogLevel('error');

		// Clear the spy
		consoleSpy.mockClear();

		// Info should not be logged at error level
		logger.info('Info message');
		expect(consoleSpy).not.toHaveBeenCalled();

		// Error should still be logged
		logger.error('Error message');
		expect(consoleSpy).toHaveBeenCalledTimes(1);
	});

	it('should maintain log level change across multiple logger instances', () => {
		// Set initial level
		setLogLevel('warn');

		const logger1 = createLogger('module1');
		const logger2 = createLogger('module2');

		// Debug should not be logged at warn level
		logger1.debug('Debug from module1');
		logger2.debug('Debug from module2');
		expect(consoleSpy).not.toHaveBeenCalled();

		// Change level at runtime
		setLogLevel('debug');

		// Both loggers should now log debug
		logger1.debug('Debug from module1 after');
		logger2.debug('Debug from module2 after');
		expect(consoleSpy).toHaveBeenCalledTimes(2);
	});
});
