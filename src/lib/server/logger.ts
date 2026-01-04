/**
 * Structured JSON logging module.
 *
 * - Output structured JSON with timestamp, level, module, message, and correlation_id fields
 * - Automatically include correlation ID from request context when available
 * - When LOG_LEVEL is set to trace, include full request and response bodies
 */

import { type LogLevel, logLevels } from '$lib/schemas/settings';
import { getCorrelationId } from '$lib/server/context';
import { addLogEntry, type BufferedLogEntry } from '$lib/server/services/log-buffer';

// =============================================================================
// Types
// =============================================================================

/**
 * Structured log entry format.
 * All log output follows this structure for machine parsing.
 */
export interface LogEntry {
	/** ISO 8601 timestamp */
	timestamp: string;
	/** Log level */
	level: LogLevel;
	/** Module/component name */
	module: string;
	/** Log message */
	message: string;
	/** Request correlation ID for tracing */
	correlationId?: string;
	/** Additional context fields */
	[key: string]: unknown;
}

/**
 * Options for HTTP request logging.
 */
export interface RequestLogOptions {
	/** Request headers (redacted sensitive values) */
	headers?: Record<string, string>;
	/** Request body (only included at trace level) */
	body?: unknown;
	/** Correlation ID for request tracing */
	correlationId?: string;
}

/**
 * Options for HTTP response logging.
 */
export interface ResponseLogOptions {
	/** Response headers */
	headers?: Record<string, string>;
	/** Response body (only included at trace level) */
	body?: unknown;
	/** Request duration in milliseconds */
	durationMs?: number;
	/** Correlation ID for request tracing */
	correlationId?: string;
}

// =============================================================================
// Log Level Management
// =============================================================================

/**
 * Log level priority map.
 * Lower index = higher priority (fewer messages logged).
 */
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
	error: 0,
	warn: 1,
	info: 2,
	debug: 3,
	trace: 4
};

/**
 * Default log level when not configured.
 */
const DEFAULT_LOG_LEVEL: LogLevel = 'info';

/**
 * Cached log level to avoid repeated lookups.
 * Initialized on first use.
 */
let cachedLogLevel: LogLevel | null = null;

/**
 * Gets the current log level from environment or defaults.
 * Priority: LOG_LEVEL env var > default ('info')
 *
 * Note: Database setting override is handled by task 47.3 (runtime level change).
 *
 * @returns Current log level
 */
export function getCurrentLogLevel(): LogLevel {
	if (cachedLogLevel !== null) {
		return cachedLogLevel;
	}

	const envLevel = process.env.LOG_LEVEL?.toLowerCase();

	if (envLevel && logLevels.includes(envLevel as LogLevel)) {
		cachedLogLevel = envLevel as LogLevel;
	} else {
		cachedLogLevel = DEFAULT_LOG_LEVEL;
	}

	return cachedLogLevel;
}

/**
 * Sets the log level (for runtime changes).
 * This allows changing the log level without restart (Requirement 31.5 - task 47.3).
 *
 * @param level - New log level to set
 */
export function setLogLevel(level: LogLevel): void {
	cachedLogLevel = level;
}

/**
 * Clears the cached log level, forcing re-read from environment.
 * Useful for testing.
 */
export function clearLogLevelCache(): void {
	cachedLogLevel = null;
}

/**
 * Initializes the log level from database settings.
 * Should be called once at application startup.
 * Falls back to environment variable or default if database is unavailable.
 *
 * Requirement 31.5: Log level can be changed at runtime
 *
 * @returns Promise that resolves when initialization is complete
 */
export async function initializeLogLevel(): Promise<void> {
	try {
		// Dynamic import to avoid circular dependencies and keep logger lightweight
		const { getSetting } = await import('$lib/server/db/queries/settings');
		const dbLogLevel = await getSetting('log_level');

		if (dbLogLevel && logLevels.includes(dbLogLevel as LogLevel)) {
			cachedLogLevel = dbLogLevel as LogLevel;
			return;
		}
	} catch {
		// Database not available - fall through to environment/default
	}

	// Fall back to environment variable or default
	const envLevel = process.env.LOG_LEVEL?.toLowerCase();
	if (envLevel && logLevels.includes(envLevel as LogLevel)) {
		cachedLogLevel = envLevel as LogLevel;
	} else {
		cachedLogLevel = DEFAULT_LOG_LEVEL;
	}
}

/**
 * Checks if a message at the given level should be logged
 * based on the current log level setting.
 *
 * @param messageLevel - Level of the message to log
 * @param currentLevel - Current log level threshold
 * @returns True if the message should be logged
 */
export function shouldLog(messageLevel: LogLevel, currentLevel: LogLevel): boolean {
	return LOG_LEVEL_PRIORITY[messageLevel] <= LOG_LEVEL_PRIORITY[currentLevel];
}

// =============================================================================
// Sensitive Data Redaction
// =============================================================================

/**
 * Headers that should have their values redacted in logs.
 */
const SENSITIVE_HEADERS = new Set([
	'authorization',
	'x-api-key',
	'cookie',
	'set-cookie',
	'x-auth-token'
]);

/**
 * Redacts sensitive header values.
 *
 * @param headers - Headers to redact
 * @returns Headers with sensitive values redacted
 */
function redactHeaders(headers: Record<string, string>): Record<string, string> {
	const redacted: Record<string, string> = {};

	for (const [key, value] of Object.entries(headers)) {
		if (SENSITIVE_HEADERS.has(key.toLowerCase())) {
			redacted[key] = '[REDACTED]';
		} else {
			redacted[key] = value;
		}
	}

	return redacted;
}

