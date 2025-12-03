/**
 * Types for queue components.
 * Requirements: 18.1, 18.2, 18.3
 */

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
}

/**
 * Serialized recent completion for display.
 * Requirements: 18.4
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
