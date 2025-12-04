/**
 * Types for analytics components.
 *
 * All types use serialized formats (ISO strings for dates) for safe
 * server-to-client data transfer via SvelteKit load functions.
 */

// =============================================================================
// Time Period Types
// =============================================================================

/**
 * Available time period options for analytics queries.
 */
export type TimePeriod = '24h' | '7d' | '30d';

// =============================================================================
// Time Series Types
// =============================================================================

/**
 * Serialized time series data point for charts.
 */
export interface SerializedTimeSeriesDataPoint {
	timestamp: string; // ISO string
	value: number;
}

/**
 * Discovery metrics (gaps and upgrades) per connector.
 */
export interface SerializedDiscoveryMetrics {
	connectorId: number;
	connectorName: string;
	connectorType: string;
	gapsDiscovered: SerializedTimeSeriesDataPoint[];
	upgradesDiscovered: SerializedTimeSeriesDataPoint[];
}

/**
 * Search volume metrics per connector.
 */
export interface SerializedSearchMetrics {
	connectorId: number;
	connectorName: string;
	connectorType: string;
	searchesDispatched: SerializedTimeSeriesDataPoint[];
	searchesSuccessful: SerializedTimeSeriesDataPoint[];
	searchesFailed: SerializedTimeSeriesDataPoint[];
	searchesNoResults: SerializedTimeSeriesDataPoint[];
}

/**
 * Queue depth metrics per connector.
 */
export interface SerializedQueueMetrics {
	connectorId: number;
	connectorName: string;
	connectorType: string;
	avgQueueDepth: SerializedTimeSeriesDataPoint[];
	peakQueueDepth: SerializedTimeSeriesDataPoint[];
}

// =============================================================================
// Connector Comparison Types
// =============================================================================

/**
 * Aggregated statistics for connector comparison.
 */
export interface SerializedConnectorStats {
	connectorId: number;
	connectorName: string;
	connectorType: string;
	totalSearches: number;
	successfulSearches: number;
	failedSearches: number;
	successRate: number; // 0-100 percentage
	avgResponseTimeMs: number | null;
	maxResponseTimeMs: number | null;
	errorCount: number;
	errorRate: number; // 0-100 percentage
}

// =============================================================================
// Content Analysis Types
// =============================================================================

/**
 * Most searched content item.
 */
export interface SerializedMostSearchedItem {
	contentType: 'episode' | 'movie';
	contentId: number;
	title: string;
	seriesTitle: string | null;
	seasonNumber: number | null;
	episodeNumber: number | null;
	connectorName: string;
	searchCount: number;
	lastSearched: string; // ISO string
}

/**
 * Hardest to find content item (high attempt count, still not found).
 */
export interface SerializedHardestToFindItem {
	contentType: 'episode' | 'movie';
	contentId: number;
	title: string;
	seriesTitle: string | null;
	seasonNumber: number | null;
	episodeNumber: number | null;
	connectorName: string;
	attemptCount: number;
	state: string;
	daysSinceCreated: number;
}

/**
 * Quality distribution entry.
 */
export interface SerializedQualityDistribution {
	qualityName: string;
	count: number;
	percentage: number; // 0-100
}

// =============================================================================
// Summary Types
// =============================================================================

/**
 * Summary statistics for the analytics dashboard header cards.
 */
export interface AnalyticsSummary {
	totalSearches: number;
	successfulSearches: number;
	successRate: number;
	gapsDiscovered: number;
	upgradesDiscovered: number;
	avgResponseTimeMs: number | null;
}
