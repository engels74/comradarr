import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { connectors, episodes, movies, requestQueue, searchRegistry } from '$lib/server/db/schema';
import { QUEUE_CONFIG } from './config';
import { calculatePriority } from './priority-calculator';
import type {
	ContentType,
	DequeueOptions,
	DequeueResult,
	EnqueueOptions,
	EnqueueResult,
	PriorityInput,
	QueueControlResult,
	QueueItem,
	QueueStatus,
	SearchType
} from './types';

/** Idempotent - running multiple times won't create duplicates. */
export async function enqueuePendingItems(
	connectorId: number,
	options: EnqueueOptions = {}
): Promise<EnqueueResult> {
	const startTime = Date.now();
	const batchSize = options.batchSize ?? QUEUE_CONFIG.DEFAULT_BATCH_SIZE;
	const scheduledAt = options.scheduledAt ?? new Date();

	try {
		const connector = await db
			.select({ id: connectors.id, type: connectors.type })
			.from(connectors)
			.where(eq(connectors.id, connectorId))
			.limit(1);

		if (connector.length === 0) {
			return {
				success: false,
				connectorId,
				itemsEnqueued: 0,
				itemsSkipped: 0,
				durationMs: Date.now() - startTime,
				error: `Connector ${connectorId} not found`
			};
		}

		const connectorType = connector[0]!.type as 'sonarr' | 'radarr' | 'whisparr';

		let totalEnqueued = 0;
		let totalSkipped = 0;

		if (connectorType === 'radarr') {
			const result = await enqueueMovies(connectorId, batchSize, scheduledAt);
			totalEnqueued = result.enqueued;
			totalSkipped = result.skipped;
		} else {
			const result = await enqueueEpisodes(connectorId, batchSize, scheduledAt);
			totalEnqueued = result.enqueued;
			totalSkipped = result.skipped;
		}

		return {
			success: true,
			connectorId,
			itemsEnqueued: totalEnqueued,
			itemsSkipped: totalSkipped,
			durationMs: Date.now() - startTime
		};
	} catch (error) {
		return {
			success: false,
			connectorId,
			itemsEnqueued: 0,
			itemsSkipped: 0,
			durationMs: Date.now() - startTime,
			error: error instanceof Error ? error.message : String(error)
		};
	}
}

async function enqueueEpisodes(
	connectorId: number,
	batchSize: number,
	scheduledAt: Date
): Promise<{ enqueued: number; skipped: number }> {
	const pendingRegistries = await db
		.select({
			registryId: searchRegistry.id,
			connectorId: searchRegistry.connectorId,
			contentType: searchRegistry.contentType,
			contentId: searchRegistry.contentId,
			searchType: searchRegistry.searchType,
			attemptCount: searchRegistry.attemptCount,
			createdAt: searchRegistry.createdAt,
			airDate: episodes.airDate
		})
		.from(searchRegistry)
		.innerJoin(episodes, eq(episodes.id, searchRegistry.contentId))
		.leftJoin(requestQueue, eq(requestQueue.searchRegistryId, searchRegistry.id))
		.where(
			and(
				eq(searchRegistry.connectorId, connectorId),
				eq(searchRegistry.contentType, 'episode'),
				eq(searchRegistry.state, 'pending'),
				isNull(requestQueue.id)
			)
		);

	if (pendingRegistries.length === 0) {
		return { enqueued: 0, skipped: 0 };
	}

	const now = new Date();
	const itemsToEnqueue: Array<{
		registryId: number;
		connectorId: number;
		priority: number;
	}> = [];

	for (const registry of pendingRegistries) {
		const priorityInput: PriorityInput = {
			searchType: registry.searchType as SearchType,
			contentDate: registry.airDate,
			discoveredAt: registry.createdAt,
			userPriorityOverride: 0, // TODO: Support user priority override
			attemptCount: registry.attemptCount
		};

		const { score } = calculatePriority(priorityInput, undefined, now);

		itemsToEnqueue.push({
			registryId: registry.registryId,
			connectorId: registry.connectorId,
			priority: score
		});
	}

	let totalEnqueued = 0;

	for (let i = 0; i < itemsToEnqueue.length; i += batchSize) {
		const batch = itemsToEnqueue.slice(i, i + batchSize);
		const registryIds = batch.map((item) => item.registryId);

		await db
			.update(searchRegistry)
			.set({
				state: 'queued',
				priority: sql`CASE ${searchRegistry.id} ${batch.map((item) => sql`WHEN ${item.registryId} THEN ${item.priority}`).reduce((acc, curr) => sql`${acc} ${curr}`)} END`,
				updatedAt: now
			})
			.where(inArray(searchRegistry.id, registryIds));

		const inserted = await db
			.insert(requestQueue)
			.values(
				batch.map((item) => ({
					searchRegistryId: item.registryId,
					connectorId: item.connectorId,
					priority: item.priority,
					scheduledAt
				}))
			)
			.onConflictDoNothing()
			.returning({ id: requestQueue.id });

		totalEnqueued += inserted.length;
	}

	return {
		enqueued: totalEnqueued,
		skipped: pendingRegistries.length - totalEnqueued
	};
}

