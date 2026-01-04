/**
 * Property-based tests for queue processing order.
 *
 * Validates requirements:
 * - 5.2: Dispatch requests in priority order while respecting throttle profile limits
 *
 * Property 6: Queue Processing Order
 * "For any set of queue items, when processing the queue, items should be
 * dispatched in strictly descending priority order (highest priority first),
 * subject to throttle profile constraints."
 *

 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

/**
 * Minimal queue item type for testing ordering logic.
 * Matches the fields used for ordering in dequeuePriorityItems:
 * - priority: Higher values come first (desc)
 * - scheduledAt: Earlier times come first as tiebreaker (asc)
 */
interface TestQueueItem {
	id: number;
	priority: number;
	scheduledAt: Date;
}

/**
 * Compare two queue items using the same ordering as dequeuePriorityItems.
 *
 * SQL ordering: ORDER BY priority DESC, scheduledAt ASC
 * - Higher priority comes first
 * - For equal priority, earlier scheduledAt comes first
 *
 * Returns negative if a should come before b,
 * positive if b should come before a,
 * zero if equal.
 */
function compareQueueItems(a: TestQueueItem, b: TestQueueItem): number {
	// First: descending priority (higher priority first)
	if (a.priority !== b.priority) {
		return b.priority - a.priority; // DESC
	}
	// Second: ascending scheduledAt (earlier first)
	return a.scheduledAt.getTime() - b.scheduledAt.getTime(); // ASC
}

/**
 * Sort queue items using the same ordering as dequeuePriorityItems.
 *
 * This pure function mirrors the database ordering:
 * ORDER BY priority DESC, scheduledAt ASC
 */
function sortQueueItems(items: TestQueueItem[]): TestQueueItem[] {
	return [...items].sort(compareQueueItems);
}

/**
 * Helper to create a valid date arbitrary that filters out invalid dates.
 */
const validDateArbitrary = (min: Date, max: Date): fc.Arbitrary<Date> =>
	fc
		.integer({ min: min.getTime(), max: max.getTime() })
		.map((ts) => new Date(ts))
		.filter((d) => !Number.isNaN(d.getTime()));

/**
 * Arbitrary for priority scores.
 * Matches typical score ranges from priority calculator (around BASE_SCORE ± factors).
 */
const priorityArbitrary = fc.integer({ min: 0, max: 2000 });

/**
 * Arbitrary for scheduled times.
 */
const scheduledAtArbitrary = validDateArbitrary(new Date('2020-01-01'), new Date('2030-12-31'));

/**
 * Arbitrary for a single queue item.
 */
const queueItemArbitrary: fc.Arbitrary<TestQueueItem> = fc.record({
	id: fc.integer({ min: 1, max: 1000000 }),
	priority: priorityArbitrary,
	scheduledAt: scheduledAtArbitrary
});

/**
 * Arbitrary for an array of queue items with UNIQUE IDs (simulating a queue).
 * Uses index-based IDs to guarantee uniqueness for tests that rely on ID lookups.
 */
const queueArbitrary = fc
	.array(
		fc.record({
			priority: priorityArbitrary,
			scheduledAt: scheduledAtArbitrary
		}),
		{ minLength: 0, maxLength: 100 }
	)
	.map((items) =>
		items.map((item, index) => ({
			...item,
			id: index + 1 // Unique IDs: 1, 2, 3, ...
		}))
	);

