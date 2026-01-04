/**
 * Sonarr connector module exports
 *
 * Provides the Sonarr API client, types, and parsers for
 * communicating with Sonarr instances.
 *
 * @module connectors/sonarr
 */

export type { WantedOptions } from './client.js';
// Client
export { SonarrClient } from './client.js';
// Parsers
export {
	parsePaginatedEpisodes,
	parsePaginatedSeries,
	parseSonarrEpisode,
	parseSonarrSeries,
	SonarrEpisodeFileSchema,
	SonarrEpisodeSchema,
	SonarrSeasonSchema,
	SonarrSeasonStatisticsSchema,
	SonarrSeriesSchema,
	SonarrSeriesStatisticsSchema
} from './parsers.js';
// Types
export type {
	SonarrEpisode,
	SonarrEpisodeFile,
	SonarrSeason,
	SonarrSeasonStatistics,
	SonarrSeries,
	SonarrSeriesStatistics
} from './types.js';
