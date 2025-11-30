/**
 * Queue service for priority calculation and queue management.
 *
 * This module exports functions for:
 * - Priority calculation: scoring search items based on multiple factors
 * - Priority comparison: sorting items by priority
 * - Queue management: enqueue, dequeue, pause/resume, clear
 *
 * Priority is calculated based on:
 * - Content age (newer content scores higher)
 * - Missing duration (longer missing scores higher)
 * - User priority override (manual adjustments)
 * - Failure penalty (fewer failures scores higher)
 * - Search type (gaps prioritized over upgrades)
 *
 * @module services/queue
 * @requirements 5.1, 5.2
 */

// Types - Priority
export type {
	SearchType,
	ContentType,
	PriorityWeights,
	PriorityInput,
	PriorityBreakdown,
	PriorityResult
} from './types';

// Types - Queue Service
export type {
	QueueItem,
	EnqueueResult,
	DequeueResult,
	QueueControlResult,
	QueueStatus,
	EnqueueOptions,
	DequeueOptions
} from './types';

// Configuration
export { DEFAULT_PRIORITY_WEIGHTS, PRIORITY_CONSTANTS, QUEUE_CONFIG } from './config';
export type { PriorityConstantsType, QueueConfigType } from './config';

// Priority calculation
export { calculatePriority, comparePriority } from './priority-calculator';

// Queue management
export {
	enqueuePendingItems,
	dequeuePriorityItems,
	pauseQueue,
	resumeQueue,
	clearQueue,
	getQueueStatus
} from './queue-service';
