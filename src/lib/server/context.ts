/**
 * Request context management using AsyncLocalStorage.
 * Provides automatic correlation ID propagation through async call chains.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
	correlationId: string;
	source: 'http' | 'scheduler' | 'manual';
	userId?: number;
	jobName?: string;
}

const asyncLocalStorage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(context: RequestContext, fn: () => T): T {
	return asyncLocalStorage.run(context, fn);
}

export function getContext(): RequestContext | undefined {
	return asyncLocalStorage.getStore();
}

export function getCorrelationId(): string | undefined {
	return asyncLocalStorage.getStore()?.correlationId;
}

export function hasContext(): boolean {
	return asyncLocalStorage.getStore() !== undefined;
}

export function generateCorrelationId(): string {
	return crypto.randomUUID();
}
