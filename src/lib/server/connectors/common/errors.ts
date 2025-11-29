/**
 * Typed error classes for *arr API client error handling
 *
 * Error categories and their retry behavior:
 * - NetworkError: connection_refused, dns_failure, timeout (retryable)
 * - AuthenticationError: HTTP 401 (not retryable)
 * - RateLimitError: HTTP 429 with optional Retry-After (retryable)
 * - ServerError: HTTP 5xx (retryable)
 * - TimeoutError: Request timeout (retryable)
 * - NotFoundError: HTTP 404 (not retryable)
 * - SSLError: SSL certificate validation failure (not retryable)
 *
 * @module connectors/common/errors
 * @requirements 23.3, 23.4, 28.1, 28.2, 28.3, 28.4, 28.5, 28.6
 */

/**
 * Error categories for classification and handling decisions
 */
export type ErrorCategory =
	| 'network'
	| 'authentication'
	| 'rate_limit'
	| 'server'
	| 'timeout'
	| 'validation'
	| 'not_found'
	| 'ssl';

/**
 * Network error cause types
 */
export type NetworkErrorCause = 'connection_refused' | 'dns_failure' | 'timeout' | 'unknown';

/**
 * Base class for all *arr API client errors
 * Provides consistent error structure with category and retry behavior
 */
export abstract class ArrClientError extends Error {
	/** Error category for classification */
	abstract readonly category: ErrorCategory;

	/** Whether this error type can be retried */
	abstract readonly retryable: boolean;

	/** Timestamp when the error occurred */
	readonly timestamp: Date = new Date();

	constructor(message: string) {
		super(message);
		// Ensure proper prototype chain for instanceof checks
		Object.setPrototypeOf(this, new.target.prototype);
	}
}

/**
 * Network-related errors (connection failures, DNS issues, etc.)
 * These are generally retryable as they may be transient
 */
export class NetworkError extends ArrClientError {
	readonly category = 'network' as const;
	readonly retryable = true;

	/** The underlying cause of the network error */
	readonly errorCause: NetworkErrorCause;

	constructor(message: string, errorCause: NetworkErrorCause) {
		super(message);
		this.name = 'NetworkError';
		this.errorCause = errorCause;
	}
}

/**
 * Authentication errors (HTTP 401)
 * These are NOT retryable as they indicate invalid credentials
 *
 * @requirements 28.1
 */
export class AuthenticationError extends ArrClientError {
	readonly category = 'authentication' as const;
	readonly retryable = false;

	constructor(message: string = 'Invalid API key') {
		super(message);
		this.name = 'AuthenticationError';
	}
}

/**
 * Rate limit errors (HTTP 429)
 * These are retryable after the specified delay
 *
 * @requirements 28.3
 */
export class RateLimitError extends ArrClientError {
	readonly category = 'rate_limit' as const;
	readonly retryable = true;

	constructor(
		/** Retry-After header value in seconds, if provided */
		public readonly retryAfter?: number
	) {
		super('Rate limit exceeded');
		this.name = 'RateLimitError';
	}
}

/**
 * Server errors (HTTP 5xx)
 * These are generally retryable as they indicate server-side issues
 *
 * @requirements 28.4
 */
export class ServerError extends ArrClientError {
	readonly category = 'server' as const;
	readonly retryable = true;

	constructor(
		public readonly statusCode: number,
		message: string
	) {
		super(message);
		this.name = 'ServerError';
	}
}

/**
 * Request timeout errors
 * These are retryable as they may be due to temporary network issues
 *
 * @requirements 23.4
 */
export class TimeoutError extends ArrClientError {
	readonly category = 'timeout' as const;
	readonly retryable = true;

	constructor(
		/** The timeout duration in milliseconds that was exceeded */
		public readonly timeoutMs: number
	) {
		super(`Request timed out after ${timeoutMs}ms`);
		this.name = 'TimeoutError';
	}
}

/**
 * Validation errors for malformed responses or invalid data
 * These are NOT retryable as the issue is with the data itself
 */
export class ValidationError extends ArrClientError {
	readonly category = 'validation' as const;
	readonly retryable = false;

	constructor(
		message: string,
		/** The field or path that failed validation */
		public readonly field?: string
	) {
		super(message);
		this.name = 'ValidationError';
	}
}

/**
 * Not found errors (HTTP 404)
 * NOT retryable - the resource does not exist
 *
 * @requirements 28.2
 */
export class NotFoundError extends ArrClientError {
	readonly category = 'not_found' as const;
	readonly retryable = false;

	constructor(
		/** The resource that was not found */
		public readonly resource: string,
		message?: string
	) {
		super(message ?? `Resource not found: ${resource}`);
		this.name = 'NotFoundError';
	}
}

/**
 * SSL certificate validation errors
 * NOT retryable by default - indicates configuration issue
 *
 * @requirements 28.6
 */
export class SSLError extends ArrClientError {
	readonly category = 'ssl' as const;
	readonly retryable = false;

	constructor(message: string = 'SSL certificate validation failed') {
		super(message);
		this.name = 'SSLError';
	}
}

/**
 * Type guard to check if an error is an ArrClientError
 */
export function isArrClientError(error: unknown): error is ArrClientError {
	return error instanceof ArrClientError;
}

/**
 * Type guard to check if an error is retryable
 */
export function isRetryableError(error: unknown): boolean {
	if (isArrClientError(error)) {
		return error.retryable;
	}
	return false;
}