async function enqueueMovies(
	connectorId: number,
	batchSize: number,
	scheduledAt: Date
): Promise<{ enqueued: number; skipped: number }> {
	const pendingRegistries = await db
		.select({
			registryId: searchRegistry.id,
			connectorId: searchRegistry.connectorId,
			contentType: searchRegistry.contentType,
			contentId: searchRegistry.contentId,
			searchType: searchRegistry.searchType,
			attemptCount: searchRegistry.attemptCount,
			createdAt: searchRegistry.createdAt,
			year: movies.year
		})
		.from(searchRegistry)
		.innerJoin(movies, eq(movies.id, searchRegistry.contentId))
		.leftJoin(requestQueue, eq(requestQueue.searchRegistryId, searchRegistry.id))
		.where(
			and(
				eq(searchRegistry.connectorId, connectorId),
				eq(searchRegistry.contentType, 'movie'),
				eq(searchRegistry.state, 'pending'),
				isNull(requestQueue.id)
			)
		);

	if (pendingRegistries.length === 0) {
		return { enqueued: 0, skipped: 0 };
	}

	const now = new Date();
	const itemsToEnqueue: Array<{
		registryId: number;
		connectorId: number;
		priority: number;
	}> = [];

	for (const registry of pendingRegistries) {
		const contentDate = registry.year ? new Date(registry.year, 0, 1) : null;

		const priorityInput: PriorityInput = {
			searchType: registry.searchType as SearchType,
			contentDate,
			discoveredAt: registry.createdAt,
			userPriorityOverride: 0, // TODO: Support user priority override
			attemptCount: registry.attemptCount
		};

		const { score } = calculatePriority(priorityInput, undefined, now);

		itemsToEnqueue.push({
			registryId: registry.registryId,
			connectorId: registry.connectorId,
			priority: score
		});
	}

	let totalEnqueued = 0;

	for (let i = 0; i < itemsToEnqueue.length; i += batchSize) {
		const batch = itemsToEnqueue.slice(i, i + batchSize);
		const registryIds = batch.map((item) => item.registryId);

		await db
			.update(searchRegistry)
			.set({
				state: 'queued',
				priority: sql`CASE ${searchRegistry.id} ${batch.map((item) => sql`WHEN ${item.registryId} THEN ${item.priority}`).reduce((acc, curr) => sql`${acc} ${curr}`)} END`,
				updatedAt: now
			})
			.where(inArray(searchRegistry.id, registryIds));

		const inserted = await db
			.insert(requestQueue)
			.values(
				batch.map((item) => ({
					searchRegistryId: item.registryId,
					connectorId: item.connectorId,
					priority: item.priority,
					scheduledAt
				}))
			)
			.onConflictDoNothing()
			.returning({ id: requestQueue.id });

		totalEnqueued += inserted.length;
	}

	return {
		enqueued: totalEnqueued,
		skipped: pendingRegistries.length - totalEnqueued
	};
}

