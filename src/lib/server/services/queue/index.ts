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
 * @requirements 5.1, 5.2, 5.5, 5.6, 6.1, 6.2, 6.3
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

// Types - State Transitions
export type {
	SearchState,
	FailureCategory,
	MarkSearchFailedInput,
	StateTransitionResult,
	ReenqueueCooldownResult
} from './types';

// Configuration
export {
	DEFAULT_PRIORITY_WEIGHTS,
	PRIORITY_CONSTANTS,
	QUEUE_CONFIG,
	STATE_TRANSITION_CONFIG,
	BATCHING_CONFIG
} from './config';
export type {
	PriorityConstantsType,
	QueueConfigType,
	StateTransitionConfigType,
	BatchingConfigType
} from './config';

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

// State transitions (pure functions)
export { calculateNextEligibleTime, shouldMarkExhausted } from './backoff';

// State transitions (database operations)
export {
	markSearchFailed,
	markSearchExhausted,
	reenqueueEligibleCooldownItems,
	getSearchState
} from './state-transitions';

// Episode batching - Types
export type {
	EpisodeSearchCommand,
	SeasonStatistics,
	BatchingConfig,
	BatchingReason,
	BatchingDecision,
	// Episode grouping types (Requirements 6.4, 29.4, 29.5)
	EpisodeForGrouping,
	MovieForBatching,
	EpisodeBatch,
	MovieBatch
} from './episode-batcher';

// Episode batching - Functions
export {
	determineBatchingDecision,
	calculateMissingPercent,
	calculateMissingCount,
	isSeasonFullyAired,
	// Episode grouping functions (Requirements 6.4, 29.4, 29.5)
	groupEpisodesBySeries,
	createEpisodeBatches,
	createMovieBatches
} from './episode-batcher';

// Search dispatcher - Types (Requirement 7.3)
export type {
	DispatchOptions,
	DispatchResult,
	DispatchFailureReason
} from './search-dispatcher';

// Search dispatcher - Functions (Requirement 7.3)
export { dispatchSearch, dispatchBatch } from './search-dispatcher';
