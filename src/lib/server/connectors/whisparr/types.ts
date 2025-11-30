/**
 * TypeScript interfaces for Whisparr API responses
 *
 * Whisparr is a fork of Sonarr and uses the same API structure.
 * These types are aliases to Sonarr types for clarity and future extensibility.
 *
 * @module connectors/whisparr/types
 * @requirements 26.1, 26.2, 26.3, 26.4
 */

import type {
	SonarrSeries,
	SonarrSeason,
	SonarrSeasonStatistics,
	SonarrSeriesStatistics,
	SonarrEpisode,
	SonarrEpisodeFile
} from '../sonarr/types.js';

/**
 * Season statistics from Whisparr API
 * Identical to Sonarr's structure
 */
export type WhisparrSeasonStatistics = SonarrSeasonStatistics;

/**
 * Season within a series response
 * Identical to Sonarr's structure
 */
export type WhisparrSeason = SonarrSeason;

/**
 * Series statistics from Whisparr API
 * Identical to Sonarr's structure
 */
export type WhisparrSeriesStatistics = SonarrSeriesStatistics;

/**
 * Series response from Whisparr API
 * GET /api/v3/series
 *
 * @requirements 26.1 - Map response using same structure as Sonarr
 */
export type WhisparrSeries = SonarrSeries;

/**
 * Episode file information from Whisparr API
 * Identical to Sonarr's structure
 */
export type WhisparrEpisodeFile = SonarrEpisodeFile;

/**
 * Episode response from Whisparr API
 * GET /api/v3/episode or GET /api/v3/wanted/missing
 *
 * @requirements 26.2 - Map response including seasonNumber, episodeNumber, hasFile, airDateUtc
 */
export type WhisparrEpisode = SonarrEpisode;
