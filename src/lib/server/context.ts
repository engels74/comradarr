/**
 * Request context management using AsyncLocalStorage.
 *
 * Provides automatic correlation ID propagation through async call chains
 * without explicit parameter passing. This is the standard pattern for
 * request tracing in Node.js/Bun applications.
 *
 * @module server/context

 */

import { AsyncLocalStorage } from 'node:async_hooks';

// =============================================================================
// Types
// =============================================================================

/**
 * Request context available throughout async execution.
 */
export interface RequestContext {
	/** Unique identifier for tracing related operations */
	correlationId: string;
	/** Context source (http, scheduler, manual) */
	source: 'http' | 'scheduler' | 'manual';
	/** Optional user ID for authenticated requests */
	userId?: number;
	/** Job name for scheduler-initiated contexts */
	jobName?: string;
}

// =============================================================================
// AsyncLocalStorage Instance
// =============================================================================

/**
 * Singleton AsyncLocalStorage instance for request context.
 * Each async execution chain maintains its own isolated context.
 */
const asyncLocalStorage = new AsyncLocalStorage<RequestContext>();

// =============================================================================
// Public API
// =============================================================================

/**
 * Execute a function within a request context.
 *
 * All async operations within the callback will have access to the context
 * via getContext() or getCorrelationId().
 *
 * @param context - The request context to propagate
 * @param fn - Function to execute within the context
 * @returns Result of the function execution
 *
 * @example
 * ```typescript
 * await runWithContext({ correlationId: 'abc-123', source: 'http' }, async () => {
 *   // getCorrelationId() returns 'abc-123' here and in any nested calls
 *   await someService.doWork();
 * });
 * ```
 */
export function runWithContext<T>(context: RequestContext, fn: () => T): T {
	return asyncLocalStorage.run(context, fn);
}

/**
 * Get the current request context.
 *
 * @returns Current context or undefined if called outside a context
 */
export function getContext(): RequestContext | undefined {
	return asyncLocalStorage.getStore();
}

/**
 * Get the current correlation ID.
 *
 * Returns undefined if called outside a request context, allowing callers
 * to handle the absence gracefully.
 *
 * @returns Correlation ID or undefined
 */
export function getCorrelationId(): string | undefined {
	return asyncLocalStorage.getStore()?.correlationId;
}

/**
 * Check if code is running within a request context.
 *
 * @returns True if a context is active
 */
export function hasContext(): boolean {
	return asyncLocalStorage.getStore() !== undefined;
}

/**
 * Generate a new correlation ID.
 * Uses crypto.randomUUID() for globally unique identifiers.
 *
 * @returns New UUID correlation ID
 */
export function generateCorrelationId(): string {
	return crypto.randomUUID();
}
