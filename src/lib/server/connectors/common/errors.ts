export type ErrorCategory =
	| 'network'
	| 'authentication'
	| 'rate_limit'
	| 'server'
	| 'timeout'
	| 'validation'
	| 'not_found'
	| 'ssl';

export type NetworkErrorCause = 'connection_refused' | 'dns_failure' | 'timeout' | 'unknown';

export abstract class ArrClientError extends Error {
	abstract readonly category: ErrorCategory;
	abstract readonly retryable: boolean;
	readonly timestamp: Date = new Date();

	constructor(message: string) {
		super(message);
		// Ensure proper prototype chain for instanceof checks
		Object.setPrototypeOf(this, new.target.prototype);
	}
}

export class NetworkError extends ArrClientError {
	readonly category = 'network' as const;
	readonly retryable = true;
	readonly errorCause: NetworkErrorCause;

	constructor(message: string, errorCause: NetworkErrorCause) {
		super(message);
		this.name = 'NetworkError';
		this.errorCause = errorCause;
	}
}

export class AuthenticationError extends ArrClientError {
	readonly category = 'authentication' as const;
	readonly retryable = false;

	constructor(message: string = 'Invalid API key') {
		super(message);
		this.name = 'AuthenticationError';
	}
}

export class RateLimitError extends ArrClientError {
	readonly category = 'rate_limit' as const;
	readonly retryable = true;

	constructor(public readonly retryAfter?: number) {
		super('Rate limit exceeded');
		this.name = 'RateLimitError';
	}
}

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

export class TimeoutError extends ArrClientError {
	readonly category = 'timeout' as const;
	readonly retryable = true;

	constructor(public readonly timeoutMs: number) {
		super(`Request timed out after ${timeoutMs}ms`);
		this.name = 'TimeoutError';
	}
}

export class ValidationError extends ArrClientError {
	readonly category = 'validation' as const;
	readonly retryable = false;

	constructor(
		message: string,
		public readonly field?: string
	) {
		super(message);
		this.name = 'ValidationError';
	}
}

export class NotFoundError extends ArrClientError {
	readonly category = 'not_found' as const;
	readonly retryable = false;

	constructor(
		public readonly resource: string,
		message?: string
	) {
		super(message ?? `Resource not found: ${resource}`);
		this.name = 'NotFoundError';
	}
}

export class SSLError extends ArrClientError {
	readonly category = 'ssl' as const;
	readonly retryable = false;

	constructor(message: string = 'SSL certificate validation failed') {
		super(message);
		this.name = 'SSLError';
	}
}

export function isArrClientError(error: unknown): error is ArrClientError {
	return error instanceof ArrClientError;
}

export function isRetryableError(error: unknown): boolean {
	if (isArrClientError(error)) {
		return error.retryable;
	}
	return false;
}
