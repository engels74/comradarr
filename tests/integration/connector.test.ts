/**
 * Property-based tests for connector data persistence.
 *
 * Validates requirements:
 * - 1.1: Store URL, API key (encrypted using AES-256-GCM), connector type,
 *        display name, and enabled status
 *
 * Tests persistence properties:
 * - Round-trip: All non-sensitive fields preserved after create and retrieve
 * - API key encryption: Encrypted API keys can be decrypted to original value
 * - URL normalization: Trailing slashes are consistently removed
 *
 * NOTE: These tests require a running PostgreSQL database with DATABASE_URL set.
 * Run with: bun test tests/integration/connector.test.ts
 *
 * These tests are excluded from vitest (which uses Node.js) because they require
 * Bun's native SQL driver (bun:sql).
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';
import * as fc from 'fast-check';
import {
	type CreateConnectorInput,
	createConnector,
	deleteConnector,
	getConnector,
	getDecryptedApiKey
} from '../../src/lib/server/db/queries/connectors';

// Store original SECRET_KEY to restore after tests
const originalSecretKey = process.env.SECRET_KEY;

// Valid test SECRET_KEY (64 hex chars = 32 bytes = 256 bits)
const TEST_SECRET_KEY = 'a'.repeat(64);

// Number of property test runs
const PROPERTY_RUNS = 100;

// Track created connector IDs for cleanup
const createdConnectorIds: number[] = [];

/**
 * Arbitrary generator for connector types.
 */
const connectorTypeArbitrary = fc.constantFrom('sonarr', 'radarr', 'whisparr') as fc.Arbitrary<
	'sonarr' | 'radarr' | 'whisparr'
>;

/**
 * Arbitrary generator for connector names.
 * Uses alphanumeric with spaces (safe for display names).
 */
const SAFE_NAME_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 _-';
const connectorNameArbitrary = fc
	.array(fc.constantFrom(...SAFE_NAME_CHARS), { minLength: 1, maxLength: 100 })
	.map((chars) => chars.join('').trim())
	.filter((name) => name.length > 0); // Ensure non-empty after trim

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
 * Arbitrary generator for complete connector input.
 */
