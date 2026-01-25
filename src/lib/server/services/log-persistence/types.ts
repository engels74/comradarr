import type { LogLevel } from '$lib/schemas/settings';

export interface PersistedLogEntry {
	timestamp: Date;
	level: LogLevel;
	module: string;
	message: string;
	correlationId?: string;
	context?: Record<string, unknown>;
}

export interface LogPersistenceFilter {
	levels?: LogLevel[];
	module?: string;
	search?: string;
	correlationId?: string;
	since?: Date;
	until?: Date;
}

export interface LogPersistencePagination {
	limit: number;
	offset: number;
}

export interface PersistedLogQueryResult {
	entries: Array<{
		id: number;
		timestamp: string;
		level: LogLevel;
		module: string;
		message: string;
		correlationId?: string;
		context?: Record<string, unknown>;
	}>;
	total: number;
	hasMore: boolean;
}

export interface LogPruningResult {
	success: boolean;
	logsDeleted: number;
	durationMs: number;
	error?: string;
}
