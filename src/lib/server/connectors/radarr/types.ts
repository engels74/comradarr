import type { QualityModel } from '$lib/utils/quality';

export interface RadarrMovieFile {
	id: number;
	quality: QualityModel;
	size: number;
	relativePath?: string;
}

export interface RadarrMovie {
	id: number;
	title: string;
	tmdbId: number;
	imdbId?: string;
	year: number;
	hasFile: boolean;
	monitored: boolean;
	/** Null when no file exists */
	qualityCutoffNotMet: boolean | null;
	movieFileId?: number;
	movieFile?: RadarrMovieFile;
	status?: string;
}
