/**
 * In-memory log buffer service for the log viewer.
 * Captures structured log entries in a circular buffer with configurable size.
 * Provides filtering and pagination for the log viewer UI.
 */

import type { LogLevel } from '$lib/schemas/settings';

// =============================================================================
// Types
// =============================================================================

/**
 * Buffered log entry with unique ID.
 */
export interface BufferedLogEntry {
	/** Unique identifier for the log entry */
	id: number;
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
	context?: Record<string, unknown>;
}

/**
 * Filter options for log queries.
 */
export interface LogFilter {
	/** Filter by log levels */
	levels?: LogLevel[];
	/** Filter by module name (partial match) */
	module?: string;
	/** Filter by message content (partial match) */
	search?: string;
	/** Filter by correlation ID */
	correlationId?: string;
	/** Filter entries after this timestamp */
	since?: string;
	/** Filter entries before this timestamp */
	until?: string;
}

/**
 * Pagination options.
 */
export interface LogPagination {
	/** Number of entries to return */
	limit: number;
	/** Offset from the start */
	offset: number;
}

/**
 * Log query result with pagination info.
 */
export interface LogQueryResult {
	/** Log entries matching the query */
	entries: BufferedLogEntry[];
	/** Total count of matching entries */
	total: number;
	/** Whether more entries are available */
	hasMore: boolean;
}

// =============================================================================
// Log Buffer Configuration
// =============================================================================

/** Maximum number of log entries to keep in buffer */
const DEFAULT_BUFFER_SIZE = 10000;

/** Current buffer size (can be configured) */
let bufferSize = DEFAULT_BUFFER_SIZE;

// =============================================================================
// Log Buffer State
// =============================================================================

/** Circular buffer storage */
let logBuffer: BufferedLogEntry[] = [];

/** Current write position in the circular buffer */
let writePosition = 0;

/** Total entries written (for ID generation) */
let totalEntriesWritten = 0;

/** Whether the buffer has wrapped around */
let hasWrapped = false;

// =============================================================================
// Buffer Management Functions
// =============================================================================

/**
 * Configures the log buffer size.
 * Clears existing entries if size is reduced.
 *
 * @param size - New buffer size
 */
export function configureBufferSize(size: number): void {
	if (size < 100) {
		throw new Error('Buffer size must be at least 100 entries');
	}

	if (size < bufferSize) {
		// Clear and reset when reducing size
		clearLogBuffer();
	}

	bufferSize = size;
}

/**
 * Gets the current buffer configuration.
 */
export function getBufferConfig(): { size: number; used: number; totalWritten: number } {
	return {
		size: bufferSize,
		used: hasWrapped ? bufferSize : writePosition,
		totalWritten: totalEntriesWritten
	};
}

/**
 * Clears all entries from the log buffer.
 */
export function clearLogBuffer(): void {
	logBuffer = [];
	writePosition = 0;
	totalEntriesWritten = 0;
	hasWrapped = false;
}

/**
 * Adds a log entry to the buffer.
 * Called internally by the logger.
 *
 * @param entry - Log entry to add (without ID)
 */
export function addLogEntry(entry: Omit<BufferedLogEntry, 'id'>): void {
	const bufferedEntry: BufferedLogEntry = {
		...entry,
		id: ++totalEntriesWritten
	};

	if (writePosition >= bufferSize) {
		writePosition = 0;
		hasWrapped = true;
	}

	logBuffer[writePosition] = bufferedEntry;
	writePosition++;
}

// =============================================================================
// Query Functions
// =============================================================================

/**
 * Gets all entries in chronological order.
 * Internal function for applying filters.
 */
function getAllEntriesOrdered(): BufferedLogEntry[] {
	if (!hasWrapped) {
		return logBuffer.slice(0, writePosition);
	}

	// When wrapped, entries from writePosition to end are older
	// than entries from 0 to writePosition
	const olderEntries = logBuffer.slice(writePosition);
	const newerEntries = logBuffer.slice(0, writePosition);
	return [...olderEntries, ...newerEntries];
}

/**
 * Applies filters to log entries.
 */
function applyFilters(entries: BufferedLogEntry[], filter: LogFilter): BufferedLogEntry[] {
	return entries.filter((entry) => {
		// Filter by log levels
		if (filter.levels && filter.levels.length > 0) {
			if (!filter.levels.includes(entry.level)) {
				return false;
			}
		}

		// Filter by module
		if (filter.module) {
			if (!entry.module.toLowerCase().includes(filter.module.toLowerCase())) {
				return false;
			}
		}

		// Filter by search term in message
		if (filter.search) {
			const searchLower = filter.search.toLowerCase();
			const messageMatch = entry.message.toLowerCase().includes(searchLower);
			const moduleMatch = entry.module.toLowerCase().includes(searchLower);
			const contextMatch = entry.context
				? JSON.stringify(entry.context).toLowerCase().includes(searchLower)
				: false;

			if (!messageMatch && !moduleMatch && !contextMatch) {
				return false;
			}
		}

		// Filter by correlation ID
		if (filter.correlationId) {
			if (entry.correlationId !== filter.correlationId) {
				return false;
			}
		}

		// Filter by time range
		if (filter.since) {
			if (entry.timestamp < filter.since) {
				return false;
			}
		}

		if (filter.until) {
			if (entry.timestamp > filter.until) {
				return false;
			}
		}

		return true;
	});
}

/**
 * Queries log entries with optional filtering and pagination.
 * Returns entries in reverse chronological order (newest first).
 *
 * @param filter - Optional filter criteria
 * @param pagination - Optional pagination settings
 * @returns Query result with entries and pagination info
 */
export function queryLogs(
	filter?: LogFilter,
	pagination?: LogPagination
): LogQueryResult {
	// Get all entries in chronological order
	let entries = getAllEntriesOrdered();

	// Apply filters
	if (filter) {
		entries = applyFilters(entries, filter);
	}

	const total = entries.length;

	// Reverse for newest-first order
	entries = entries.reverse();

	// Apply pagination
	const limit = pagination?.limit ?? 100;
	const offset = pagination?.offset ?? 0;

	const paginatedEntries = entries.slice(offset, offset + limit);

	return {
		entries: paginatedEntries,
		total,
		hasMore: offset + limit < total
	};
}

/**
 * Gets a single log entry by ID.
 *
 * @param id - Log entry ID
 * @returns Log entry or null if not found
 */
export function getLogEntryById(id: number): BufferedLogEntry | null {
	return logBuffer.find((entry) => entry?.id === id) ?? null;
}

/**
 * Gets unique module names from the buffer.
 * Useful for filter UI.
 */
export function getUniqueModules(): string[] {
	const modules = new Set<string>();

	for (const entry of logBuffer) {
		if (entry) {
			modules.add(entry.module);
		}
	}

	return Array.from(modules).sort();
}

/**
 * Gets log level counts from the buffer.
 * Useful for summary display.
 */
export function getLogLevelCounts(): Record<LogLevel, number> {
	const counts: Record<LogLevel, number> = {
		error: 0,
		warn: 0,
		info: 0,
		debug: 0,
		trace: 0
	};

	for (const entry of logBuffer) {
		if (entry) {
			counts[entry.level]++;
		}
	}

	return counts;
}

/**
 * Exports logs as JSON for download.
 *
 * @param filter - Optional filter criteria
 * @returns JSON string of log entries
 */
export function exportLogsAsJson(filter?: LogFilter): string {
	const result = queryLogs(filter, { limit: bufferSize, offset: 0 });
	return JSON.stringify(result.entries, null, 2);
}