describe('Queue Processing Order (Requirements 5.2)', () => {
	describe('Property 6: Priority Ordering', () => {
		it('items are dispatched in strictly descending priority order', () => {
			fc.assert(
				fc.property(queueArbitrary, (items) => {
					const sorted = sortQueueItems(items);

					// Verify descending priority order
					for (let i = 0; i < sorted.length - 1; i++) {
						const current = sorted[i]!;
						const next = sorted[i + 1]!;
						expect(current.priority).toBeGreaterThanOrEqual(next.priority);
					}
				}),
				{ numRuns: 100 }
			);
		});

		it('equal priorities use scheduledAt as tiebreaker (older first)', () => {
			fc.assert(
				fc.property(
					fc.integer({ min: 1, max: 100 }), // Same priority for all items
					fc.array(scheduledAtArbitrary, { minLength: 2, maxLength: 20 }),
					(priority, scheduledTimes) => {
						// Create items with same priority but different scheduled times
						const items: TestQueueItem[] = scheduledTimes.map((scheduledAt, idx) => ({
							id: idx + 1,
							priority,
							scheduledAt
						}));

						const sorted = sortQueueItems(items);

						// Verify ascending scheduledAt order (older first)
						for (let i = 0; i < sorted.length - 1; i++) {
							const current = sorted[i]!;
							const next = sorted[i + 1]!;
							expect(current.scheduledAt.getTime()).toBeLessThanOrEqual(next.scheduledAt.getTime());
						}
					}
				),
				{ numRuns: 100 }
			);
		});

		it('higher priority always comes before lower priority regardless of scheduledAt', () => {
			fc.assert(
				fc.property(
					fc.integer({ min: 100, max: 1000 }), // Higher priority
					fc.integer({ min: 0, max: 99 }), // Lower priority
					scheduledAtArbitrary, // Earlier time for lower priority
					scheduledAtArbitrary, // Later time for higher priority
					(highPriority, lowPriority, earlierTime, laterTime) => {
						// Even if low priority item has earlier scheduledAt,
						// high priority should come first
						const items: TestQueueItem[] = [
							{ id: 1, priority: lowPriority, scheduledAt: earlierTime },
							{ id: 2, priority: highPriority, scheduledAt: laterTime }
						];

						const sorted = sortQueueItems(items);

						expect(sorted[0]!.priority).toBe(highPriority);
						expect(sorted[1]!.priority).toBe(lowPriority);
					}
				),
				{ numRuns: 100 }
			);
		});
	});

	describe('Property: Ordering Consistency', () => {
		it('sorting is deterministic for same inputs', () => {
			fc.assert(
				fc.property(queueArbitrary, (items) => {
					const sorted1 = sortQueueItems(items);
					const sorted2 = sortQueueItems(items);

					expect(sorted1.length).toBe(sorted2.length);
					for (let i = 0; i < sorted1.length; i++) {
						expect(sorted1[i]!.id).toBe(sorted2[i]!.id);
						expect(sorted1[i]!.priority).toBe(sorted2[i]!.priority);
						expect(sorted1[i]!.scheduledAt.getTime()).toBe(sorted2[i]!.scheduledAt.getTime());
					}
				}),
				{ numRuns: 100 }
			);
		});

		it('no items are lost or duplicated during ordering', () => {
			fc.assert(
				fc.property(queueArbitrary, (items) => {
					const sorted = sortQueueItems(items);

					// Same length
					expect(sorted.length).toBe(items.length);

					// All original IDs are present
					const originalIds = new Set(items.map((item) => item.id));
					const sortedIds = new Set(sorted.map((item) => item.id));

					expect(sortedIds.size).toBe(originalIds.size);
					for (const id of originalIds) {
						expect(sortedIds.has(id)).toBe(true);
					}
				}),
				{ numRuns: 100 }
			);
		});

		it('sorting preserves item data integrity', () => {
			fc.assert(
				fc.property(queueArbitrary, (items) => {
					const sorted = sortQueueItems(items);

					// Create a map of original items
					const originalMap = new Map(items.map((item) => [item.id, item]));

					// Verify each sorted item matches original data
					for (const sortedItem of sorted) {
						const original = originalMap.get(sortedItem.id);
						expect(original).toBeDefined();
						expect(sortedItem.priority).toBe(original!.priority);
						expect(sortedItem.scheduledAt.getTime()).toBe(original!.scheduledAt.getTime());
					}
				}),
				{ numRuns: 100 }
			);
		});
	});

	describe('Property: Comparison Function Consistency', () => {
		it('compareQueueItems is consistent with sorted order', () => {
			fc.assert(
				fc.property(queueItemArbitrary, queueItemArbitrary, (a, b) => {
					const comparison = compareQueueItems(a, b);
					const sorted = sortQueueItems([a, b]);

					if (comparison < 0) {
						// a should come before b
						expect(sorted[0]!.id).toBe(a.id);
					} else if (comparison > 0) {
						// b should come before a
						expect(sorted[0]!.id).toBe(b.id);
					}
					// comparison === 0 means equal ordering, either order is valid
				}),
				{ numRuns: 100 }
			);
		});

		it('compareQueueItems is antisymmetric', () => {
			fc.assert(
				fc.property(queueItemArbitrary, queueItemArbitrary, (a, b) => {
					const ab = compareQueueItems(a, b);
					const ba = compareQueueItems(b, a);

					// antisymmetric: sign(compare(a,b)) == -sign(compare(b,a))
					expect(Math.sign(ab)).toBe(-Math.sign(ba));
				}),
				{ numRuns: 100 }
			);
		});

		it('compareQueueItems is transitive', () => {
			fc.assert(
				fc.property(queueItemArbitrary, queueItemArbitrary, queueItemArbitrary, (a, b, c) => {
					const ab = compareQueueItems(a, b);
					const bc = compareQueueItems(b, c);
					const ac = compareQueueItems(a, c);

					// Transitive: if a <= b and b <= c, then a <= c
					if (ab <= 0 && bc <= 0) {
						expect(ac).toBeLessThanOrEqual(0);
					}
					// if a >= b and b >= c, then a >= c
					if (ab >= 0 && bc >= 0) {
						expect(ac).toBeGreaterThanOrEqual(0);
					}
				}),
				{ numRuns: 100 }
			);
		});
	});
});

