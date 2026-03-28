// Whisparr is a Sonarr fork with identical API structure - re-export Sonarr parsers
export {
	parsePaginatedEpisodesLenient as parsePaginatedWhisparrEpisodesLenient,
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
