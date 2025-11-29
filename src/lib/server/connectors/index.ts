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
	CommandStatus
} from './common/types.js';

// Errors
export {
	ArrClientError,
	NetworkError,
	AuthenticationError,
	RateLimitError,
	ServerError,
	TimeoutError,
	ValidationError,
	isArrClientError,
	isRetryableError
} from './common/errors.js';

export type { ErrorCategory, NetworkErrorCause } from './common/errors.js';
