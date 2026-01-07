import type { RadarrMovie } from '$lib/server/connectors/radarr/types';
import type {
	SonarrEpisode,
	SonarrSeason,
	SonarrSeries
} from '$lib/server/connectors/sonarr/types';
import type { NewEpisode, NewMovie, NewSeason, NewSeries } from '$lib/server/db/schema';

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

export function mapSeasonToDb(seriesId: number, apiSeason: SonarrSeason): NewSeason {
	return {
		seriesId,
		seasonNumber: apiSeason.seasonNumber,
		monitored: apiSeason.monitored,
		totalEpisodes: apiSeason.statistics?.totalEpisodeCount ?? 0,
		downloadedEpisodes: apiSeason.statistics?.episodeFileCount ?? 0
	};
}

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
		// API returns null when no file exists; coerce to false for DB
		qualityCutoffNotMet: apiEpisode.qualityCutoffNotMet ?? false,
		episodeFileId: apiEpisode.episodeFileId ?? null
	};
}

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
		// API returns null when no file exists; coerce to false for DB
		qualityCutoffNotMet: apiMovie.qualityCutoffNotMet ?? false,
		movieFileId: apiMovie.movieFileId ?? null
	};
}
