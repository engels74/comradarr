/**
 * Queue service for priority calculation and queue management.
 *
 * This module exports functions for:
 * - Priority calculation: scoring search items based on multiple factors
 * - Priority comparison: sorting items by priority
 * - Queue management: enqueue, dequeue, pause/resume, clear
 * - State transitions: searching → cooldown/exhausted, cooldown → pending
 * - Episode batching: deciding SeasonSearch vs EpisodeSearch
 *
 * Priority is calculated based on:
 * - Content age (newer content scores higher)
 * - Missing duration (longer missing scores higher)
 * - User priority override (manual adjustments)
 * - Failure penalty (fewer failures scores higher)
 * - Search type (gaps prioritized over upgrades)
 *
 * @module services/queue

 */

// State transitions (pure functions)
export { calculateNextEligibleTime, shouldMarkExhausted } from './backoff';
export type {
	BatchingConfigType,
	PriorityConstantsType,
	QueueConfigType,
	StateTransitionConfigType
} from './config';
// Configuration
export {
	BATCHING_CONFIG,
	DEFAULT_PRIORITY_WEIGHTS,
	PRIORITY_CONSTANTS,
	QUEUE_CONFIG,
	STATE_TRANSITION_CONFIG
} from './config';
// Episode batching - Types
export type {
	BatchingConfig,
	BatchingDecision,
	BatchingReason,
	EpisodeBatch,
	// Episode grouping types (Requirements 6.4, 29.4, 29.5)
	EpisodeForGrouping,
	EpisodeSearchCommand,
	MovieBatch,
	MovieForBatching,
	SeasonStatistics
} from './episode-batcher';
// Episode batching - Functions
export {
	calculateMissingCount,
	calculateMissingPercent,
	createEpisodeBatches,
	createMovieBatches,
	determineBatchingDecision,
	// Episode grouping functions (Requirements 6.4, 29.4, 29.5)
	groupEpisodesBySeries,
	isSeasonFullyAired
} from './episode-batcher';

// Priority calculation
export { calculatePriority, comparePriority } from './priority-calculator';

// Queue management
export {
	clearQueue,
	dequeuePriorityItems,
	enqueuePendingItems,
	getQueueStatus,
	pauseQueue,
	resumeQueue
} from './queue-service';
// Search dispatcher - Types (Requirement 7.3)
export type { DispatchFailureReason, DispatchOptions, DispatchResult } from './search-dispatcher';
// Search dispatcher - Functions (Requirement 7.3)
export { dispatchBatch, dispatchSearch } from './search-dispatcher';
// State transitions (database operations)
export {
	getSearchState,
	markSearchExhausted,
	markSearchFailed,
	reenqueueEligibleCooldownItems
} from './state-transitions';
// Types - Priority
// Types - Queue Service
// Types - State Transitions
export type {
	ContentType,
	DequeueOptions,
	DequeueResult,
	EnqueueOptions,
	EnqueueResult,
	FailureCategory,
	MarkSearchFailedInput,
	PriorityBreakdown,
	PriorityInput,
	PriorityResult,
	PriorityWeights,
	QueueControlResult,
	QueueItem,
	QueueStatus,
	ReenqueueCooldownResult,
	SearchState,
	SearchType,
	StateTransitionResult
} from './types';
