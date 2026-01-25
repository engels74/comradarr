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

import { error, json } from '@sveltejs/kit';
import { type LogLevel, logLevels } from '$lib/schemas/settings';
import { requireScope } from '$lib/server/auth';
import {
	clearLogBuffer,
	exportLogsAsJson,
	getBufferConfig,
	getLogLevelCounts,
	getUniqueModules,
	type LogFilter,
	queryLogs,
	queryLogsHybrid
} from '$lib/server/services/log-buffer';
import type { RequestHandler } from './$types';

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;

export const GET: RequestHandler = async ({ url, locals }) => {
	requireScope(locals, 'read');

	const limitParam = url.searchParams.get('limit');
	const offsetParam = url.searchParams.get('offset');
	const levelsParam = url.searchParams.get('levels');
	const module = url.searchParams.get('module') ?? undefined;
	const search = url.searchParams.get('search') ?? undefined;
	const correlationId = url.searchParams.get('correlationId') ?? undefined;
	const since = url.searchParams.get('since') ?? undefined;
	const until = url.searchParams.get('until') ?? undefined;
	const format = url.searchParams.get('format');
	const source = url.searchParams.get('source') ?? 'hybrid';

	let limit = DEFAULT_LIMIT;
	if (limitParam) {
		const parsed = parseInt(limitParam, 10);
		if (Number.isNaN(parsed) || parsed < 1) {
			error(400, 'Invalid limit parameter');
		}
		limit = Math.min(parsed, MAX_LIMIT);
	}

	let offset = 0;
	if (offsetParam) {
		const parsed = parseInt(offsetParam, 10);
		if (Number.isNaN(parsed) || parsed < 0) {
			error(400, 'Invalid offset parameter');
		}
		offset = parsed;
	}

	let levels: LogLevel[] | undefined;
	if (levelsParam) {
		const requestedLevels = levelsParam.split(',').map((l) => l.trim().toLowerCase());
		levels = requestedLevels.filter((l) => logLevels.includes(l as LogLevel)) as LogLevel[];
		if (levels.length === 0) {
			error(400, 'Invalid levels parameter. Valid levels are: error, warn, info, debug, trace');
		}
	}

	const filter: LogFilter = {
		...(levels && { levels }),
		...(module && { module }),
		...(search && { search }),
		...(correlationId && { correlationId }),
		...(since && { since }),
		...(until && { until })
	};

	if (format === 'json') {
		const exportData = exportLogsAsJson(filter);
		return new Response(exportData, {
			headers: {
				'Content-Type': 'application/json',
				'Content-Disposition': `attachment; filename="comradarr-logs-${new Date().toISOString().slice(0, 10)}.json"`
			}
		});
	}

	const bufferConfig = getBufferConfig();
	const levelCounts = getLogLevelCounts();
	const modules = getUniqueModules();

	if (source === 'hybrid') {
		const result = await queryLogsHybrid(filter, { limit, offset });
		return json({
			entries: result.entries,
			total: result.total,
			hasMore: result.hasMore,
			source: result.source,
			buffer: bufferConfig,
			levelCounts,
			modules
		});
	}

	const result = queryLogs(filter, { limit, offset });

	return json({
		entries: result.entries,
		total: result.total,
		hasMore: result.hasMore,
		source: 'memory',
		buffer: bufferConfig,
		levelCounts,
		modules
	});
};

export const DELETE: RequestHandler = async ({ locals }) => {
	requireScope(locals, 'full');

	clearLogBuffer();

	return json({ success: true, message: 'Log buffer cleared' });
};
