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

interface LogBufferState {
	bufferSize: number;
	buffer: BufferedLogEntry[];
	writePosition: number;
	totalEntriesWritten: number;
	hasWrapped: boolean;
}

declare global {
	var __logBufferState: LogBufferState | undefined;
}

function getLogBufferState(): LogBufferState {
	if (!globalThis.__logBufferState) {
		globalThis.__logBufferState = {
			bufferSize: DEFAULT_BUFFER_SIZE,
			buffer: [],
			writePosition: 0,
			totalEntriesWritten: 0,
			hasWrapped: false
		};
	}
	return globalThis.__logBufferState;
}

// Clears existing entries if size is reduced
export function configureBufferSize(size: number): void {
	const state = getLogBufferState();

	if (size < 100) {
		throw new Error('Buffer size must be at least 100 entries');
	}

	if (size < state.bufferSize) {
		// Clear and reset when reducing size
		clearLogBuffer();
	}

	state.bufferSize = size;
}

export function getBufferConfig(): { size: number; used: number; totalWritten: number } {
	const state = getLogBufferState();
	return {
		size: state.bufferSize,
		used: state.hasWrapped ? state.bufferSize : state.writePosition,
		totalWritten: state.totalEntriesWritten
	};
}

export function clearLogBuffer(): void {
	const state = getLogBufferState();
	state.buffer = [];
	state.writePosition = 0;
	state.totalEntriesWritten = 0;
	state.hasWrapped = false;
}

export function addLogEntry(entry: Omit<BufferedLogEntry, 'id'>): void {
	const state = getLogBufferState();
	const bufferedEntry: BufferedLogEntry = {
		...entry,
		id: ++state.totalEntriesWritten
	};

	if (state.writePosition >= state.bufferSize) {
		state.writePosition = 0;
		state.hasWrapped = true;
	}

	state.buffer[state.writePosition] = bufferedEntry;
	state.writePosition++;
}

function getAllEntriesOrdered(): BufferedLogEntry[] {
	const state = getLogBufferState();

	if (!state.hasWrapped) {
		return state.buffer.slice(0, state.writePosition);
	}

	// When wrapped, entries from writePosition to end are older
	// than entries from 0 to writePosition
	const olderEntries = state.buffer.slice(state.writePosition);
	const newerEntries = state.buffer.slice(0, state.writePosition);
	return [...olderEntries, ...newerEntries];
}

function applyFilters(entries: BufferedLogEntry[], filter: LogFilter): BufferedLogEntry[] {
	return entries.filter((entry) => {
		if (filter.levels && filter.levels.length > 0) {
			if (!filter.levels.includes(entry.level)) {
				return false;
			}
		}

		if (filter.module) {
			if (!entry.module.toLowerCase().includes(filter.module.toLowerCase())) {
				return false;
			}
		}

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

		if (filter.correlationId) {
			if (entry.correlationId !== filter.correlationId) {
				return false;
			}
		}

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
	let entries = getAllEntriesOrdered();

	if (filter) {
		entries = applyFilters(entries, filter);
	}

	const total = entries.length;
	entries = entries.reverse();

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
	const state = getLogBufferState();
	return state.buffer.find((entry) => entry?.id === id) ?? null;
}

export function getUniqueModules(): string[] {
	const state = getLogBufferState();
	const modules = new Set<string>();

	for (const entry of state.buffer) {
		if (entry) {
			modules.add(entry.module);
		}
	}

	return Array.from(modules).sort();
}

export function getLogLevelCounts(): Record<LogLevel, number> {
	const state = getLogBufferState();
	const counts: Record<LogLevel, number> = {
		error: 0,
		warn: 0,
		info: 0,
		debug: 0,
		trace: 0
	};

	for (const entry of state.buffer) {
		if (entry) {
			counts[entry.level]++;
		}
	}

	return counts;
}

export function exportLogsAsJson(filter?: LogFilter): string {
	const state = getLogBufferState();
	const result = queryLogs(filter, { limit: state.bufferSize, offset: 0 });
	return JSON.stringify(result.entries, null, 2);
}

export interface HybridLogQueryResult {
	entries: BufferedLogEntry[];
	total: number;
	hasMore: boolean;
	source: 'memory' | 'database' | 'hybrid';
}

export async function queryLogsHybrid(
	filter?: LogFilter,
	pagination?: LogPagination
): Promise<HybridLogQueryResult> {
	const limit = pagination?.limit ?? 100;
	const offset = pagination?.offset ?? 0;

	const memoryResult = queryLogs(filter, { limit, offset });

	if (memoryResult.entries.length >= limit) {
		return {
			...memoryResult,
			source: 'memory'
		};
	}

	try {
		const { queryPersistedLogs, isLogPersistenceEnabled } = await import(
			'$lib/server/services/log-persistence'
		);

		if (!isLogPersistenceEnabled()) {
			return {
				...memoryResult,
				source: 'memory'
			};
		}

		const dbFilter = filter
			? {
					...(filter.levels && { levels: filter.levels }),
					...(filter.module && { module: filter.module }),
					...(filter.search && { search: filter.search }),
					...(filter.correlationId && { correlationId: filter.correlationId }),
					...(filter.since && { since: new Date(filter.since) }),
					...(filter.until && { until: new Date(filter.until) })
				}
			: undefined;

		const dbOffset = Math.max(0, offset - memoryResult.total);
		const dbLimit = limit - memoryResult.entries.length;

		if (dbLimit <= 0) {
			return {
				...memoryResult,
				source: 'memory'
			};
		}

		const dbResult = await queryPersistedLogs(dbFilter, { limit: dbLimit, offset: dbOffset });

		// De-duplicate using timestamp+module+message since memory IDs and DB IDs are independent sequences
		const memoryKeys = new Set(
			memoryResult.entries.map((e) => `${e.timestamp}|${e.module}|${e.message}`)
		);
		const uniqueDbEntries = dbResult.entries
			.filter((e) => !memoryKeys.has(`${e.timestamp}|${e.module}|${e.message}`))
			.map((e) => ({
				...e,
				id: -e.id
			}));

		const combinedEntries = [...memoryResult.entries, ...uniqueDbEntries];
		combinedEntries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

		const combinedTotal = memoryResult.total + dbResult.total;

		return {
			entries: combinedEntries.slice(0, limit),
			total: combinedTotal,
			hasMore: offset + limit < combinedTotal,
			source: uniqueDbEntries.length > 0 ? 'hybrid' : 'memory'
		};
	} catch {
		return {
			...memoryResult,
			source: 'memory'
		};
	}
}
