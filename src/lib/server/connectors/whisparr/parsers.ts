// Whisparr is a Sonarr fork with identical API structure - re-export Sonarr parsers
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
