// gap = missing content (hasFile=false), upgrade = below quality cutoff
export type SearchType = 'gap' | 'upgrade';

export type ContentType = 'episode' | 'movie';

export interface PriorityWeights {
	contentAge: number;
	missingDuration: number;
	userPriority: number;
	failurePenalty: number;
	gapBonus: number;
}

export interface PriorityInput {
	searchType: SearchType;
	// For episodes: airDate; for movies: January 1st of release year
	contentDate: Date | null;
	discoveredAt: Date;
	userPriorityOverride: number;
	attemptCount: number;
}

export interface PriorityBreakdown {
	contentAgeScore: number;
	missingDurationScore: number;
	userPriorityScore: number;
	failurePenalty: number;
	searchTypeBonus: number;
}

export interface PriorityResult {
	score: number;
	breakdown: PriorityBreakdown;
}

export interface QueueItem {
	id: number;
	searchRegistryId: number;
	connectorId: number;
	contentType: ContentType;
	contentId: number;
	searchType: SearchType;
	priority: number;
	scheduledAt: Date;
}

export interface EnqueueResult {
	success: boolean;
	connectorId: number;
	itemsEnqueued: number;
	itemsSkipped: number;
	durationMs: number;
	error?: string;
}

export interface DequeueResult {
	success: boolean;
	connectorId: number;
	items: QueueItem[];
	durationMs: number;
	error?: string;
}

export interface QueueControlResult {
	success: boolean;
	connectorId: number | null;
	itemsAffected: number;
	durationMs: number;
	error?: string;
}

export interface QueueStatus {
	connectorId: number;
	isPaused: boolean;
	queueDepth: number;
	nextScheduledAt: Date | null;
}

export interface EnqueueOptions {
	batchSize?: number;
	scheduledAt?: Date;
}

export interface DequeueOptions {
	limit?: number;
	scheduledBefore?: Date;
}

export type SearchState = 'pending' | 'queued' | 'searching' | 'cooldown' | 'exhausted';

export type FailureCategory =
	| 'no_results'
	| 'network_error'
	| 'rate_limited'
	| 'server_error'
	| 'timeout';

export interface MarkSearchFailedInput {
	searchRegistryId: number;
	failureCategory: FailureCategory;
	// If true and no_results, marks all season episodes for EpisodeSearch fallback
	wasSeasonPackSearch?: boolean;
}

export interface StateTransitionResult {
	success: boolean;
	searchRegistryId: number;
	previousState: SearchState;
	newState: SearchState;
	attemptCount?: number;
	nextEligible?: Date;
	error?: string;
}

export interface ReenqueueCooldownResult {
	success: boolean;
	connectorId?: number;
	itemsReenqueued: number;
	itemsSkipped: number;
	durationMs: number;
	error?: string;
}
