// Whisparr is a Sonarr fork with identical API structure - type aliases for clarity
import type {
	SonarrEpisode,
	SonarrEpisodeFile,
	SonarrSeason,
	SonarrSeasonStatistics,
	SonarrSeries,
	SonarrSeriesStatistics
} from '../sonarr/types.js';

export type WhisparrSeasonStatistics = SonarrSeasonStatistics;
export type WhisparrSeason = SonarrSeason;
export type WhisparrSeriesStatistics = SonarrSeriesStatistics;
export type WhisparrSeries = SonarrSeries;
export type WhisparrEpisodeFile = SonarrEpisodeFile;
export type WhisparrEpisode = SonarrEpisode;
