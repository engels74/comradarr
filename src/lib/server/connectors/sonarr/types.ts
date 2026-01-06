/**
 * TypeScript interfaces for Sonarr API responses
 *
 * These types represent the shape of data returned from Sonarr's API v3.
 * Used by parsers to validate and type API responses.
 *
 * @module connectors/sonarr/types

 */

import type { QualityModel } from '$lib/utils/quality';

/**
 * Season statistics from Sonarr API
 * Embedded within season objects in series response
 */
export interface SonarrSeasonStatistics {
	/** Number of episode files downloaded */
	episodeFileCount: number;
	/** Number of episodes with files */
	episodeCount: number;
	/** Total number of episodes in season */
	totalEpisodeCount: number;
	/** Total size of episode files on disk in bytes */
	sizeOnDisk: number;
	/** Percentage of episodes downloaded (0-100) */
	percentOfEpisodes: number;
}

/**
 * Season within a series response
 * GET /api/v3/series returns this embedded in series
 */
export interface SonarrSeason {
	/** Season number (0 for specials) */
	seasonNumber: number;
	/** Whether this season is monitored for downloads */
	monitored: boolean;
	/** Statistics about episode counts and sizes (optional) */
	statistics?: SonarrSeasonStatistics;
}

/**
 * Series statistics from Sonarr API
 * Embedded within series objects
 */
export interface SonarrSeriesStatistics {
	/** Total number of seasons */
	seasonCount: number;
	/** Number of episode files downloaded */
	episodeFileCount: number;
	/** Total number of episodes */
	episodeCount: number;
	/** Total size on disk in bytes */
	sizeOnDisk: number;
	/** Percentage of episodes downloaded (0-100) */
	percentOfEpisodes: number;
}

/**
 * Series response from Sonarr API
 * GET /api/v3/series
 *

 */
export interface SonarrSeries {
	/** Sonarr's internal series ID */
	id: number;
	/** Series title */
	title: string;
	/** TheTVDB ID for the series */
	tvdbId: number;
	/** Series status: 'continuing', 'ended', 'upcoming', 'deleted' */
	status: string;
	/** Whether the series is monitored for downloads */
	monitored: boolean;
	/** Quality profile ID for downloads */
	qualityProfileId: number;
	/** Array of seasons in the series */
	seasons: SonarrSeason[];
	/** Overall series statistics (optional) */
	statistics?: SonarrSeriesStatistics;
}

/**
 * Episode file information from Sonarr API
 * Included in episode response when hasFile is true
 */
export interface SonarrEpisodeFile {
	/** Episode file ID */
	id: number;
	/** Quality information for the file */
	quality: QualityModel;
	/** File size in bytes */
	size: number;
	/** Relative path to the file */
	relativePath?: string;
}

/**
 * Episode response from Sonarr API
 * GET /api/v3/episode or GET /api/v3/wanted/missing
 *

 *                      hasFile, airDateUtc, qualityCutoffNotMet
 */
export interface SonarrEpisode {
	/** Sonarr's internal episode ID */
	id: number;
	/** ID of the parent series */
	seriesId: number;
	/** Season number (0 for specials) */
	seasonNumber: number;
	/** Episode number within the season */
	episodeNumber: number;
	/** Episode title (optional, may be missing for unaired episodes) */
	title?: string;
	/** UTC air date/time in ISO 8601 format */
	airDateUtc?: string;
	/** Whether this episode has a downloaded file */
	hasFile: boolean;
	/** Whether the episode is monitored for downloads */
	monitored: boolean;
	/** Whether current quality is below cutoff (upgrade candidate). Null when no file exists. */
	qualityCutoffNotMet: boolean | null;
	/** Episode file ID if hasFile is true */
	episodeFileId?: number;
	/** Episode file details if hasFile is true */
	episodeFile?: SonarrEpisodeFile;
}
