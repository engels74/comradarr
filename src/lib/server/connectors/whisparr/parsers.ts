/**
 * API response parsers for Whisparr using Valibot for runtime validation.
 *
 * Whisparr is a fork of Sonarr and uses the same API structure, so we
 * re-export Sonarr parsers with Whisparr-specific names for clarity.
 *
 * @module connectors/whisparr/parsers

 */

// Re-export Sonarr schemas as Whisparr schemas (identical API structure)
export {
	SonarrSeasonStatisticsSchema as WhisparrSeasonStatisticsSchema,
	SonarrSeasonSchema as WhisparrSeasonSchema,
	SonarrSeriesStatisticsSchema as WhisparrSeriesStatisticsSchema,
	SonarrSeriesSchema as WhisparrSeriesSchema,
	SonarrEpisodeFileSchema as WhisparrEpisodeFileSchema,
	SonarrEpisodeSchema as WhisparrEpisodeSchema
} from '../sonarr/parsers.js';

// Re-export Sonarr parser functions as Whisparr parser functions
export {
	parseSonarrSeries as parseWhisparrSeries,
	parseSonarrEpisode as parseWhisparrEpisode,
	parsePaginatedSeries as parsePaginatedWhisparrSeries,
	parsePaginatedEpisodes as parsePaginatedWhisparrEpisodes,
	parsePaginatedSeriesLenient as parsePaginatedWhisparrSeriesLenient,
	parsePaginatedEpisodesLenient as parsePaginatedWhisparrEpisodesLenient
} from '../sonarr/parsers.js';
