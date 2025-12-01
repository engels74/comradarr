/**
 * Integration tests for unhealthy connector exclusion in scheduler.
 *
 * Validates requirement:
 * - 1.5: Skip sweep cycles for unhealthy connectors
 *
 * Property 19: Unhealthy Connector Exclusion
 * - For any set of connectors with varying health statuses, sweep cycle scheduling
 *   should exclude all connectors with health status "unhealthy" or "offline".
 * - Only "healthy" and "degraded" connectors should be included in sweep cycles.
 *
 * NOTE: These tests require a running PostgreSQL database with DATABASE_URL set.
 * Run with: bun test tests/integration/scheduler-health.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { db } from '../../src/lib/server/db';
import { connectors } from '../../src/lib/server/db/schema';
import { eq } from 'drizzle-orm';
import {
	getEnabledConnectors,
	getHealthyConnectors
} from '../../src/lib/server/db/queries/connectors';

// Store original SECRET_KEY to restore after tests
const originalSecretKey = process.env.SECRET_KEY;

// Valid test SECRET_KEY (64 hex chars = 32 bytes = 256 bits)
const TEST_SECRET_KEY = 'a'.repeat(64);

// Test connector IDs to clean up
const testConnectorIds: number[] = [];

// All possible health statuses
const HEALTH_STATUSES = ['healthy', 'degraded', 'unhealthy', 'offline', 'unknown'] as const;
type HealthStatus = (typeof HEALTH_STATUSES)[number];

// Health statuses that should be included in sweep cycles
const HEALTHY_STATUSES: HealthStatus[] = ['healthy', 'degraded'];

// Health statuses that should be excluded from sweep cycles
const UNHEALTHY_STATUSES: HealthStatus[] = ['unhealthy', 'offline', 'unknown'];

/**
 * Create a test connector with specific health status
 */
async function createTestConnector(
	name: string,
	healthStatus: HealthStatus,
	enabled: boolean = true
): Promise<number> {
	const result = await db
		.insert(connectors)
		.values({
			type: 'sonarr',
			name,
			url: `http://test-${name}.local:8989`,
			apiKeyEncrypted: 'testencryptedkey',
			enabled,
			healthStatus
		})
		.returning({ id: connectors.id });

	const id = result[0]!.id;
	testConnectorIds.push(id);
	return id;
}

/**
 * Clean up all test connectors
 */
async function cleanupTestConnectors(): Promise<void> {
	for (const id of testConnectorIds) {
		await db.delete(connectors).where(eq(connectors.id, id));
	}
	testConnectorIds.length = 0;
}

/**
 * Update connector health status
 */
async function updateConnectorHealthStatus(id: number, healthStatus: HealthStatus): Promise<void> {
	await db.update(connectors).set({ healthStatus }).where(eq(connectors.id, id));
}