/** Atomic operation - concurrent calls will get different items. */
export async function dequeuePriorityItems(
	connectorId: number,
	options: DequeueOptions = {}
): Promise<DequeueResult> {
	const startTime = Date.now();
	const limit = Math.min(
		options.limit ?? QUEUE_CONFIG.DEFAULT_DEQUEUE_LIMIT,
		QUEUE_CONFIG.MAX_DEQUEUE_LIMIT
	);
	const scheduledBefore = options.scheduledBefore ?? new Date();

	try {
		const connector = await db
			.select({ id: connectors.id, queuePaused: connectors.queuePaused })
			.from(connectors)
			.where(eq(connectors.id, connectorId))
			.limit(1);

		if (connector.length === 0) {
			return {
				success: false,
				connectorId,
				items: [],
				durationMs: Date.now() - startTime,
				error: `Connector ${connectorId} not found`
			};
		}

		if (connector[0]!.queuePaused) {
			return {
				success: true,
				connectorId,
				items: [],
				durationMs: Date.now() - startTime
			};
		}

		const itemsToDequeue = await db
			.select({
				id: requestQueue.id,
				searchRegistryId: requestQueue.searchRegistryId,
				connectorId: requestQueue.connectorId,
				priority: requestQueue.priority,
				scheduledAt: requestQueue.scheduledAt,
				contentType: searchRegistry.contentType,
				contentId: searchRegistry.contentId,
				searchType: searchRegistry.searchType
			})
			.from(requestQueue)
			.innerJoin(searchRegistry, eq(searchRegistry.id, requestQueue.searchRegistryId))
			.where(
				and(
					eq(requestQueue.connectorId, connectorId),
					sql`${requestQueue.scheduledAt} <= ${scheduledBefore}`
				)
			)
			.orderBy(desc(requestQueue.priority), asc(requestQueue.scheduledAt))
			.limit(limit);

		if (itemsToDequeue.length === 0) {
			return {
				success: true,
				connectorId,
				items: [],
				durationMs: Date.now() - startTime
			};
		}

		const queueIds = itemsToDequeue.map((item) => item.id);
		const registryIds = itemsToDequeue.map((item) => item.searchRegistryId);

		await db.delete(requestQueue).where(inArray(requestQueue.id, queueIds));

		const now = new Date();
		await db
			.update(searchRegistry)
			.set({
				state: 'searching',
				lastSearched: now,
				updatedAt: now
			})
			.where(inArray(searchRegistry.id, registryIds));

		const items: QueueItem[] = itemsToDequeue.map((item) => ({
			id: item.id,
			searchRegistryId: item.searchRegistryId,
			connectorId: item.connectorId,
			contentType: item.contentType as ContentType,
			contentId: item.contentId,
			searchType: item.searchType as SearchType,
			priority: item.priority,
			scheduledAt: item.scheduledAt
		}));

		return {
			success: true,
			connectorId,
			items,
			durationMs: Date.now() - startTime
		};
	} catch (error) {
		return {
			success: false,
			connectorId,
			items: [],
			durationMs: Date.now() - startTime,
			error: error instanceof Error ? error.message : String(error)
		};
	}
}

