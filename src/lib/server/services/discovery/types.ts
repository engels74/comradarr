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
	/** Number of gap registries deleted because content now has hasFile=true */
	registriesResolved: number;
	/** Duration of the discovery operation in milliseconds */
	durationMs: number;
	/** Error message if discovery failed */
	error?: string;
}

export interface UpgradeDiscoveryResult {
	/** Whether the discovery completed successfully */
	success: boolean;
	/** ID of the connector that was scanned */
	connectorId: number;
	/** Type of the connector */
	connectorType: 'sonarr' | 'radarr' | 'whisparr';
	/** Total number of upgrade candidates found (monitored=true, hasFile=true). All monitored content with files is included for upgrade searching, regardless of qualityCutoffNotMet status. */
	upgradesFound: number;
	/** Number of new search registry entries created */
	registriesCreated: number;
	/** Number of upgrades that already had search registry entries (skipped) */
	registriesSkipped: number;
	/** Number of upgrade registries deleted because content now has qualityCutoffNotMet=false */
	registriesResolved: number;
	/** Duration of the discovery operation in milliseconds */
	durationMs: number;
	/** Error message if discovery failed */
	error?: string;
}

export interface DiscoveryOptions {
	/** Batch size for processing large result sets (default: 1000) */
	batchSize?: number;
}

export interface ContentGap {
	/** Database ID (episodes.id or movies.id) */
	id: number;
	/** Connector ID the content belongs to */
	connectorId: number;
	/** Type of content */
	contentType: 'episode' | 'movie';
}

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
