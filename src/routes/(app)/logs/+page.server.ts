/**
 * Server-side data loading for the log viewer page.
 */

import { type LogLevel, logLevels } from '$lib/schemas/settings';
import { createLogger } from '$lib/server/logger';
import {
	getBufferConfig,
	getLogLevelCounts,
	getUniqueModules,
	type LogFilter,
	queryLogs
} from '$lib/server/services/log-buffer';
import type { PageServerLoad } from './$types';

const logger = createLogger('log-viewer');

export const load: PageServerLoad = async ({ url, depends }) => {
	// Register custom dependency for selective invalidation
	depends('app:logs');

	// Log page access for testing the log viewer
	logger.info('Log viewer page accessed', { path: url.pathname });

	// Parse query parameters
	const levelsParam = url.searchParams.get('levels');
	const module = url.searchParams.get('module') ?? undefined;
	const search = url.searchParams.get('search') ?? undefined;
	const correlationId = url.searchParams.get('correlationId') ?? undefined;
	const limitParam = url.searchParams.get('limit');
	const offsetParam = url.searchParams.get('offset');

	// Parse log levels
	let levels: LogLevel[] | undefined;
	if (levelsParam) {
		const requestedLevels = levelsParam.split(',').map((l) => l.trim().toLowerCase());
		levels = requestedLevels.filter((l) => logLevels.includes(l as LogLevel)) as LogLevel[];
	}

	// Parse limit and offset
	const limit = limitParam ? Math.min(parseInt(limitParam, 10) || 100, 500) : 100;
	const offset = offsetParam ? Math.max(parseInt(offsetParam, 10) || 0, 0) : 0;

	// Build filter
	const filter: LogFilter = {
		...(levels && levels.length > 0 && { levels }),
		...(module && { module }),
		...(search && { search }),
		...(correlationId && { correlationId })
	};

	// Query logs
	const result = queryLogs(filter, { limit, offset });

	// Get additional metadata
	const bufferConfig = getBufferConfig();
	const levelCounts = getLogLevelCounts();
	const modules = getUniqueModules();

	return {
		entries: result.entries,
		total: result.total,
		hasMore: result.hasMore,
		buffer: bufferConfig,
		levelCounts,
		modules,
		filters: {
			levels: levels ?? [],
			module: module ?? '',
			search: search ?? '',
			correlationId: correlationId ?? '',
			limit,
			offset
		}
	};
};
