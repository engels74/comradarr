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

// Sonarr client
export { SonarrClient } from './sonarr/client.js';

// Radarr client
export { RadarrClient } from './radarr/client.js';
export type { ApiVersionInfo } from './radarr/client.js';

// Whisparr client
export { WhisparrClient } from './whisparr/client.js';

// Types
export type {
	ConnectorType,
	BaseClientConfig,
	RequestOptions,
	SystemStatus,
	HealthCheck,
	PaginatedResponse,
	PaginationOptions,
	CommandResponse,
	CommandStatus,
	RetryConfig
} from './common/types.js';

// Retry utilities
export { withRetry, calculateBackoffDelay, DEFAULT_RETRY_CONFIG } from './common/retry.js';

// Errors
export {
	ArrClientError,
	NetworkError,
	AuthenticationError,
	RateLimitError,
	ServerError,
	TimeoutError,
	ValidationError,
	NotFoundError,
	SSLError,
	isArrClientError,
	isRetryableError
} from './common/errors.js';

export type { ErrorCategory, NetworkErrorCause } from './common/errors.js';

// Parsers
export {
	parseQualityModel,
	parseCommandResponse,
	parsePaginatedResponse,
	parseRecordsWithWarnings,
	createPaginatedResponseSchema,
	QualityModelSchema,
	CommandResponseSchema,
	CommandStatusSchema
} from './common/parsers.js';

export type { ParseResult } from './common/parsers.js';

// Pagination utilities
export {
	fetchAllPages,
	collectAllPages,
	collectAllPagesWithMetadata,
	DEFAULT_PAGE_SIZE
} from './common/pagination.js';

export type {
	FetchAllPagesOptions,
	PageFetcher,
	PaginationMetadata
} from './common/pagination.js';

// Sonarr types
export type {
	SonarrSeries,
	SonarrSeason,
	SonarrSeasonStatistics,
	SonarrSeriesStatistics,
	SonarrEpisode,
	SonarrEpisodeFile
} from './sonarr/types.js';

// Sonarr parsers
export {
	parseSonarrSeries,
	parseSonarrEpisode,
	parsePaginatedSeries,
	parsePaginatedEpisodes,
	SonarrSeriesSchema,
	SonarrSeasonSchema,
	SonarrSeasonStatisticsSchema,
	SonarrSeriesStatisticsSchema,
	SonarrEpisodeSchema,
	SonarrEpisodeFileSchema
} from './sonarr/parsers.js';

// Radarr types
export type { RadarrMovie, RadarrMovieFile } from './radarr/types.js';

// Radarr parsers
export {
	parseRadarrMovie,
	parsePaginatedMovies,
	parsePaginatedMoviesLenient,
	RadarrMovieSchema,
	RadarrMovieFileSchema
} from './radarr/parsers.js';

// Whisparr types
export type {
	WhisparrSeries,
	WhisparrSeason,
	WhisparrSeasonStatistics,
	WhisparrSeriesStatistics,
	WhisparrEpisode,
	WhisparrEpisodeFile
} from './whisparr/types.js';

// Whisparr parsers
export {
	parseWhisparrSeries,
	parseWhisparrEpisode,
	parsePaginatedWhisparrSeries,
	parsePaginatedWhisparrEpisodes,
	WhisparrSeriesSchema,
	WhisparrSeasonSchema,
	WhisparrSeasonStatisticsSchema,
	WhisparrSeriesStatisticsSchema,
	WhisparrEpisodeSchema,
	WhisparrEpisodeFileSchema
} from './whisparr/parsers.js';
