/**
 * Type definitions for the discovery service.
 *
 * The discovery service identifies content gaps (missing files) and upgrade
 * candidates (items below quality cutoff) in the content mirror and creates
 * search registry entries for them.
 *
 * @module services/discovery/types
 * @requirements 3.1, 3.2, 3.3, 4.1, 4.2, 4.3
 */

/**
 * Result of a gap discovery operation.
 *
 * Gap discovery identifies monitored content items that have `hasFile=false`
 * and creates search registry entries with state "pending" and searchType "gap".
 *
 * @requirements 3.1, 3.3
 */
export interface GapDiscoveryResult {
	/** Whether the discovery completed successfully */
	success: boolean;
	/** ID of the connector that was scanned */
	connectorId: number;
	/** Type of the connector */
	connectorType: 'sonarr' | 'radarr' | 'whisparr';
	/** Total number of gaps found in content mirror (monitored=true, hasFile=false) */
	gapsFound: number;
	/** Number of new search registry entries created */
	registriesCreated: number;
	/** Number of gaps that already had search registry entries (skipped) */
	registriesSkipped: number;
	/** Duration of the discovery operation in milliseconds */
	durationMs: number;
	/** Error message if discovery failed */
	error?: string;
}

/**
 * Result of an upgrade candidate discovery operation.
 *
 * Upgrade discovery identifies monitored content items that have
 * `qualityCutoffNotMet=true` and creates search registry entries
 * with state "pending" and searchType "upgrade".
 *
 * @requirements 4.1, 4.3
 */
export interface UpgradeDiscoveryResult {
	/** Whether the discovery completed successfully */
	success: boolean;
	/** ID of the connector that was scanned */
	connectorId: number;
	/** Type of the connector */
	connectorType: 'sonarr' | 'radarr' | 'whisparr';
	/** Total number of upgrade candidates found (monitored=true, qualityCutoffNotMet=true, hasFile=true) */
	upgradesFound: number;
	/** Number of new search registry entries created */
	registriesCreated: number;
	/** Number of upgrades that already had search registry entries (skipped) */
	registriesSkipped: number;
	/** Duration of the discovery operation in milliseconds */
	durationMs: number;
	/** Error message if discovery failed */
	error?: string;
}

/**
 * Options for configuring discovery behavior.
 */
export interface DiscoveryOptions {
	/** Batch size for processing large result sets (default: 1000) */
	batchSize?: number;
}

/**
 * Internal representation of a content gap.
 * Used during gap detection to collect items before creating registries.
 */
export interface ContentGap {
	/** Database ID (episodes.id or movies.id) */
	id: number;
	/** Connector ID the content belongs to */
	connectorId: number;
	/** Type of content */
	contentType: 'episode' | 'movie';
}

/**
 * Statistics tracked during discovery for both episodes and movies.
 */
export interface DiscoveryStats {
	/** Number of episode gaps/upgrades found */
	episodeCount: number;
	/** Number of movie gaps/upgrades found */
	movieCount: number;
	/** Number of registries created for episodes */
	episodeRegistriesCreated: number;
	/** Number of registries created for movies */
	movieRegistriesCreated: number;
}
