/**
 * Types for queue components.
 */

/**
 * Scheduler job status for display.
 */
export interface SchedulerJobStatus {
	nextRun: string | null;
	isRunning: boolean;
}

/**
 * Scheduler status for queue page.
 */
export interface QueueSchedulerStatus {
	sweep: SchedulerJobStatus;
	processor: SchedulerJobStatus;
}

/**
 * Global queue state for the state indicator.
 */
export type GlobalQueueState =
	| 'processing'
	| 'waiting-sweep'
	| 'waiting-rate'
	| 'paused'
	| 'throttled'
	| 'idle';

/**
 * Serialized queue item for display.
 */
export interface SerializedQueueItem {
	id: number;
	searchRegistryId: number;
	connectorId: number;
	connectorName: string;
	connectorType: string;
	contentType: 'episode' | 'movie';
	contentId: number;
	title: string;
	seriesTitle: string | null;
	seasonNumber: number | null;
	episodeNumber: number | null;
	year: number | null;
	searchType: 'gap' | 'upgrade';
	state: 'pending' | 'queued' | 'searching' | 'cooldown' | 'exhausted';
	priority: number;
	attemptCount: number;
	scheduledAt: string | null;
	nextEligible: string | null;
	createdAt: string;
}

/**
 * Serialized throttle info for display.
 */
export interface SerializedThrottleInfo {
	connectorId: number;
	isPaused: boolean;
	pausedUntil: string | null;
	pauseReason: string | null;
	requestsPerMinute: number;
	requestsThisMinute: number;
	dailyBudget: number | null;
	requestsToday: number;
	name: string;
	type: string;
	queuedCount: number;
	searchingCount: number;
	minuteWindowStart: string | null;
	minuteWindowExpiry: string | null;
}

/**
 * Serialized recent completion for display.
 */
export interface SerializedCompletion {
	id: number;
	contentType: 'episode' | 'movie';
	contentId: number;
	contentTitle: string | null;
	seriesId: number | null;
	seriesTitle: string | null;
	seasonNumber: number | null;
	episodeNumber: number | null;
	connectorId: number;
	connectorName: string;
	connectorType: string;
	outcome: string;
	createdAt: string;
}
