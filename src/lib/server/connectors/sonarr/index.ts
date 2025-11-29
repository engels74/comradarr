/**
 * Sonarr connector module exports
 *
 * Provides the Sonarr API client, types, and parsers for
 * communicating with Sonarr instances.
 *
 * @module connectors/sonarr
 */

// Client
export { SonarrClient } from './client.js';

// Types
export type {
	SonarrSeries,
	SonarrSeason,
	SonarrSeasonStatistics,
	SonarrSeriesStatistics,
	SonarrEpisode,
	SonarrEpisodeFile
} from './types.js';

// Parsers
export {
	parseSonarrSeries,
	parseSonarrEpisode,
	parsePaginatedSeries,
	parsePaginatedEpisodes,
	SonarrSeriesSchema,
	SonarrSeasonSchema,
	SonarrSeasonStatisticsSchema,
	SonarrSeriesStatisticsSchema,
	SonarrEpisodeSchema,
	SonarrEpisodeFileSchema
} from './parsers.js';
