/**
 * TypeScript interfaces for Radarr API responses
 *
 * These types represent the shape of data returned from Radarr's API v3.
 * Used by parsers to validate and type API responses.
 *
 * @module connectors/radarr/types
 * @requirements 27.4
 */

import type { QualityModel } from '$lib/utils/quality';

/**
 * Movie file information from Radarr API
 * Included in movie response when hasFile is true
 */
export interface RadarrMovieFile {
	/** Movie file ID */
	id: number;
	/** Quality information for the file */
	quality: QualityModel;
	/** File size in bytes */
	size: number;
	/** Relative path to the file */
	relativePath?: string;
}

/**
 * Movie response from Radarr API
 * GET /api/v3/movie
 *
 * @requirements 27.4 - Extract id, title, tmdbId, imdbId, year, hasFile, qualityCutoffNotMet
 */
export interface RadarrMovie {
	/** Radarr's internal movie ID */
	id: number;
	/** Movie title */
	title: string;
	/** TheMovieDB ID for the movie */
	tmdbId: number;
	/** IMDb ID for the movie (optional - not all movies have one) */
	imdbId?: string;
	/** Release year */
	year: number;
	/** Whether this movie has a downloaded file */
	hasFile: boolean;
	/** Whether the movie is monitored for downloads */
	monitored: boolean;
	/** Whether current quality is below cutoff (upgrade candidate) */
	qualityCutoffNotMet: boolean;
	/** Movie file ID if hasFile is true */
	movieFileId?: number;
	/** Movie file details if hasFile is true */
	movieFile?: RadarrMovieFile;
	/** Movie status: 'released', 'inCinemas', 'announced', 'deleted' */
	status?: string;
}
