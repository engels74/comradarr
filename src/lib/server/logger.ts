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

export function sanitizeUrl(url: string): string {
	try {
		const parsed = new URL(url);
		if (parsed.username || parsed.password) {
			parsed.username = parsed.username ? '[REDACTED]' : '';
			parsed.password = parsed.password ? '[REDACTED]' : '';
		}
		return parsed.toString();
	} catch {
		return url;
	}
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

		// Dynamic import to avoid circular dependency: logger -> log-persistence -> db -> logger
		import('$lib/server/services/log-persistence')
			.then(({ add, isLogPersistenceEnabled }) => {
				if (isLogPersistenceEnabled()) {
					add({
						timestamp: new Date(timestamp),
						level,
						module: this.module,
						message,
						...(correlationId !== undefined && { correlationId }),
						...(Object.keys(restContext).length > 0 && { context: restContext })
					});
				}
			})
			.catch(() => {
				// Ignore - persistence is optional
			});
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
}

export function createLogger(module: string): Logger {
	return new Logger(module);
}
