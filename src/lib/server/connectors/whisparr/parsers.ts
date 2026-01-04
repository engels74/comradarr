/**
 * API response parsers for Whisparr using Valibot for runtime validation.
 *
 * Whisparr is a fork of Sonarr and uses the same API structure, so we
 * re-export Sonarr parsers with Whisparr-specific names for clarity.
 *
 * @module connectors/whisparr/parsers

 */

// Re-export Sonarr schemas as Whisparr schemas (identical API structure)
// Re-export Sonarr parser functions as Whisparr parser functions
export {
	parsePaginatedEpisodes as parsePaginatedWhisparrEpisodes,
	parsePaginatedEpisodesLenient as parsePaginatedWhisparrEpisodesLenient,
	parsePaginatedSeries as parsePaginatedWhisparrSeries,
	parsePaginatedSeriesLenient as parsePaginatedWhisparrSeriesLenient,
	parseSonarrEpisode as parseWhisparrEpisode,
	parseSonarrSeries as parseWhisparrSeries,
	SonarrEpisodeFileSchema as WhisparrEpisodeFileSchema,
	SonarrEpisodeSchema as WhisparrEpisodeSchema,
	SonarrSeasonSchema as WhisparrSeasonSchema,
	SonarrSeasonStatisticsSchema as WhisparrSeasonStatisticsSchema,
	SonarrSeriesSchema as WhisparrSeriesSchema,
	SonarrSeriesStatisticsSchema as WhisparrSeriesStatisticsSchema
} from '../sonarr/parsers.js';