// =============================================================================
// Logger Class
// =============================================================================

/**
 * Structured logger for a specific module.
 * Outputs JSON to stdout for machine parsing.
 *
 * @example
 * ```typescript
 * const logger = createLogger('scheduler');
 * logger.info('Sweep cycle started', { connectorId: 1 });
 * // Output: {"timestamp":"...","level":"info","module":"scheduler","message":"Sweep cycle started","connectorId":1}
 * ```
 */
export class Logger {
	private readonly module: string;

	constructor(module: string) {
		this.module = module;
	}

	/**
	 * Internal log method that handles level checking and output.
	 * Automatically includes correlation ID from async context if not explicitly provided.
	 */
	private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
		const currentLevel = getCurrentLogLevel();

		if (!shouldLog(level, currentLevel)) {
			return;
		}

		// Auto-include correlation ID from async context if not provided (Requirement 31.2)
		const correlationId = (context?.correlationId as string | undefined) ?? getCorrelationId();

		const timestamp = new Date().toISOString();

		const entry: LogEntry = {
			timestamp,
			level,
			module: this.module,
			message,
			...(correlationId !== undefined && { correlationId }),
			...context
		};

		// Output as JSON to stdout
		console.log(JSON.stringify(entry));

		// Add to in-memory buffer for log viewer
		// Extract non-standard fields as context
		const {
			timestamp: _ts,
			level: _lvl,
			module: _mod,
			message: _msg,
			correlationId: _cid,
			...restContext
		} = entry;
		const bufferEntry: Omit<BufferedLogEntry, 'id'> = {
			timestamp,
			level,
			module: this.module,
			message,
			...(correlationId !== undefined && { correlationId }),
			...(Object.keys(restContext).length > 0 && { context: restContext })
		};
		addLogEntry(bufferEntry);
	}

	/**
	 * Logs an error message.
	 * Always logged (highest priority).
	 */
	error(message: string, context?: Record<string, unknown>): void {
		this.log('error', message, context);
	}

	/**
	 * Logs a warning message.
	 * Logged at warn level and above.
	 */
	warn(message: string, context?: Record<string, unknown>): void {
		this.log('warn', message, context);
	}

	/**
	 * Logs an informational message.
	 * Logged at info level and above (default).
	 */
	info(message: string, context?: Record<string, unknown>): void {
		this.log('info', message, context);
	}

	/**
	 * Logs a debug message.
	 * Logged at debug level and above.
	 */
	debug(message: string, context?: Record<string, unknown>): void {
		this.log('debug', message, context);
	}

	/**
	 * Logs a trace message.
	 * Logged only at trace level (most verbose).
	 */
	trace(message: string, context?: Record<string, unknown>): void {
		this.log('trace', message, context);
	}

	/**
	 * Logs an HTTP request.
	 * - Logs at debug level with method, URL, and headers (redacted)
	 * - Includes request body only at trace level (Requirement 31.4)
	 * - Auto-includes correlation ID from async context if not provided (Requirement 31.2)
	 *
	 * @param method - HTTP method (GET, POST, etc.)
	 * @param url - Request URL
	 * @param options - Optional headers, body, and correlation ID
	 */
	logRequest(method: string, url: string, options?: RequestLogOptions): void {
		const currentLevel = getCurrentLogLevel();

		// Don't log at all if below debug level
		if (!shouldLog('debug', currentLevel)) {
			return;
		}

		const context: Record<string, unknown> = {
			method,
			url
		};

		// Auto-include correlation ID from async context if not provided (Requirement 31.2)
		const correlationId = options?.correlationId ?? getCorrelationId();
		if (correlationId) {
			context.correlationId = correlationId;
		}

		if (options?.headers) {
			context.headers = redactHeaders(options.headers);
		}

		// Include body only at trace level (Requirement 31.4)
		if (options?.body !== undefined && shouldLog('trace', currentLevel)) {
			context.body = options.body;
		}

		this.log('debug', `HTTP ${method} ${url}`, context);
	}

	/**
	 * Logs an HTTP response.
	 * - Logs at debug level with status code, URL, and duration
	 * - Includes response body only at trace level (Requirement 31.4)
	 * - Auto-includes correlation ID from async context if not provided (Requirement 31.2)
	 *
	 * @param statusCode - HTTP status code
	 * @param url - Request URL
	 * @param options - Optional headers, body, duration, and correlation ID
	 */
	logResponse(statusCode: number, url: string, options?: ResponseLogOptions): void {
		const currentLevel = getCurrentLogLevel();

		// Don't log at all if below debug level
		if (!shouldLog('debug', currentLevel)) {
			return;
		}

		const context: Record<string, unknown> = {
			statusCode,
			url
		};

		// Auto-include correlation ID from async context if not provided (Requirement 31.2)
		const correlationId = options?.correlationId ?? getCorrelationId();
		if (correlationId) {
			context.correlationId = correlationId;
		}

		if (options?.durationMs !== undefined) {
			context.durationMs = options.durationMs;
		}

		if (options?.headers) {
			context.headers = options.headers;
		}

		// Include body only at trace level (Requirement 31.4)
		if (options?.body !== undefined && shouldLog('trace', currentLevel)) {
			context.body = options.body;
		}

		this.log('debug', `HTTP ${statusCode} ${url}`, context);
	}
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Creates a logger instance for a specific module.
 *
 * @param module - Module/component name for log entries
 * @returns Logger instance
 *
 * @example
 * ```typescript
 * const logger = createLogger('sync');
 * logger.info('Starting sync', { connectorId: 1 });
 * ```
 */
export function createLogger(module: string): Logger {
	return new Logger(module);
}