export async function pauseQueue(connectorId: number): Promise<QueueControlResult> {
	const startTime = Date.now();

	try {
		const result = await db
			.update(connectors)
			.set({
				queuePaused: true,
				updatedAt: new Date()
			})
			.where(eq(connectors.id, connectorId))
			.returning({ id: connectors.id });

		if (result.length === 0) {
			return {
				success: false,
				connectorId,
				itemsAffected: 0,
				durationMs: Date.now() - startTime,
				error: `Connector ${connectorId} not found`
			};
		}

		return {
			success: true,
			connectorId,
			itemsAffected: 1,
			durationMs: Date.now() - startTime
		};
	} catch (error) {
		return {
			success: false,
			connectorId,
			itemsAffected: 0,
			durationMs: Date.now() - startTime,
			error: error instanceof Error ? error.message : String(error)
		};
	}
}

export async function resumeQueue(connectorId: number): Promise<QueueControlResult> {
	const startTime = Date.now();

	try {
		const result = await db
			.update(connectors)
			.set({
				queuePaused: false,
				updatedAt: new Date()
			})
			.where(eq(connectors.id, connectorId))
			.returning({ id: connectors.id });

		if (result.length === 0) {
			return {
				success: false,
				connectorId,
				itemsAffected: 0,
				durationMs: Date.now() - startTime,
				error: `Connector ${connectorId} not found`
			};
		}

		return {
			success: true,
			connectorId,
			itemsAffected: 1,
			durationMs: Date.now() - startTime
		};
	} catch (error) {
		return {
			success: false,
			connectorId,
			itemsAffected: 0,
			durationMs: Date.now() - startTime,
			error: error instanceof Error ? error.message : String(error)
		};
	}
}

export async function clearQueue(connectorId?: number): Promise<QueueControlResult> {
	const startTime = Date.now();

	try {
		let registryIds: number[];
		let deletedCount: number;

		if (connectorId !== undefined) {
			const toDelete = await db
				.select({ searchRegistryId: requestQueue.searchRegistryId })
				.from(requestQueue)
				.where(eq(requestQueue.connectorId, connectorId));

			registryIds = toDelete.map((item) => item.searchRegistryId);

			const deleted = await db
				.delete(requestQueue)
				.where(eq(requestQueue.connectorId, connectorId))
				.returning({ id: requestQueue.id });

			deletedCount = deleted.length;
		} else {
			const toDelete = await db
				.select({ searchRegistryId: requestQueue.searchRegistryId })
				.from(requestQueue);

			registryIds = toDelete.map((item) => item.searchRegistryId);

			const deleted = await db.delete(requestQueue).returning({ id: requestQueue.id });

			deletedCount = deleted.length;
		}

		if (registryIds.length > 0) {
			await db
				.update(searchRegistry)
				.set({
					state: 'pending',
					updatedAt: new Date()
				})
				.where(and(inArray(searchRegistry.id, registryIds), eq(searchRegistry.state, 'queued')));
		}

		return {
			success: true,
			connectorId: connectorId ?? null,
			itemsAffected: deletedCount,
			durationMs: Date.now() - startTime
		};
	} catch (error) {
		return {
			success: false,
			connectorId: connectorId ?? null,
			itemsAffected: 0,
			durationMs: Date.now() - startTime,
			error: error instanceof Error ? error.message : String(error)
		};
	}
}

export async function getQueueStatus(connectorId: number): Promise<QueueStatus | null> {
	const connector = await db
		.select({ id: connectors.id, queuePaused: connectors.queuePaused })
		.from(connectors)
		.where(eq(connectors.id, connectorId))
		.limit(1);

	if (connector.length === 0) {
		return null;
	}

	const depthResult = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(requestQueue)
		.where(eq(requestQueue.connectorId, connectorId));

	const queueDepth = depthResult[0]?.count ?? 0;

	const nextItem = await db
		.select({ scheduledAt: requestQueue.scheduledAt })
		.from(requestQueue)
		.where(eq(requestQueue.connectorId, connectorId))
		.orderBy(desc(requestQueue.priority), asc(requestQueue.scheduledAt))
		.limit(1);

	return {
		connectorId,
		isPaused: connector[0]!.queuePaused,
		queueDepth,
		nextScheduledAt: nextItem[0]?.scheduledAt ?? null
	};
}