describe('Unhealthy Connector Exclusion (Property 19)', () => {
	beforeAll(() => {
		// Set SECRET_KEY for tests
		process.env.SECRET_KEY = TEST_SECRET_KEY;
	});

	afterAll(async () => {
		// Clean up all test connectors
		await cleanupTestConnectors();

		// Restore original SECRET_KEY
		if (originalSecretKey !== undefined) {
			process.env.SECRET_KEY = originalSecretKey;
		} else {
			delete process.env.SECRET_KEY;
		}
	});

	beforeEach(async () => {
		// Clean up test connectors before each test
		await cleanupTestConnectors();
	});

	describe('getHealthyConnectors()', () => {
		it('should return only healthy and degraded connectors', async () => {
			// Create one connector for each health status
			await createTestConnector('test-healthy', 'healthy');
			await createTestConnector('test-degraded', 'degraded');
			await createTestConnector('test-unhealthy', 'unhealthy');
			await createTestConnector('test-offline', 'offline');
			await createTestConnector('test-unknown', 'unknown');

			// Get healthy connectors
			const healthyConnectors = await getHealthyConnectors();

			// Filter to only our test connectors
			const testHealthyConnectors = healthyConnectors.filter((c) =>
				c.name.startsWith('test-')
			);

			// Should include only healthy and degraded
			expect(testHealthyConnectors.length).toBe(2);
			expect(testHealthyConnectors.map((c) => c.healthStatus).sort()).toEqual([
				'degraded',
				'healthy'
			]);
		});

		it('should exclude disabled connectors even if healthy', async () => {
			// Create healthy but disabled connector
			await createTestConnector('test-disabled-healthy', 'healthy', false);
			// Create healthy and enabled connector
			await createTestConnector('test-enabled-healthy', 'healthy', true);

			const healthyConnectors = await getHealthyConnectors();
			const testConnectors = healthyConnectors.filter((c) => c.name.startsWith('test-'));

			expect(testConnectors.length).toBe(1);
			expect(testConnectors[0]!.name).toBe('test-enabled-healthy');
		});

		it('should return empty array when all connectors are unhealthy', async () => {
			await createTestConnector('test-unhealthy-1', 'unhealthy');
			await createTestConnector('test-offline-1', 'offline');
			await createTestConnector('test-unknown-1', 'unknown');

			const healthyConnectors = await getHealthyConnectors();
			const testConnectors = healthyConnectors.filter((c) => c.name.startsWith('test-'));

			expect(testConnectors.length).toBe(0);
		});

		it('should include degraded connectors (operational with warnings)', async () => {
			await createTestConnector('test-degraded-only', 'degraded');

			const healthyConnectors = await getHealthyConnectors();
			const testConnectors = healthyConnectors.filter((c) => c.name.startsWith('test-'));

			expect(testConnectors.length).toBe(1);
			expect(testConnectors[0]!.healthStatus).toBe('degraded');
		});
	});

	describe('Property 19: Health-Based Filtering Correctness', () => {
		it('should satisfy: getHealthyConnectors ⊆ getEnabledConnectors', async () => {
			// Create connectors with various statuses
			await createTestConnector('prop19-healthy', 'healthy');
			await createTestConnector('prop19-degraded', 'degraded');
			await createTestConnector('prop19-unhealthy', 'unhealthy');
			await createTestConnector('prop19-offline', 'offline');

			const enabled = await getEnabledConnectors();
			const healthy = await getHealthyConnectors();

			// Every healthy connector should be in enabled connectors
			for (const hc of healthy) {
				const found = enabled.find((ec) => ec.id === hc.id);
				expect(found).toBeDefined();
			}
		});

		it('should satisfy property: for all connectors, included iff (enabled AND healthy/degraded)', async () => {
			// Property test with fast-check
			await fc.assert(
				fc.asyncProperty(
					// Generate random health statuses for 5 connectors
					fc.array(fc.constantFrom(...HEALTH_STATUSES), { minLength: 1, maxLength: 5 }),
					async (healthStatuses) => {
						// Clean up before each iteration
						await cleanupTestConnectors();

						// Create connectors with generated health statuses
						const createdIds: number[] = [];
						for (let i = 0; i < healthStatuses.length; i++) {
							const id = await createTestConnector(
								`prop19-fc-${i}-${healthStatuses[i]}`,
								healthStatuses[i]!
							);
							createdIds.push(id);
						}

						// Get healthy connectors
						const healthyConnectors = await getHealthyConnectors();
						const healthyIds = new Set(healthyConnectors.map((c) => c.id));

						// Verify: each created connector should be included iff it has healthy/degraded status
						for (let i = 0; i < createdIds.length; i++) {
							const id = createdIds[i]!;
							const status = healthStatuses[i]!;
							const shouldBeIncluded = HEALTHY_STATUSES.includes(status);
							const isIncluded = healthyIds.has(id);

							if (shouldBeIncluded !== isIncluded) {
								throw new Error(
									`Connector with status '${status}' should ${shouldBeIncluded ? '' : 'NOT '}be included, but was ${isIncluded ? '' : 'NOT '}included`
								);
							}
						}
					}
				),
				{ numRuns: 50 }
			);
		});

		it('should exclude unknown status (safe default until health check runs)', async () => {
			// This is important: new connectors start with 'unknown' status
			// They should NOT be processed until health check confirms they're healthy
			await createTestConnector('prop19-unknown', 'unknown');

			const healthyConnectors = await getHealthyConnectors();
			const testConnectors = healthyConnectors.filter((c) =>
				c.name.startsWith('prop19-unknown')
			);

			expect(testConnectors.length).toBe(0);
		});
	});

	describe('Health Status Transitions', () => {
		it('should correctly update filtering when health status changes', async () => {
			// Create a healthy connector
			const id = await createTestConnector('transition-test', 'healthy');

			// Verify it's included
			let healthyConnectors = await getHealthyConnectors();
			expect(healthyConnectors.some((c) => c.id === id)).toBe(true);

			// Mark as unhealthy
			await updateConnectorHealthStatus(id, 'unhealthy');

			// Verify it's excluded
			healthyConnectors = await getHealthyConnectors();
			expect(healthyConnectors.some((c) => c.id === id)).toBe(false);

			// Mark as degraded
			await updateConnectorHealthStatus(id, 'degraded');

			// Verify it's included again
			healthyConnectors = await getHealthyConnectors();
			expect(healthyConnectors.some((c) => c.id === id)).toBe(true);

			// Mark as offline
			await updateConnectorHealthStatus(id, 'offline');

			// Verify it's excluded
			healthyConnectors = await getHealthyConnectors();
			expect(healthyConnectors.some((c) => c.id === id)).toBe(false);

			// Mark as healthy again
			await updateConnectorHealthStatus(id, 'healthy');

			// Verify it's included
			healthyConnectors = await getHealthyConnectors();
			expect(healthyConnectors.some((c) => c.id === id)).toBe(true);
		});
	});
});
