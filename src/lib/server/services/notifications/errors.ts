export type NotificationErrorCategory =
	| 'network'
	| 'authentication'
	| 'rate_limit'
	| 'server'
	| 'timeout'
	| 'configuration'
	| 'validation';

export abstract class NotificationError extends Error {
	abstract readonly category: NotificationErrorCategory;
	abstract readonly retryable: boolean;
	readonly timestamp: Date = new Date();

	constructor(message: string) {
		super(message);
		// Restore prototype chain for proper instanceof checks
		Object.setPrototypeOf(this, new.target.prototype);
	}
}

// Network errors (connection refused, DNS failure) - retryable
export class NotificationNetworkError extends NotificationError {
	readonly category = 'network' as const;
	readonly retryable = true;
	readonly networkCause: string | undefined;

	constructor(message: string, networkCause?: string) {
		super(message);
		this.name = 'NotificationNetworkError';
		this.networkCause = networkCause;
	}
}

// Authentication errors - NOT retryable without configuration changes
export class NotificationAuthenticationError extends NotificationError {
	readonly category = 'authentication' as const;
	readonly retryable = false;

	constructor(message: string = 'Authentication failed') {
		super(message);
		this.name = 'NotificationAuthenticationError';
	}
}

// Rate limit errors (HTTP 429) - retryable after waiting
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

// Server errors (HTTP 5xx) - retryable
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

// Timeout errors - retryable
export class NotificationTimeoutError extends NotificationError {
	readonly category = 'timeout' as const;
	readonly retryable = true;

	constructor(public readonly timeoutMs: number) {
		super(`Request timed out after ${timeoutMs}ms`);
		this.name = 'NotificationTimeoutError';
	}
}

// Configuration errors - NOT retryable without configuration changes
export class NotificationConfigurationError extends NotificationError {
	readonly category = 'configuration' as const;
	readonly retryable = false;

	constructor(message: string) {
		super(message);
		this.name = 'NotificationConfigurationError';
	}
}

// Validation errors - NOT retryable without fixing the payload
export class NotificationValidationError extends NotificationError {
	readonly category = 'validation' as const;
	readonly retryable = false;

	constructor(message: string) {
		super(message);
		this.name = 'NotificationValidationError';
	}
}

export function isNotificationError(error: unknown): error is NotificationError {
	return error instanceof NotificationError;
}

export function isRetryableNotificationError(error: unknown): boolean {
	if (isNotificationError(error)) {
		return error.retryable;
	}
	return false;
}
