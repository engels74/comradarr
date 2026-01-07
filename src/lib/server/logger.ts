import { type LogLevel, logLevels } from '$lib/schemas/settings';
import { getCorrelationId } from '$lib/server/context';
import { addLogEntry, type BufferedLogEntry } from '$lib/server/services/log-buffer';

export interface LogEntry {
	timestamp: string;
	level: LogLevel;
	module: string;
	message: string;
	correlationId?: string;
	[key: string]: unknown;
}

export interface RequestLogOptions {
	headers?: Record<string, string>;
	body?: unknown;
	correlationId?: string;
}

export interface ResponseLogOptions {
	headers?: Record<string, string>;
	body?: unknown;
	durationMs?: number;
	correlationId?: string;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
	error: 0,
	warn: 1,
	info: 2,
	debug: 3,
	trace: 4
};

const DEFAULT_LOG_LEVEL: LogLevel = 'info';

let cachedLogLevel: LogLevel | null = null;

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

export function setLogLevel(level: LogLevel): void {
	cachedLogLevel = level;
}

export function clearLogLevelCache(): void {
	cachedLogLevel = null;
}

/** Should be called once at application startup. */
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

export function shouldLog(messageLevel: LogLevel, currentLevel: LogLevel): boolean {
	return LOG_LEVEL_PRIORITY[messageLevel] <= LOG_LEVEL_PRIORITY[currentLevel];
}

const SENSITIVE_HEADERS = new Set([
	'authorization',
	'x-api-key',
	'cookie',
	'set-cookie',
	'x-auth-token'
]);

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

export class Logger {
	private readonly module: string;

	constructor(module: string) {
		this.module = module;
	}

	private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
		const currentLevel = getCurrentLogLevel();

		if (!shouldLog(level, currentLevel)) {
			return;
		}

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

		console.log(JSON.stringify(entry));

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

	error(message: string, context?: Record<string, unknown>): void {
		this.log('error', message, context);
	}

	warn(message: string, context?: Record<string, unknown>): void {
		this.log('warn', message, context);
	}

	info(message: string, context?: Record<string, unknown>): void {
		this.log('info', message, context);
	}

	debug(message: string, context?: Record<string, unknown>): void {
		this.log('debug', message, context);
	}

	trace(message: string, context?: Record<string, unknown>): void {
		this.log('trace', message, context);
	}

	logRequest(method: string, url: string, options?: RequestLogOptions): void {
		const currentLevel = getCurrentLogLevel();

		if (!shouldLog('debug', currentLevel)) {
			return;
		}

		const context: Record<string, unknown> = {
			method,
			url
		};

		const correlationId = options?.correlationId ?? getCorrelationId();
		if (correlationId) {
			context.correlationId = correlationId;
		}

		if (options?.headers) {
			context.headers = redactHeaders(options.headers);
		}

		if (options?.body !== undefined && shouldLog('trace', currentLevel)) {
			context.body = options.body;
		}

		this.log('debug', `HTTP ${method} ${url}`, context);
	}

	logResponse(statusCode: number, url: string, options?: ResponseLogOptions): void {
		const currentLevel = getCurrentLogLevel();

		if (!shouldLog('debug', currentLevel)) {
			return;
		}

		const context: Record<string, unknown> = {
			statusCode,
			url
		};

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

		if (options?.body !== undefined && shouldLog('trace', currentLevel)) {
			context.body = options.body;
		}

		this.log('debug', `HTTP ${statusCode} ${url}`, context);
	}
}

export function createLogger(module: string): Logger {
	return new Logger(module);
}
