import type { QualityModel } from '$lib/utils/quality';

export interface SonarrSeasonStatistics {
	episodeFileCount: number;
	episodeCount: number;
	totalEpisodeCount: number;
	sizeOnDisk: number;
	percentOfEpisodes: number;
}

export interface SonarrSeason {
	seasonNumber: number;
	monitored: boolean;
	statistics?: SonarrSeasonStatistics;
}

export interface SonarrSeriesStatistics {
	seasonCount: number;
	episodeFileCount: number;
	episodeCount: number;
	sizeOnDisk: number;
	percentOfEpisodes: number;
}

export interface SonarrSeries {
	id: number;
	title: string;
	tvdbId: number;
	status: string;
	monitored: boolean;
	qualityProfileId: number;
	seasons: SonarrSeason[];
	statistics?: SonarrSeriesStatistics;
}

export interface SonarrEpisodeFile {
	id: number;
	quality: QualityModel;
	size: number;
	relativePath?: string;
}

export interface SonarrEpisode {
	id: number;
	seriesId: number;
	seasonNumber: number;
	episodeNumber: number;
	title?: string;
	airDateUtc?: string;
	hasFile: boolean;
	monitored: boolean;
	/** Null when no file exists */
	qualityCutoffNotMet: boolean | null;
	episodeFileId?: number;
	episodeFile?: SonarrEpisodeFile;
}
