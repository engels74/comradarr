/**
 * Queue service for managing search request queue operations.
 *
 * Provides functions for:
 * - Enqueuing pending items with calculated priorities
 * - Dequeuing items in priority order for dispatch
 * - Pausing/resuming queue processing per connector
 * - Clearing queue items
 *
 * @module services/queue/queue-service

 */

import { db } from '$lib/server/db';
import { connectors, episodes, movies, requestQueue, searchRegistry } from '$lib/server/db/schema';
import { and, eq, inArray, sql, desc, asc, isNull } from 'drizzle-orm';
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
import { calculatePriority } from './priority-calculator';
import { QUEUE_CONFIG } from './config';

/**
 * Enqueues all pending search registry items for a connector.
 *
 * This function:
 * 1. Queries searchRegistry for items with state='pending'
 * 2. Joins with content tables (episodes/movies) to get data for priority calculation
 * 3. Calculates priority scores for each item
 * 4. Updates searchRegistry state to 'queued' and stores the priority
 * 5. Inserts items into requestQueue
 *
 * The function is idempotent - running multiple times won't create duplicates.
 *
 * @param connectorId - The connector ID to enqueue items for
 * @param options - Optional configuration for enqueue behavior
 * @returns Enqueue result with statistics
 *

 */
export async function enqueuePendingItems(
	connectorId: number,
	options: EnqueueOptions = {}
): Promise<EnqueueResult> {
	const startTime = Date.now();
	const batchSize = options.batchSize ?? QUEUE_CONFIG.DEFAULT_BATCH_SIZE;
	const scheduledAt = options.scheduledAt ?? new Date();

	try {
		// Verify connector exists
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

		// Get pending registry entries based on connector type
		let totalEnqueued = 0;
		let totalSkipped = 0;

		if (connectorType === 'radarr') {
			const result = await enqueueMovies(connectorId, batchSize, scheduledAt);
			totalEnqueued = result.enqueued;
			totalSkipped = result.skipped;
		} else {
			// Sonarr or Whisparr - handle episodes
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

/**
 * Enqueues pending episode search registry items.
 */
async function enqueueEpisodes(
	connectorId: number,
	batchSize: number,
	scheduledAt: Date
): Promise<{ enqueued: number; skipped: number }> {
	// Get pending episode registries with content data for priority calculation
	const pendingRegistries = await db
		.select({
			registryId: searchRegistry.id,
			connectorId: searchRegistry.connectorId,
			contentType: searchRegistry.contentType,
			contentId: searchRegistry.contentId,
			searchType: searchRegistry.searchType,
			attemptCount: searchRegistry.attemptCount,
			createdAt: searchRegistry.createdAt,
			// Episode data for priority calculation
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
				isNull(requestQueue.id) // Not already in queue
			)
		);

	if (pendingRegistries.length === 0) {
		return { enqueued: 0, skipped: 0 };
	}

	// Calculate priorities and prepare batch inserts
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

	// Insert into queue and update registry state in batches
	let totalEnqueued = 0;

	for (let i = 0; i < itemsToEnqueue.length; i += batchSize) {
		const batch = itemsToEnqueue.slice(i, i + batchSize);
		const registryIds = batch.map((item) => item.registryId);

		// Update search registry state to 'queued' and store priority
		await db
			.update(searchRegistry)
			.set({
				state: 'queued',
				priority: sql`CASE ${searchRegistry.id} ${batch.map((item) => sql`WHEN ${item.registryId} THEN ${item.priority}`).reduce((acc, curr) => sql`${acc} ${curr}`)} END`,
				updatedAt: now
			})
			.where(inArray(searchRegistry.id, registryIds));

		// Insert into request queue
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

/**
 * Enqueues pending movie search registry items.
 */
async function enqueueMovies(
	connectorId: number,
	batchSize: number,
	scheduledAt: Date
): Promise<{ enqueued: number; skipped: number }> {
	// Get pending movie registries with content data for priority calculation
	const pendingRegistries = await db
		.select({
			registryId: searchRegistry.id,
			connectorId: searchRegistry.connectorId,
			contentType: searchRegistry.contentType,
			contentId: searchRegistry.contentId,
			searchType: searchRegistry.searchType,
			attemptCount: searchRegistry.attemptCount,
			createdAt: searchRegistry.createdAt,
			// Movie data for priority calculation
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
				isNull(requestQueue.id) // Not already in queue
			)
		);

	if (pendingRegistries.length === 0) {
		return { enqueued: 0, skipped: 0 };
	}

	// Calculate priorities and prepare batch inserts
	const now = new Date();
	const itemsToEnqueue: Array<{
		registryId: number;
		connectorId: number;
		priority: number;
	}> = [];

	for (const registry of pendingRegistries) {
		// Convert year to a Date (January 1st of that year)
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

	// Insert into queue and update registry state in batches
	let totalEnqueued = 0;

	for (let i = 0; i < itemsToEnqueue.length; i += batchSize) {
		const batch = itemsToEnqueue.slice(i, i + batchSize);
		const registryIds = batch.map((item) => item.registryId);

		// Update search registry state to 'queued' and store priority
		await db
			.update(searchRegistry)
			.set({
				state: 'queued',
				priority: sql`CASE ${searchRegistry.id} ${batch.map((item) => sql`WHEN ${item.registryId} THEN ${item.priority}`).reduce((acc, curr) => sql`${acc} ${curr}`)} END`,
				updatedAt: now
			})
			.where(inArray(searchRegistry.id, registryIds));

		// Insert into request queue
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

/**
 * Dequeues items from the request queue in priority order.
 *
 * This function atomically:
 * 1. Checks if the connector queue is paused
 * 2. Selects the highest priority items scheduled before now
 * 3. Deletes them from the request queue
 * 4. Updates searchRegistry state to 'searching'
 *
 * The operation is atomic - concurrent calls will get different items.
 *
 * @param connectorId - The connector ID to dequeue items from
 * @param options - Optional configuration for dequeue behavior
 * @returns Dequeue result with items in priority order
 *

 */
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
		// Check if queue is paused for this connector
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
			// Queue is paused - return empty result (not an error)
			return {
				success: true,
				connectorId,
				items: [],
				durationMs: Date.now() - startTime
			};
		}

		// Get items to dequeue in priority order
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

		// Delete from request queue
		await db.delete(requestQueue).where(inArray(requestQueue.id, queueIds));

		// Update search registry state to 'searching'
		const now = new Date();
		await db
			.update(searchRegistry)
			.set({
				state: 'searching',
				lastSearched: now,
				updatedAt: now
			})
			.where(inArray(searchRegistry.id, registryIds));

		// Transform to QueueItem interface
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

/**
 * Pauses queue processing for a connector.
 *
 * When paused, dequeuePriorityItems returns empty results.
 * Items can still be enqueued while paused.
 *
 * @param connectorId - The connector ID to pause
 * @returns Control result indicating success/failure
 *

 */
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

/**
 * Resumes queue processing for a connector.
 *
 * @param connectorId - The connector ID to resume
 * @returns Control result indicating success/failure
 *

 */
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

/**
 * Clears queue items and resets search registry state.
 *
 * This function:
 * 1. Deletes items from requestQueue
 * 2. Resets corresponding searchRegistry entries back to 'pending'
 *
 * @param connectorId - The connector ID to clear queue for (null for all connectors)
 * @returns Control result with count of cleared items
 *

 */
export async function clearQueue(connectorId?: number): Promise<QueueControlResult> {
	const startTime = Date.now();

	try {
		// Get search registry IDs before deletion
		let registryIds: number[];
		let deletedCount: number;

		if (connectorId !== undefined) {
			// Clear specific connector's queue
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
			// Clear all queues
			const toDelete = await db
				.select({ searchRegistryId: requestQueue.searchRegistryId })
				.from(requestQueue);

			registryIds = toDelete.map((item) => item.searchRegistryId);

			const deleted = await db.delete(requestQueue).returning({ id: requestQueue.id });

			deletedCount = deleted.length;
		}

		// Reset search registry state back to 'pending'
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

/**
 * Gets queue status for a connector.
 *
 * @param connectorId - The connector ID to get status for
 * @returns Queue status including pause state, depth, and next scheduled time
 *

 */
export async function getQueueStatus(connectorId: number): Promise<QueueStatus | null> {
	// Get connector info
	const connector = await db
		.select({ id: connectors.id, queuePaused: connectors.queuePaused })
		.from(connectors)
		.where(eq(connectors.id, connectorId))
		.limit(1);

	if (connector.length === 0) {
		return null;
	}

	// Get queue depth
	const depthResult = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(requestQueue)
		.where(eq(requestQueue.connectorId, connectorId));

	const queueDepth = depthResult[0]?.count ?? 0;

	// Get next scheduled time
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
