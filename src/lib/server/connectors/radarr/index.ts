/**
 * Radarr connector module exports
 *
 * Provides the Radarr API client, types, and parsers for
 * communicating with Radarr instances.
 *
 * @module connectors/radarr
 */

// Client
export { RadarrClient } from './client.js';
export type { ApiVersionInfo } from './client.js';

// Types
export type { RadarrMovie, RadarrMovieFile } from './types.js';

// Parsers
export {
	parseRadarrMovie,
	parsePaginatedMovies,
	parsePaginatedMoviesLenient,
	RadarrMovieSchema,
	RadarrMovieFileSchema
} from './parsers.js';
