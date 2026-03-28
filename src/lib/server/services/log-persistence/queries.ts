import { and, count, desc, eq, gte, ilike, inArray, lte, or, sql } from 'drizzle-orm';
import type { LogLevel } from '$lib/schemas/settings';
import { db } from '$lib/server/db';
import { applicationLogs } from '$lib/server/db/schema';
import type {
	LogPersistenceFilter,
	LogPersistencePagination,
	PersistedLogQueryResult
} from './types';

export async function queryPersistedLogs(
	filter?: LogPersistenceFilter,
	pagination?: LogPersistencePagination
): Promise<PersistedLogQueryResult> {
	const conditions = [];

	if (filter?.levels && filter.levels.length > 0) {
		conditions.push(inArray(applicationLogs.level, filter.levels));
	}

	if (filter?.module) {
		conditions.push(ilike(applicationLogs.module, `%${filter.module}%`));
	}

	if (filter?.search) {
		const searchPattern = `%${filter.search}%`;
		conditions.push(
			or(
				ilike(applicationLogs.message, searchPattern),
				ilike(applicationLogs.module, searchPattern),
				sql`${applicationLogs.context}::text ILIKE ${searchPattern}`
			)
		);
	}

	if (filter?.correlationId) {
		conditions.push(eq(applicationLogs.correlationId, filter.correlationId));
	}

	if (filter?.since) {
		conditions.push(gte(applicationLogs.timestamp, filter.since));
	}

	if (filter?.until) {
		conditions.push(lte(applicationLogs.timestamp, filter.until));
	}

	const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
	const limit = pagination?.limit ?? 100;
	const offset = pagination?.offset ?? 0;

	const [entries, totalResult] = await Promise.all([
		db
			.select()
			.from(applicationLogs)
			.where(whereClause)
			.orderBy(desc(applicationLogs.timestamp))
			.limit(limit)
			.offset(offset),
		db.select({ count: count() }).from(applicationLogs).where(whereClause)
	]);

	const total = totalResult[0]?.count ?? 0;

	return {
		entries: entries.map((entry) => {
			const result: {
				id: number;
				timestamp: string;
				level: LogLevel;
				module: string;
				message: string;
				correlationId?: string;
				context?: Record<string, unknown>;
			} = {
				id: entry.id,
				timestamp: entry.timestamp.toISOString(),
				level: entry.level as LogLevel,
				module: entry.module,
				message: entry.message
			};

			if (entry.correlationId) {
				result.correlationId = entry.correlationId;
			}

			if (entry.context) {
				result.context = entry.context as Record<string, unknown>;
			}

			return result;
		}),
		total,
		hasMore: offset + limit < total
	};
}

export async function insertLogBatch(
	entries: Array<{
		timestamp: Date;
		level: string;
		module: string;
		message: string;
		correlationId?: string;
		context?: Record<string, unknown>;
	}>
): Promise<number> {
	if (entries.length === 0) return 0;

	const values = entries.map((entry) => ({
		timestamp: entry.timestamp,
		level: entry.level,
		module: entry.module,
		message: entry.message,
		correlationId: entry.correlationId ?? null,
		context: entry.context ?? null
	}));

	const result = await db
		.insert(applicationLogs)
		.values(values)
		.returning({ id: applicationLogs.id });

	return result.length;
}

export async function deleteLogsBefore(
	cutoffDate: Date,
	batchSize: number = 10000
): Promise<number> {
	const result = await db.execute(sql`
		DELETE FROM application_logs
		WHERE id IN (
			SELECT id FROM application_logs
			WHERE created_at < ${cutoffDate}
			LIMIT ${batchSize}
		)
		RETURNING id
	`);

	return result.length;
}
