/**
 * Property-based tests for Prowlarr instance data persistence.
 *
 * Validates requirements:
 * - 38.1: Store URL and API key (encrypted using AES-256-GCM)
 *
 * Tests persistence properties:
 * - Round-trip: All non-sensitive fields preserved after create and retrieve
 * - API key encryption: Encrypted API keys can be decrypted to original value
 * - URL normalization: Trailing slashes are consistently removed
 *
 * NOTE: These tests require a running PostgreSQL database with DATABASE_URL set.
 * Run with: bun test tests/integration/prowlarr.test.ts
 *
 * These tests are excluded from vitest (which uses Node.js) because they require
 * Bun's native SQL driver (bun:sql).
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'bun:test';
import * as fc from 'fast-check';
import {
	createProwlarrInstance,
	getProwlarrInstance,
	getAllProwlarrInstances,
	getEnabledProwlarrInstances,
	getDecryptedApiKey,
	updateProwlarrInstance,
	updateProwlarrHealth,
	deleteProwlarrInstance,
	type CreateProwlarrInstanceInput
} from '../../src/lib/server/db/queries/prowlarr';

// Store original SECRET_KEY to restore after tests
const originalSecretKey = process.env.SECRET_KEY;

// Valid test SECRET_KEY (64 hex chars = 32 bytes = 256 bits)
const TEST_SECRET_KEY = 'a'.repeat(64);

// Number of property test runs
const PROPERTY_RUNS = 100;

// Track created instance IDs for cleanup
const createdInstanceIds: number[] = [];

/**
 * Arbitrary generator for instance names.
 * Uses alphanumeric with spaces (safe for display names).
 */
const SAFE_NAME_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 _-';
const instanceNameArbitrary = fc
	.array(fc.constantFrom(...SAFE_NAME_CHARS), { minLength: 1, maxLength: 100 })
	.map((chars) => chars.join('').trim())
	.filter((name) => name.length > 0);

/**
 * Arbitrary generator for host names (3-20 lowercase alphanumeric characters).
 */
const HOST_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
const hostArbitrary = fc
	.array(fc.constantFrom(...HOST_CHARS), { minLength: 3, maxLength: 20 })
	.map((chars) => chars.join(''));

/**
 * Arbitrary generator for trailing slashes (0-3 slashes).
 */
const trailingSlashesArbitrary = fc.integer({ min: 0, max: 3 }).map((count) => '/'.repeat(count));

/**
 * Arbitrary generator for URLs.
 * Generates valid HTTP/HTTPS URLs with optional trailing slashes.
 */
const urlArbitrary = fc
	.record({
		protocol: fc.constantFrom('http://', 'https://'),
		host: hostArbitrary,
		port: fc.option(fc.integer({ min: 1, max: 65535 }), { nil: undefined }),
		trailingSlashes: trailingSlashesArbitrary
	})
	.map(({ protocol, host, port, trailingSlashes }) => {
		const portPart = port !== undefined ? `:${port}` : '';
		return `${protocol}${host}.local${portPart}${trailingSlashes}`;
	});

/**
 * Arbitrary generator for API keys (32-64 alphanumeric characters).
 */
const ALPHANUMERIC = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const apiKeyArbitrary = fc
	.array(fc.constantFrom(...ALPHANUMERIC), { minLength: 32, maxLength: 64 })
	.map((chars) => chars.join(''));

/**
 * Arbitrary generator for complete Prowlarr instance input.
 */
const instanceInputArbitrary: fc.Arbitrary<CreateProwlarrInstanceInput> = fc.record({
	name: instanceNameArbitrary,
	url: urlArbitrary,
	apiKey: apiKeyArbitrary,
	enabled: fc.boolean()
});

/**
 * Normalizes a URL by removing trailing slashes (mirrors the implementation).
 */
function normalizeUrl(url: string): string {
	return url.replace(/\/+$/, '');
}

