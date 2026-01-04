/**
 * Whisparr connector module exports
 *
 * Provides the Whisparr API client, types, and parsers for
 * communicating with Whisparr instances.
 *
 * Whisparr is a fork of Sonarr for adult content management.
 * The API is identical to Sonarr's API v3.
 *
 * @module connectors/whisparr
 */

export type { WantedOptions } from './client.js';
// Client
export { WhisparrClient } from './client.js';
// Parsers
export {
	parsePaginatedWhisparrEpisodes,
	parsePaginatedWhisparrEpisodesLenient,
	parsePaginatedWhisparrSeries,
	parsePaginatedWhisparrSeriesLenient,
	parseWhisparrEpisode,
	parseWhisparrSeries,
	WhisparrEpisodeFileSchema,
	WhisparrEpisodeSchema,
	WhisparrSeasonSchema,
	WhisparrSeasonStatisticsSchema,
	WhisparrSeriesSchema,
	WhisparrSeriesStatisticsSchema
} from './parsers.js';
// Types
export type {
	WhisparrEpisode,
	WhisparrEpisodeFile,
	WhisparrSeason,
	WhisparrSeasonStatistics,
	WhisparrSeries,
	WhisparrSeriesStatistics
} from './types.js';
