/**
 * Radarr connector module exports
 *
 * Provides the Radarr API client, types, and parsers for
 * communicating with Radarr instances.
 *
 * @module connectors/radarr
 */

export type { ApiVersionInfo } from './client.js';
// Client
export { RadarrClient } from './client.js';
// Parsers
export {
	parsePaginatedMovies,
	parsePaginatedMoviesLenient,
	parseRadarrMovie,
	RadarrMovieFileSchema,
	RadarrMovieSchema
} from './parsers.js';
// Types
export type { RadarrMovie, RadarrMovieFile } from './types.js';
