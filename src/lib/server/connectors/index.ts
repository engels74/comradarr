/**
 * Unified exports for *arr API connectors
 *
 * This module provides the base client and common types/errors for
 * communicating with *arr applications (Sonarr, Radarr, Whisparr).
 *
 * @module connectors
 */

// Base client
export { BaseArrClient } from './common/base-client.js';
// Detection utility
export { type DetectionResult, detectConnectorType } from './common/detect.js';
export type { ErrorCategory, NetworkErrorCause } from './common/errors.js';
// Errors
export {
	ArrClientError,
	AuthenticationError,
	isArrClientError,
	isRetryableError,
	NetworkError,
	NotFoundError,
	RateLimitError,
	ServerError,
	SSLError,
	TimeoutError,
	ValidationError
} from './common/errors.js';
export type { FetchAllPagesOptions, PageFetcher, PaginationMetadata } from './common/pagination.js';
// Pagination utilities
export {
	collectAllPages,
	collectAllPagesWithMetadata,
	DEFAULT_PAGE_SIZE,
	fetchAllPages
} from './common/pagination.js';
export type { ParseResult } from './common/parsers.js';
// Parsers
export {
	CommandResponseSchema,
	CommandStatusSchema,
	createPaginatedResponseSchema,
	parseCommandResponse,
	parsePaginatedResponse,
	parseQualityModel,
	parseRecordsWithWarnings,
	QualityModelSchema
} from './common/parsers.js';

// Retry utilities
export { calculateBackoffDelay, DEFAULT_RETRY_CONFIG, withRetry } from './common/retry.js';
// Types
export type {
	BaseClientConfig,
	CommandResponse,
	CommandStatus,
	ConnectorType,
	HealthCheck,
	PaginatedResponse,
	PaginationOptions,
	RequestOptions,
	RetryConfig,
	SystemStatus
} from './common/types.js';
// Factory
export { createConnectorClient } from './factory.js';
export type { ApiVersionInfo } from './radarr/client.js';
// Radarr client
export { RadarrClient } from './radarr/client.js';
// Radarr parsers
export {
	parsePaginatedMovies,
	parsePaginatedMoviesLenient,
	parseRadarrMovie,
	RadarrMovieFileSchema,
	RadarrMovieSchema
} from './radarr/parsers.js';
// Radarr types
export type { RadarrMovie, RadarrMovieFile } from './radarr/types.js';
// Sonarr client
export { SonarrClient } from './sonarr/client.js';

// Sonarr parsers
export {
	parsePaginatedEpisodes,
	parsePaginatedSeries,
	parseSonarrEpisode,
	parseSonarrSeries,
	SonarrEpisodeFileSchema,
	SonarrEpisodeSchema,
	SonarrSeasonSchema,
	SonarrSeasonStatisticsSchema,
	SonarrSeriesSchema,
	SonarrSeriesStatisticsSchema
} from './sonarr/parsers.js';
// Sonarr types
export type {
	SonarrEpisode,
	SonarrEpisodeFile,
	SonarrSeason,
	SonarrSeasonStatistics,
	SonarrSeries,
	SonarrSeriesStatistics
} from './sonarr/types.js';
// Whisparr client
export { WhisparrClient } from './whisparr/client.js';
// Whisparr parsers
export {
	parsePaginatedWhisparrEpisodes,
	parsePaginatedWhisparrSeries,
	parseWhisparrEpisode,
	parseWhisparrSeries,
	WhisparrEpisodeFileSchema,
	WhisparrEpisodeSchema,
	WhisparrSeasonSchema,
	WhisparrSeasonStatisticsSchema,
	WhisparrSeriesSchema,
	WhisparrSeriesStatisticsSchema
} from './whisparr/parsers.js';
// Whisparr types
export type {
	WhisparrEpisode,
	WhisparrEpisodeFile,
	WhisparrSeason,
	WhisparrSeasonStatistics,
	WhisparrSeries,
	WhisparrSeriesStatistics
} from './whisparr/types.js';
