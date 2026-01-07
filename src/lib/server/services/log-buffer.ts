// Circular buffer for in-memory log storage with filtering and pagination

import type { LogLevel } from '$lib/schemas/settings';

export interface BufferedLogEntry {
	id: number;
	timestamp: string;
	level: LogLevel;
	module: string;
	message: string;
	correlationId?: string;
	context?: Record<string, unknown>;
}

export interface LogFilter {
	levels?: LogLevel[];
	module?: string;
	search?: string;
	correlationId?: string;
	since?: string;
	until?: string;
}

export interface LogPagination {
	limit: number;
	offset: number;
}

export interface LogQueryResult {
	entries: BufferedLogEntry[];
	total: number;
	hasMore: boolean;
}

const DEFAULT_BUFFER_SIZE = 10000;
let bufferSize = DEFAULT_BUFFER_SIZE;
let logBuffer: BufferedLogEntry[] = [];
let writePosition = 0;
let totalEntriesWritten = 0;
let hasWrapped = false;

// Clears existing entries if size is reduced
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

export function getBufferConfig(): { size: number; used: number; totalWritten: number } {
	return {
		size: bufferSize,
		used: hasWrapped ? bufferSize : writePosition,
		totalWritten: totalEntriesWritten
	};
}

export function clearLogBuffer(): void {
	logBuffer = [];
	writePosition = 0;
	totalEntriesWritten = 0;
	hasWrapped = false;
}

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

// Returns entries in reverse chronological order (newest first)
export function queryLogs(filter?: LogFilter, pagination?: LogPagination): LogQueryResult {
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

export function getLogEntryById(id: number): BufferedLogEntry | null {
	return logBuffer.find((entry) => entry?.id === id) ?? null;
}

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
