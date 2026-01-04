/**
 * Mappers for transforming *arr API responses to database records.
 *
 * These functions convert the API response types (SonarrSeries, RadarrMovie, etc.)
 * to the database insert types (NewSeries, NewMovie, etc.) for upsert operations.
 *
 * @module services/sync/mappers

 */

import type { RadarrMovie } from '$lib/server/connectors/radarr/types';
import type {
	SonarrEpisode,
	SonarrSeason,
	SonarrSeries
} from '$lib/server/connectors/sonarr/types';
import type { NewEpisode, NewMovie, NewSeason, NewSeries } from '$lib/server/db/schema';

/**
 * Map Sonarr/Whisparr series API response to database record.
 *
 * @param connectorId - The connector ID this series belongs to
 * @param apiSeries - Series data from the Sonarr API
 * @returns Database insert record for series table
 *

 */
export function mapSeriesToDb(connectorId: number, apiSeries: SonarrSeries): NewSeries {
	return {
		connectorId,
		arrId: apiSeries.id,
		tvdbId: apiSeries.tvdbId,
		title: apiSeries.title,
		status: apiSeries.status,
		monitored: apiSeries.monitored,
		qualityProfileId: apiSeries.qualityProfileId
	};
}

/**
 * Map Sonarr/Whisparr season to database record.
 *
 * @param seriesId - The database ID of the parent series
 * @param apiSeason - Season data from the Sonarr API (embedded in series response)
 * @returns Database insert record for seasons table
 *

 */
export function mapSeasonToDb(seriesId: number, apiSeason: SonarrSeason): NewSeason {
	return {
		seriesId,
		seasonNumber: apiSeason.seasonNumber,
		monitored: apiSeason.monitored,
		totalEpisodes: apiSeason.statistics?.totalEpisodeCount ?? 0,
		downloadedEpisodes: apiSeason.statistics?.episodeFileCount ?? 0
	};
}

/**
 * Map Sonarr/Whisparr episode API response to database record.
 *
 * @param connectorId - The connector ID this episode belongs to
 * @param seasonId - The database ID of the parent season
 * @param apiEpisode - Episode data from the Sonarr API
 * @returns Database insert record for episodes table
 *

 */
export function mapEpisodeToDb(
	connectorId: number,
	seasonId: number,
	apiEpisode: SonarrEpisode
): NewEpisode {
	return {
		connectorId,
		seasonId,
		arrId: apiEpisode.id,
		seasonNumber: apiEpisode.seasonNumber,
		episodeNumber: apiEpisode.episodeNumber,
		title: apiEpisode.title ?? null,
		airDate: apiEpisode.airDateUtc ? new Date(apiEpisode.airDateUtc) : null,
		monitored: apiEpisode.monitored,
		hasFile: apiEpisode.hasFile,
		quality: apiEpisode.episodeFile?.quality ?? null,
		qualityCutoffNotMet: apiEpisode.qualityCutoffNotMet,
		episodeFileId: apiEpisode.episodeFileId ?? null
	};
}

/**
 * Map Radarr movie API response to database record.
 *
 * @param connectorId - The connector ID this movie belongs to
 * @param apiMovie - Movie data from the Radarr API
 * @returns Database insert record for movies table
 *

 */
export function mapMovieToDb(connectorId: number, apiMovie: RadarrMovie): NewMovie {
	return {
		connectorId,
		arrId: apiMovie.id,
		tmdbId: apiMovie.tmdbId,
		imdbId: apiMovie.imdbId ?? null,
		title: apiMovie.title,
		year: apiMovie.year,
		monitored: apiMovie.monitored,
		hasFile: apiMovie.hasFile,
		quality: apiMovie.movieFile?.quality ?? null,
		qualityCutoffNotMet: apiMovie.qualityCutoffNotMet,
		movieFileId: apiMovie.movieFileId ?? null
	};
}