const connectorInputArbitrary: fc.Arbitrary<CreateConnectorInput> = fc.record({
	type: connectorTypeArbitrary,
	name: connectorNameArbitrary,
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

describe('Property: Connector Data Persistence (Requirement 1.1)', () => {
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
		// Clean up created connectors to avoid test pollution
		for (const id of createdConnectorIds) {
			try {
				await deleteConnector(id);
			} catch {
				// Ignore errors during cleanup (connector may already be deleted)
			}
		}
		createdConnectorIds.length = 0;
	});

	describe('Non-Sensitive Field Preservation', () => {
		it('should preserve all non-sensitive fields after create and retrieve', async () => {
			await fc.assert(
				fc.asyncProperty(connectorInputArbitrary, async (input) => {
					// Create connector
					const created = await createConnector(input);
					createdConnectorIds.push(created.id);

					// Retrieve connector
					const retrieved = await getConnector(created.id);

					// Verify connector was found
					expect(retrieved).not.toBeNull();

					// Verify type is preserved exactly
					expect(retrieved!.type).toBe(input.type);

					// Verify name is preserved exactly
					expect(retrieved!.name).toBe(input.name);

					// Verify URL is normalized (trailing slashes removed)
					expect(retrieved!.url).toBe(normalizeUrl(input.url));

					// Verify enabled status is preserved (always generated as boolean in this test)
					expect(retrieved!.enabled).toBe(input.enabled as boolean);
				}),
				{ numRuns: PROPERTY_RUNS }
			);
		});

		it('should default enabled to true when not specified', async () => {
			// Create input without enabled field
			const inputWithoutEnabledArbitrary = fc.record({
				type: connectorTypeArbitrary,
				name: connectorNameArbitrary,
				url: urlArbitrary,
				apiKey: apiKeyArbitrary
			});

			await fc.assert(
				fc.asyncProperty(inputWithoutEnabledArbitrary, async (input) => {
					// Create connector without enabled field
					const created = await createConnector(input);
					createdConnectorIds.push(created.id);

					// Retrieve connector
					const retrieved = await getConnector(created.id);

					// Verify enabled defaults to true
					expect(retrieved!.enabled).toBe(true);
				}),
				{ numRuns: 50 }
			);
		});
	});

	describe('API Key Encryption Round-Trip', () => {
		it('should correctly encrypt and decrypt API keys', async () => {
			await fc.assert(
				fc.asyncProperty(connectorInputArbitrary, async (input) => {
					// Create connector (API key gets encrypted)
					const created = await createConnector(input);
					createdConnectorIds.push(created.id);

					// Retrieve connector
					const retrieved = await getConnector(created.id);
					expect(retrieved).not.toBeNull();

					// Verify encrypted API key is different from original (not stored in plain text)
					expect(retrieved!.apiKeyEncrypted).not.toBe(input.apiKey);

					// Verify API key can be decrypted back to original
					const decryptedKey = await getDecryptedApiKey(retrieved!);
					expect(decryptedKey).toBe(input.apiKey);
				}),
				{ numRuns: PROPERTY_RUNS }
			);
		});
	});

	describe('URL Normalization', () => {
		it('should consistently remove trailing slashes from URLs', async () => {
			// Generate URLs with varying numbers of trailing slashes
			const LOWER_ALPHA = 'abcdefghijklmnopqrstuvwxyz';
			const simpleHostArbitrary = fc
				.array(fc.constantFrom(...LOWER_ALPHA), { minLength: 3, maxLength: 10 })
				.map((chars) => chars.join(''));

			const urlWithSlashesArbitrary = fc
				.tuple(
					fc.constantFrom('http://', 'https://'),
					simpleHostArbitrary,
					fc.integer({ min: 0, max: 5 }) // number of trailing slashes
				)
				.map(([protocol, host, slashCount]) => `${protocol}${host}.local${'/'.repeat(slashCount)}`);

			await fc.assert(
				fc.asyncProperty(
					urlWithSlashesArbitrary,
					connectorTypeArbitrary,
					connectorNameArbitrary,
					apiKeyArbitrary,
					async (url, type, name, apiKey) => {
						const input: CreateConnectorInput = { type, name, url, apiKey, enabled: true };

						const created = await createConnector(input);
						createdConnectorIds.push(created.id);

						const retrieved = await getConnector(created.id);

						// URL should have no trailing slashes regardless of input
						expect(retrieved!.url).not.toMatch(/\/+$/);

						// URL should match normalized version
						expect(retrieved!.url).toBe(normalizeUrl(url));
					}
				),
				{ numRuns: 50 }
			);
		});
	});

	describe('Metadata Fields', () => {
		it('should set default health status and timestamps on creation', async () => {
			await fc.assert(
				fc.asyncProperty(connectorInputArbitrary, async (input) => {
					const beforeCreate = new Date();

					const created = await createConnector(input);
					createdConnectorIds.push(created.id);

					const afterCreate = new Date();

					// Health status should default to 'unknown'
					expect(created.healthStatus).toBe('unknown');

					// createdAt should be set to current time
					expect(created.createdAt).toBeInstanceOf(Date);
					expect(created.createdAt.getTime()).toBeGreaterThanOrEqual(beforeCreate.getTime() - 1000);
					expect(created.createdAt.getTime()).toBeLessThanOrEqual(afterCreate.getTime() + 1000);

					// updatedAt should be set to current time
					expect(created.updatedAt).toBeInstanceOf(Date);
					expect(created.updatedAt.getTime()).toBeGreaterThanOrEqual(beforeCreate.getTime() - 1000);
					expect(created.updatedAt.getTime()).toBeLessThanOrEqual(afterCreate.getTime() + 1000);

					// lastSync should be null (never synced)
					expect(created.lastSync).toBeNull();
				}),
				{ numRuns: 50 }
			);
		});
	});
});
