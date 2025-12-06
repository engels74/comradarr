/**
 * Types for dashboard components.
 */

/**
 * Serialized activity item for display in the activity feed.
 */
export interface SerializedActivity {
	/** Unique identifier with type prefix (e.g., 'search-1', 'discovery-2', 'sync-3') */
	id: string;
	/** Type of activity */
	type: 'search' | 'discovery' | 'sync';
	/** ISO timestamp string */
	timestamp: string;

	// Search-specific fields
	/** Search outcome (success, no_results, error, timeout) */
	outcome?: string | undefined;
	/** Content type for searches */
	contentType?: 'episode' | 'movie' | undefined;
	/** Episode or movie title */
	contentTitle?: string | undefined;
	/** Series title for episodes */
	seriesTitle?: string | undefined;
	/** Season number for episodes */
	seasonNumber?: number | undefined;
	/** Episode number for episodes */
	episodeNumber?: number | undefined;

	// Discovery-specific fields
	/** Type of discovery (gap or upgrade) */
	searchType?: 'gap' | 'upgrade' | undefined;
	/** Number of items discovered */
	count?: number | undefined;

	// Common connector fields
	/** Connector ID */
	connectorId?: number | undefined;
	/** Connector display name */
	connectorName?: string | undefined;
	/** Connector type (sonarr, radarr, whisparr) */
	connectorType?: string | undefined;
}

// =============================================================================
// Library Completion Types
// =============================================================================

/**
 * Serialized completion data point for sparklines.
 */
export interface SerializedCompletionDataPoint {
	/** ISO timestamp string when snapshot was captured */
	capturedAt: string;
	/** Completion percentage (0-100) */
	completionPercentage: number;
}

/**
 * Serialized connector completion stats with trend data for dashboard display.
 */
export interface SerializedConnectorCompletion {
	/** Connector ID */
	connectorId: number;
	/** Connector display name */
	connectorName: string;
	/** Connector type (sonarr, radarr, whisparr) */
	connectorType: string;
	/** Number of monitored episodes */
	episodesMonitored: number;
	/** Number of downloaded episodes */
	episodesDownloaded: number;
	/** Number of monitored movies */
	moviesMonitored: number;
	/** Number of downloaded movies */
	moviesDownloaded: number;
	/** Total monitored items (episodes + movies) */
	totalMonitored: number;
	/** Total downloaded items (episodes + movies) */
	totalDownloaded: number;
	/** Current completion percentage (0-100) */
	completionPercentage: number;
	/** Historical trend data points for sparkline */
	trend: SerializedCompletionDataPoint[];
	/** Change in completion percentage over trend period */
	trendDelta: number;
}

// =============================================================================
// Scheduler Status Types
// =============================================================================

/**
 * Serialized scheduled job for display in the upcoming schedule panel.
 */
export interface SerializedScheduledJob {
	/** Internal job name (e.g., 'incremental-sync-sweep') */
	name: string;
	/** Human-readable display name */
	displayName: string;
	/** Brief job description */
	description: string;
	/** Whether job is currently executing */
	isRunning: boolean;
	/** ISO timestamp of next run, or null if not scheduled */
	nextRun: string | null;
}
