export { BaseArrClient } from './common/base-client.js';
export { type DetectionResult, detectConnectorType } from './common/detect.js';
export type { ErrorCategory, NetworkErrorCause } from './common/errors.js';
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
export {
	collectAllPages,
	collectAllPagesWithMetadata,
	DEFAULT_PAGE_SIZE,
	fetchAllPages
} from './common/pagination.js';
export type { ParseResult } from './common/parsers.js';
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
export { calculateBackoffDelay, DEFAULT_RETRY_CONFIG, withRetry } from './common/retry.js';
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
	SystemStatus,
	WantedOptions
} from './common/types.js';
export { createConnectorClient } from './factory.js';
export type { ApiVersionInfo } from './radarr/client.js';
export { RadarrClient } from './radarr/client.js';
export {
	parsePaginatedMovies,
	parsePaginatedMoviesLenient,
	parseRadarrMovie,
	RadarrMovieFileSchema,
	RadarrMovieSchema
} from './radarr/parsers.js';
export type { RadarrMovie, RadarrMovieFile } from './radarr/types.js';
export { SonarrClient } from './sonarr/client.js';
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
export type {
	SonarrEpisode,
	SonarrEpisodeFile,
	SonarrSeason,
	SonarrSeasonStatistics,
	SonarrSeries,
	SonarrSeriesStatistics
} from './sonarr/types.js';
export { WhisparrClient } from './whisparr/client.js';
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
export type {
	WhisparrEpisode,
	WhisparrEpisodeFile,
	WhisparrSeason,
	WhisparrSeasonStatistics,
	WhisparrSeries,
	WhisparrSeriesStatistics
} from './whisparr/types.js';
