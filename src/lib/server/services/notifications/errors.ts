/**
 * Notification-specific error classes.
 *
 * Follows the pattern from `connectors/common/errors.ts` with
 * `category` and `retryable` properties for intelligent error handling.
 *
 * @module services/notifications/errors

 */

// =============================================================================
// Error Categories
// =============================================================================

/**
 * Categories of notification errors.
 */
export type NotificationErrorCategory =
	| 'network'
	| 'authentication'
	| 'rate_limit'
	| 'server'
	| 'timeout'
	| 'configuration'
	| 'validation';

// =============================================================================
// Base Error Class
// =============================================================================

/**
 * Base class for all notification-related errors.
 * Provides `category` and `retryable` properties for error handling.
 */
export abstract class NotificationError extends Error {
	/** Error category for classification */
	abstract readonly category: NotificationErrorCategory;
	/** Whether this error is retryable */
	abstract readonly retryable: boolean;
	/** Timestamp when error occurred */
	readonly timestamp: Date = new Date();

	constructor(message: string) {
		super(message);
		// Restore prototype chain for proper instanceof checks
		Object.setPrototypeOf(this, new.target.prototype);
	}
}

// =============================================================================
// Specific Error Classes
// =============================================================================

/**
 * Network-related errors (connection refused, DNS failure, etc.).
 * These are generally retryable.
 */
export class NotificationNetworkError extends NotificationError {
	readonly category = 'network' as const;
	readonly retryable = true;
	/** Additional context about the network error */
	readonly networkCause: string | undefined;

	constructor(message: string, networkCause?: string) {
		super(message);
		this.name = 'NotificationNetworkError';
		this.networkCause = networkCause;
	}
}

/**
 * Authentication errors (invalid API key, token, etc.).
 * These are NOT retryable without configuration changes.
 */
export class NotificationAuthenticationError extends NotificationError {
	readonly category = 'authentication' as const;
	readonly retryable = false;

	constructor(message: string = 'Authentication failed') {
		super(message);
		this.name = 'NotificationAuthenticationError';
	}
}

/**
 * Rate limit errors (HTTP 429).
 * These are retryable after waiting.
 */
export class NotificationRateLimitError extends NotificationError {
	readonly category = 'rate_limit' as const;
	readonly retryable = true;

	constructor(
		/** Seconds to wait before retrying (from Retry-After header) */
		public readonly retryAfterSeconds?: number
	) {
		super(
			retryAfterSeconds
				? `Rate limit exceeded. Retry after ${retryAfterSeconds} seconds`
				: 'Rate limit exceeded'
		);
		this.name = 'NotificationRateLimitError';
	}
}

/**
 * Server errors (HTTP 5xx).
 * These are generally retryable.
 */
export class NotificationServerError extends NotificationError {
	readonly category = 'server' as const;
	readonly retryable = true;

	constructor(
		public readonly statusCode: number,
		message: string
	) {
		super(`HTTP ${statusCode}: ${message}`);
		this.name = 'NotificationServerError';
	}
}

/**
 * Request timeout errors.
 * These are generally retryable.
 */
export class NotificationTimeoutError extends NotificationError {
	readonly category = 'timeout' as const;
	readonly retryable = true;

	constructor(public readonly timeoutMs: number) {
		super(`Request timed out after ${timeoutMs}ms`);
		this.name = 'NotificationTimeoutError';
	}
}

/**
 * Configuration errors (missing required config, invalid values).
 * These are NOT retryable without configuration changes.
 */
export class NotificationConfigurationError extends NotificationError {
	readonly category = 'configuration' as const;
	readonly retryable = false;

	constructor(message: string) {
		super(message);
		this.name = 'NotificationConfigurationError';
	}
}

/**
 * Validation errors (invalid payload, malformed data).
 * These are NOT retryable without fixing the payload.
 */
export class NotificationValidationError extends NotificationError {
	readonly category = 'validation' as const;
	readonly retryable = false;

	constructor(message: string) {
		super(message);
		this.name = 'NotificationValidationError';
	}
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Type guard to check if an error is a NotificationError.
 */
export function isNotificationError(error: unknown): error is NotificationError {
	return error instanceof NotificationError;
}

/**
 * Check if an error is retryable.
 * Returns false for unknown errors.
 */
export function isRetryableNotificationError(error: unknown): boolean {
	if (isNotificationError(error)) {
		return error.retryable;
	}
	return false;
}