describe('Property: Prowlarr Instance Data Persistence (Requirement 38.1)', () => {
	beforeAll(() => {
		// Set a valid SECRET_KEY for tests
		process.env.SECRET_KEY = TEST_SECRET_KEY;
	});

	afterAll(() => {
		// Restore original SECRET_KEY
		if (originalSecretKey !== undefined) {
			process.env.SECRET_KEY = originalSecretKey;
		} else {
			delete process.env.SECRET_KEY;
		}
	});

	afterEach(async () => {
		// Clean up created instances to avoid test pollution
		for (const id of createdInstanceIds) {
			try {
				await deleteProwlarrInstance(id);
			} catch {
				// Ignore errors during cleanup (instance may already be deleted)
			}
		}
		createdInstanceIds.length = 0;
	});

	describe('Non-Sensitive Field Preservation', () => {
		it('should preserve all non-sensitive fields after create and retrieve', async () => {
			await fc.assert(
				fc.asyncProperty(instanceInputArbitrary, async (input) => {
					// Create instance
					const created = await createProwlarrInstance(input);
					createdInstanceIds.push(created.id);

					// Retrieve instance
					const retrieved = await getProwlarrInstance(created.id);

					// Verify non-sensitive fields match
					expect(retrieved).not.toBeNull();
					expect(retrieved!.name).toBe(input.name);
					expect(retrieved!.url).toBe(normalizeUrl(input.url));
					// input.enabled is always defined from fc.boolean(), use ?? true for type safety
					expect(retrieved!.enabled).toBe(input.enabled ?? true);

					// Default health status should be 'unknown'
					expect(retrieved!.healthStatus).toBe('unknown');
				}),
				{ numRuns: PROPERTY_RUNS }
			);
		});
	});

	describe('API Key Encryption Round-Trip', () => {
		it('should decrypt API key to original value after encryption', async () => {
			await fc.assert(
				fc.asyncProperty(instanceInputArbitrary, async (input) => {
					// Create instance (API key gets encrypted)
					const created = await createProwlarrInstance(input);
					createdInstanceIds.push(created.id);

					// Retrieve instance
					const retrieved = await getProwlarrInstance(created.id);
					expect(retrieved).not.toBeNull();

					// Verify API key is encrypted (not plain text)
					expect(retrieved!.apiKeyEncrypted).not.toBe(input.apiKey);

					// Decrypt and verify matches original
					const decrypted = await getDecryptedApiKey(retrieved!);
					expect(decrypted).toBe(input.apiKey);
				}),
				{ numRuns: PROPERTY_RUNS }
			);
		});
	});

	describe('URL Normalization', () => {
		it('should consistently remove trailing slashes from URLs', async () => {
			await fc.assert(
				fc.asyncProperty(urlArbitrary, async (url) => {
					const input: CreateProwlarrInstanceInput = {
						name: `test-${Date.now()}-${Math.random()}`,
						url,
						apiKey: 'a'.repeat(32),
						enabled: true
					};

					const created = await createProwlarrInstance(input);
					createdInstanceIds.push(created.id);

					const retrieved = await getProwlarrInstance(created.id);

					// URL should have no trailing slashes
					expect(retrieved!.url).toBe(normalizeUrl(url));
					expect(retrieved!.url.endsWith('/')).toBe(false);
				}),
				{ numRuns: PROPERTY_RUNS }
			);
		});
	});
});

