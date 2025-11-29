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
