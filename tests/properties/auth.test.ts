/**
 * Property-based tests for authentication.
 *
 * Validates requirements:
 * - 10.2: Password hashing using Argon2id
 *
 * Tests password hashing properties:
 * - Correct password always verifies
 * - Incorrect password never verifies
 * - Same password produces different hashes (unique salts)
 * - Hash format is valid Argon2id
 */

import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/lib/server/auth/password';

/**
 * Arbitrary generator for valid passwords.
 * Generates strings between 8 and 128 characters (reasonable password length).
 */
const passwordArbitrary = fc.string({ minLength: 8, maxLength: 128 });

// Argon2id with OWASP parameters is computationally expensive (~150ms per hash)
// Use longer timeouts and fewer runs for property tests
const SLOW_TEST_TIMEOUT = 60000; // 60 seconds
const PROPERTY_RUNS = 25; // Balance between coverage and speed

describe('Password Hashing (Requirement 10.2)', () => {
	describe('Property: Correct Password Always Verifies', () => {
		it(
			'should always verify the correct password',
			async () => {
				await fc.assert(
					fc.asyncProperty(passwordArbitrary, async (password) => {
						const hash = await hashPassword(password);
						const verified = await verifyPassword(hash, password);
						expect(verified).toBe(true);
					}),
					{ numRuns: PROPERTY_RUNS }
				);
			},
			SLOW_TEST_TIMEOUT
		);
	});

	describe('Property: Incorrect Password Never Verifies', () => {
		it(
			'should never verify an incorrect password',
			async () => {
				await fc.assert(
					fc.asyncProperty(
						passwordArbitrary,
						passwordArbitrary,
						async (password, wrongPassword) => {
							// Ensure passwords are different
							fc.pre(password !== wrongPassword);

							const hash = await hashPassword(password);
							const verified = await verifyPassword(hash, wrongPassword);
							expect(verified).toBe(false);
						}
					),
					{ numRuns: PROPERTY_RUNS }
				);
			},
			SLOW_TEST_TIMEOUT
		);
	});

	describe('Property: Unique Salts Produce Different Hashes', () => {
		it(
			'should produce different hashes for the same password (unique salts)',
			async () => {
				await fc.assert(
					fc.asyncProperty(passwordArbitrary, async (password) => {
						const hash1 = await hashPassword(password);
						const hash2 = await hashPassword(password);

						// Hashes should be different due to different salts
						expect(hash1).not.toBe(hash2);

						// But both should verify the original password
						expect(await verifyPassword(hash1, password)).toBe(true);
						expect(await verifyPassword(hash2, password)).toBe(true);
					}),
					{ numRuns: 10 } // Minimal runs - tests randomness, not logic
				);
			},
			SLOW_TEST_TIMEOUT
		);
	});

	describe('Property: Valid Argon2id Format', () => {
		it(
			'should produce valid Argon2id hash format',
			async () => {
				await fc.assert(
					fc.asyncProperty(passwordArbitrary, async (password) => {
						const hash = await hashPassword(password);

						// Argon2id hashes start with $argon2id$
						expect(hash).toMatch(/^\$argon2id\$/);

						// Should contain version, memory cost, time cost, and parallelism parameters
						expect(hash).toMatch(/\$v=\d+\$/);
						expect(hash).toMatch(/\$m=\d+,t=\d+,p=\d+\$/);
					}),
					{ numRuns: PROPERTY_RUNS }
				);
			},
			SLOW_TEST_TIMEOUT
		);
	});

	describe('Edge Cases', () => {
		it('should handle passwords with special characters', async () => {
			const specialPasswords = [
				'p@ssw0rd!#$%^&*()',
				'user"name\'test',
				'pass\twith\ttabs',
				'pass\nwith\nnewlines',
				'unicode: éèêëàâäùûü',
				'emoji: 🔐🔑🔒',
				'<script>alert("xss")</script>',
				'{"json": "injection"}',
				'SELECT * FROM users',
				'null\0byte'
			];

			for (const password of specialPasswords) {
				const hash = await hashPassword(password);
				const verified = await verifyPassword(hash, password);
				expect(verified).toBe(true);
			}
		});

		it('should handle very long passwords', async () => {
			const longPassword = 'a'.repeat(1000);
			const hash = await hashPassword(longPassword);
			const verified = await verifyPassword(hash, longPassword);
			expect(verified).toBe(true);
		});

		it('should return false for invalid hash formats', async () => {
			const invalidHashes = [
				'',
				'not-a-hash',
				'$2b$10$invalidbcrypthash', // bcrypt format, not argon2
				'$argon2id$v=19$invalid',
				'null'
			];

			for (const invalidHash of invalidHashes) {
				const verified = await verifyPassword(invalidHash, 'password');
				expect(verified).toBe(false);
			}
		});

		it('should return false for empty password verification', async () => {
			const hash = await hashPassword('validpassword');
			const verified = await verifyPassword(hash, '');
			expect(verified).toBe(false);
		});
	});
});