describe('Prowlarr Instance CRUD Operations', () => {
	beforeAll(() => {
		process.env.SECRET_KEY = TEST_SECRET_KEY;
	});

	afterAll(() => {
		if (originalSecretKey !== undefined) {
			process.env.SECRET_KEY = originalSecretKey;
		} else {
			delete process.env.SECRET_KEY;
		}
	});

	afterEach(async () => {
		for (const id of createdInstanceIds) {
			try {
				await deleteProwlarrInstance(id);
			} catch {
				// Ignore
			}
		}
		createdInstanceIds.length = 0;
	});

	describe('getAllProwlarrInstances', () => {
		it('should return all instances ordered by name', async () => {
			// Create instances with specific names
			const instance1 = await createProwlarrInstance({
				name: 'Zebra Instance',
				url: 'http://zebra.local:9696',
				apiKey: 'a'.repeat(32),
				enabled: true
			});
			createdInstanceIds.push(instance1.id);

			const instance2 = await createProwlarrInstance({
				name: 'Alpha Instance',
				url: 'http://alpha.local:9696',
				apiKey: 'b'.repeat(32),
				enabled: true
			});
			createdInstanceIds.push(instance2.id);

			const all = await getAllProwlarrInstances();

			// Filter to our test instances
			const ourInstances = all.filter((i) => createdInstanceIds.includes(i.id));

			// Should be ordered by name (Alpha before Zebra)
			expect(ourInstances[0]?.name).toBe('Alpha Instance');
			expect(ourInstances[1]?.name).toBe('Zebra Instance');
		});
	});

	describe('getEnabledProwlarrInstances', () => {
		it('should return only enabled instances', async () => {
			const enabled = await createProwlarrInstance({
				name: 'Enabled Instance',
				url: 'http://enabled.local:9696',
				apiKey: 'a'.repeat(32),
				enabled: true
			});
			createdInstanceIds.push(enabled.id);

			const disabled = await createProwlarrInstance({
				name: 'Disabled Instance',
				url: 'http://disabled.local:9696',
				apiKey: 'b'.repeat(32),
				enabled: false
			});
			createdInstanceIds.push(disabled.id);

			const enabledInstances = await getEnabledProwlarrInstances();
			const ourInstances = enabledInstances.filter((i) => createdInstanceIds.includes(i.id));

			expect(ourInstances).toHaveLength(1);
			expect(ourInstances[0]?.name).toBe('Enabled Instance');
		});
	});

	describe('updateProwlarrInstance', () => {
		it('should update name', async () => {
			const instance = await createProwlarrInstance({
				name: 'Original Name',
				url: 'http://test.local:9696',
				apiKey: 'a'.repeat(32),
				enabled: true
			});
			createdInstanceIds.push(instance.id);

			await updateProwlarrInstance(instance.id, { name: 'Updated Name' });

			const retrieved = await getProwlarrInstance(instance.id);
			expect(retrieved?.name).toBe('Updated Name');
		});

		it('should update URL with normalization', async () => {
			const instance = await createProwlarrInstance({
				name: 'Test Instance',
				url: 'http://test.local:9696',
				apiKey: 'a'.repeat(32),
				enabled: true
			});
			createdInstanceIds.push(instance.id);

			await updateProwlarrInstance(instance.id, { url: 'http://new.local:9696///' });

			const retrieved = await getProwlarrInstance(instance.id);
			expect(retrieved?.url).toBe('http://new.local:9696');
		});

		it('should re-encrypt API key when updated', async () => {
			const instance = await createProwlarrInstance({
				name: 'Test Instance',
				url: 'http://test.local:9696',
				apiKey: 'original-api-key-12345678901234567',
				enabled: true
			});
			createdInstanceIds.push(instance.id);

			const originalEncrypted = instance.apiKeyEncrypted;

			await updateProwlarrInstance(instance.id, { apiKey: 'new-api-key-123456789012345678901' });

			const retrieved = await getProwlarrInstance(instance.id);

			// Encrypted value should be different
			expect(retrieved?.apiKeyEncrypted).not.toBe(originalEncrypted);

			// Decrypted value should be the new key
			const decrypted = await getDecryptedApiKey(retrieved!);
			expect(decrypted).toBe('new-api-key-123456789012345678901');
		});

		it('should return null for non-existent ID', async () => {
			const result = await updateProwlarrInstance(999999, { name: 'Test' });
			expect(result).toBeNull();
		});
	});

	describe('updateProwlarrHealth', () => {
		it('should update health status and timestamp', async () => {
			const instance = await createProwlarrInstance({
				name: 'Test Instance',
				url: 'http://test.local:9696',
				apiKey: 'a'.repeat(32),
				enabled: true
			});
			createdInstanceIds.push(instance.id);

			// Initial health status is 'unknown'
			expect(instance.healthStatus).toBe('unknown');
			expect(instance.lastHealthCheck).toBeNull();

			await updateProwlarrHealth(instance.id, 'healthy');

			const retrieved = await getProwlarrInstance(instance.id);
			expect(retrieved?.healthStatus).toBe('healthy');
			expect(retrieved?.lastHealthCheck).not.toBeNull();
		});
	});

	describe('deleteProwlarrInstance', () => {
		it('should return true when deleting existing instance', async () => {
			const instance = await createProwlarrInstance({
				name: 'To Delete',
				url: 'http://delete.local:9696',
				apiKey: 'a'.repeat(32),
				enabled: true
			});
			// Don't add to createdInstanceIds since we're deleting it

			const result = await deleteProwlarrInstance(instance.id);
			expect(result).toBe(true);

			// Verify it's deleted
			const retrieved = await getProwlarrInstance(instance.id);
			expect(retrieved).toBeNull();
		});

		it('should return false when deleting non-existent instance', async () => {
			const result = await deleteProwlarrInstance(999999);
			expect(result).toBe(false);
		});
	});
});
