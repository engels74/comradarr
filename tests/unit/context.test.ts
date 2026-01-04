/**
 * Unit tests for request context management.
 *
 * Tests cover:
 * - Context propagation through async chains
 * - Context isolation between concurrent requests
 * - Correlation ID retrieval
 * - Context detection (hasContext)
 * - Correlation ID generation
 *

 */

import { describe, expect, it } from 'vitest';
import {
	generateCorrelationId,
	getContext,
	getCorrelationId,
	hasContext,
	type RequestContext,
	runWithContext
} from '../../src/lib/server/context';

describe('Request Context', () => {
	describe('runWithContext', () => {
		it('should make context available within callback', async () => {
			const context: RequestContext = {
				correlationId: 'test-123',
				source: 'http'
			};

			await runWithContext(context, async () => {
				expect(getCorrelationId()).toBe('test-123');
				expect(getContext()?.source).toBe('http');
			});
		});

		it('should propagate context through nested async calls', async () => {
			const context: RequestContext = {
				correlationId: 'nested-test',
				source: 'http'
			};

			const nestedFunction = async (): Promise<string | undefined> => {
				return getCorrelationId();
			};

			const result = await runWithContext(context, async () => {
				return await nestedFunction();
			});

			expect(result).toBe('nested-test');
		});

		it('should propagate context through deeply nested async calls', async () => {
			const context: RequestContext = {
				correlationId: 'deep-nested',
				source: 'http',
				userId: 42
			};

			const level3 = async (): Promise<RequestContext | undefined> => {
				return getContext();
			};

			const level2 = async (): Promise<RequestContext | undefined> => {
				return await level3();
			};

			const level1 = async (): Promise<RequestContext | undefined> => {
				return await level2();
			};

			const result = await runWithContext(context, async () => {
				return await level1();
			});

			expect(result?.correlationId).toBe('deep-nested');
			expect(result?.userId).toBe(42);
		});

		it('should isolate contexts between concurrent executions', async () => {
			const results: string[] = [];

			await Promise.all([
				runWithContext({ correlationId: 'first', source: 'http' }, async () => {
					// Add delay to ensure interleaving
					await new Promise((r) => setTimeout(r, 10));
					const id = getCorrelationId();
					if (id) results.push(id);
				}),
				runWithContext({ correlationId: 'second', source: 'http' }, async () => {
					const id = getCorrelationId();
					if (id) results.push(id);
				})
			]);

			expect(results).toContain('first');
			expect(results).toContain('second');
			expect(results).toHaveLength(2);
		});

		it('should support synchronous callbacks', () => {
			const context: RequestContext = {
				correlationId: 'sync-test',
				source: 'manual'
			};

			const result = runWithContext(context, () => {
				return getCorrelationId();
			});

			expect(result).toBe('sync-test');
		});

		it('should include userId when provided', async () => {
			const context: RequestContext = {
				correlationId: 'user-test',
				source: 'http',
				userId: 123
			};

			await runWithContext(context, async () => {
				expect(getContext()?.userId).toBe(123);
			});
		});

		it('should include jobName for scheduler context', async () => {
			const context: RequestContext = {
				correlationId: 'job-test',
				source: 'scheduler',
				jobName: 'sync-all-connectors'
			};

			await runWithContext(context, async () => {
				const ctx = getContext();
				expect(ctx?.source).toBe('scheduler');
				expect(ctx?.jobName).toBe('sync-all-connectors');
			});
		});

		it('should return the result of the callback', async () => {
			const context: RequestContext = {
				correlationId: 'return-test',
				source: 'http'
			};

			const result = await runWithContext(context, async () => {
				return { success: true, data: [1, 2, 3] };
			});

			expect(result).toEqual({ success: true, data: [1, 2, 3] });
		});
	});

	describe('getCorrelationId', () => {
		it('should return undefined outside context', () => {
			expect(getCorrelationId()).toBeUndefined();
		});

		it('should return correlation ID inside context', async () => {
			await runWithContext({ correlationId: 'inside-test', source: 'http' }, async () => {
				expect(getCorrelationId()).toBe('inside-test');
			});
		});
	});

	describe('getContext', () => {
		it('should return undefined outside context', () => {
			expect(getContext()).toBeUndefined();
		});

		it('should return full context inside context', async () => {
			const context: RequestContext = {
				correlationId: 'full-context',
				source: 'http',
				userId: 999
			};

			await runWithContext(context, async () => {
				const retrieved = getContext();
				expect(retrieved).toEqual(context);
			});
		});
	});

	describe('hasContext', () => {
		it('should return false outside context', () => {
			expect(hasContext()).toBe(false);
		});

		it('should return true inside context', async () => {
			await runWithContext({ correlationId: 'has-context-test', source: 'http' }, async () => {
				expect(hasContext()).toBe(true);
			});
		});
	});

	describe('generateCorrelationId', () => {
		it('should generate valid UUIDs', () => {
			const id = generateCorrelationId();
			// UUID v4 format: 8-4-4-4-12 hex characters
			expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
		});

		it('should generate unique IDs', () => {
			const ids = new Set<string>();
			for (let i = 0; i < 100; i++) {
				ids.add(generateCorrelationId());
			}
			expect(ids.size).toBe(100);
		});

		it('should generate valid UUID v4 format (version digit)', () => {
			const id = generateCorrelationId();
			// UUID v4 has '4' as the 13th character (version)
			expect(id.charAt(14)).toBe('4');
		});
	});

	describe('context nesting', () => {
		it('should use innermost context when nested', async () => {
			const outer: RequestContext = {
				correlationId: 'outer',
				source: 'http'
			};

			const inner: RequestContext = {
				correlationId: 'inner',
				source: 'scheduler'
			};

			await runWithContext(outer, async () => {
				expect(getCorrelationId()).toBe('outer');

				await runWithContext(inner, async () => {
					expect(getCorrelationId()).toBe('inner');
				});

				// After inner context exits, outer should be restored
				expect(getCorrelationId()).toBe('outer');
			});
		});
	});
});
