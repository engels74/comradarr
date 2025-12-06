/**
 * API endpoint for log viewer.
 * Provides access to the in-memory log buffer with filtering and pagination.
 *
 * Query Parameters:
 * - limit: Number of entries to return (default 100, max 500)
 * - offset: Offset for pagination (default 0)
 * - levels: Comma-separated log levels to include (error,warn,info,debug,trace)
 * - module: Filter by module name (partial match)
 * - search: Search in message and context
 * - correlationId: Filter by correlation ID
 * - since: ISO timestamp to filter entries after
 * - until: ISO timestamp to filter entries before
 *
 * DELETE: Clears the log buffer
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { logLevels, type LogLevel } from '$lib/schemas/settings';
import {
	queryLogs,
	clearLogBuffer,
	getBufferConfig,
	getLogLevelCounts,
	getUniqueModules,
	exportLogsAsJson,
	type LogFilter
} from '$lib/server/services/log-buffer';
import { requireScope } from '$lib/server/auth';

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;

export const GET: RequestHandler = async ({ url, locals }) => {
	// Require read scope for log access
	requireScope(locals, 'read');

	// Parse query parameters
	const limitParam = url.searchParams.get('limit');
	const offsetParam = url.searchParams.get('offset');
	const levelsParam = url.searchParams.get('levels');
	const module = url.searchParams.get('module') ?? undefined;
	const search = url.searchParams.get('search') ?? undefined;
	const correlationId = url.searchParams.get('correlationId') ?? undefined;
	const since = url.searchParams.get('since') ?? undefined;
	const until = url.searchParams.get('until') ?? undefined;
	const format = url.searchParams.get('format'); // 'json' for export

	// Validate and parse limit
	let limit = DEFAULT_LIMIT;
	if (limitParam) {
		const parsed = parseInt(limitParam, 10);
		if (isNaN(parsed) || parsed < 1) {
			error(400, 'Invalid limit parameter');
		}
		limit = Math.min(parsed, MAX_LIMIT);
	}

	// Parse offset
	let offset = 0;
	if (offsetParam) {
		const parsed = parseInt(offsetParam, 10);
		if (isNaN(parsed) || parsed < 0) {
			error(400, 'Invalid offset parameter');
		}
		offset = parsed;
	}

	// Parse log levels
	let levels: LogLevel[] | undefined;
	if (levelsParam) {
		const requestedLevels = levelsParam.split(',').map((l) => l.trim().toLowerCase());
		levels = requestedLevels.filter((l) => logLevels.includes(l as LogLevel)) as LogLevel[];
		if (levels.length === 0) {
			error(400, 'Invalid levels parameter. Valid levels are: error, warn, info, debug, trace');
		}
	}

	// Build filter
	const filter: LogFilter = {
		...(levels && { levels }),
		...(module && { module }),
		...(search && { search }),
		...(correlationId && { correlationId }),
		...(since && { since }),
		...(until && { until })
	};

	// Handle export format
	if (format === 'json') {
		const exportData = exportLogsAsJson(filter);
		return new Response(exportData, {
			headers: {
				'Content-Type': 'application/json',
				'Content-Disposition': `attachment; filename="comradarr-logs-${new Date().toISOString().slice(0, 10)}.json"`
			}
		});
	}

	// Query logs
	const result = queryLogs(filter, { limit, offset });

	// Get additional metadata
	const bufferConfig = getBufferConfig();
	const levelCounts = getLogLevelCounts();
	const modules = getUniqueModules();

	return json({
		entries: result.entries,
		total: result.total,
		hasMore: result.hasMore,
		buffer: bufferConfig,
		levelCounts,
		modules
	});
};

export const DELETE: RequestHandler = async ({ locals }) => {
	// Require full scope for clearing logs
	requireScope(locals, 'full');

	clearLogBuffer();

	return json({ success: true, message: 'Log buffer cleared' });
};