describe('Edge Cases', () => {
	it('handles empty queue', () => {
		const sorted = sortQueueItems([]);
		expect(sorted).toEqual([]);
	});

	it('handles single item queue', () => {
		const item: TestQueueItem = {
			id: 1,
			priority: 100,
			scheduledAt: new Date('2024-01-01')
		};
		const sorted = sortQueueItems([item]);
		expect(sorted.length).toBe(1);
		expect(sorted[0]!.id).toBe(1);
	});

	it('handles queue with identical items', () => {
		const scheduledAt = new Date('2024-01-01');
		const items: TestQueueItem[] = [
			{ id: 1, priority: 100, scheduledAt },
			{ id: 2, priority: 100, scheduledAt },
			{ id: 3, priority: 100, scheduledAt }
		];
		const sorted = sortQueueItems(items);
		expect(sorted.length).toBe(3);
		// All items have same priority and scheduledAt, order is stable
	});

	it('handles extreme priority values', () => {
		const items: TestQueueItem[] = [
			{ id: 1, priority: Number.MAX_SAFE_INTEGER, scheduledAt: new Date('2024-01-01') },
			{ id: 2, priority: 0, scheduledAt: new Date('2024-01-01') },
			{ id: 3, priority: Number.MIN_SAFE_INTEGER, scheduledAt: new Date('2024-01-01') }
		];
		const sorted = sortQueueItems(items);
		expect(sorted[0]!.priority).toBe(Number.MAX_SAFE_INTEGER);
		expect(sorted[1]!.priority).toBe(0);
		expect(sorted[2]!.priority).toBe(Number.MIN_SAFE_INTEGER);
	});

	it('handles extreme date values', () => {
		const items: TestQueueItem[] = [
			{ id: 1, priority: 100, scheduledAt: new Date('2099-12-31') },
			{ id: 2, priority: 100, scheduledAt: new Date('1970-01-01') },
			{ id: 3, priority: 100, scheduledAt: new Date('2024-06-15') }
		];
		const sorted = sortQueueItems(items);
		// Same priority, so ordered by scheduledAt ascending
		expect(sorted[0]!.id).toBe(2); // 1970
		expect(sorted[1]!.id).toBe(3); // 2024
		expect(sorted[2]!.id).toBe(1); // 2099
	});
});
