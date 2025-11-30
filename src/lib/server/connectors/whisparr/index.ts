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

// Client
export { WhisparrClient } from './client.js';
export type { WantedOptions } from './client.js';

// Types
export type {
	WhisparrSeries,
	WhisparrSeason,
	WhisparrSeasonStatistics,
	WhisparrSeriesStatistics,
	WhisparrEpisode,
	WhisparrEpisodeFile
} from './types.js';

// Parsers
export {
	parseWhisparrSeries,
	parseWhisparrEpisode,
	parsePaginatedWhisparrSeries,
	parsePaginatedWhisparrEpisodes,
	parsePaginatedWhisparrSeriesLenient,
	parsePaginatedWhisparrEpisodesLenient,
	WhisparrSeriesSchema,
	WhisparrSeasonSchema,
	WhisparrSeasonStatisticsSchema,
	WhisparrSeriesStatisticsSchema,
	WhisparrEpisodeSchema,
	WhisparrEpisodeFileSchema
} from './parsers.js';
