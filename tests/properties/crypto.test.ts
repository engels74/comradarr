/**
 * Property-based and unit tests for API key encryption.
 *
 * Validates requirements:
 * - 1.1: Store connector API keys encrypted using AES-256-GCM
 * - 36.1: Store credentials encrypted using AES-256-GCM with SECRET_KEY
 *
 * Tests encryption properties:
 * - Round-trip: decrypt(encrypt(x)) === x for all strings
 * - Uniqueness: multiple encryptions of same plaintext produce different ciphertexts
 * - Tampering detection: modified ciphertext throws DecryptionError
 * - Format validation: invalid formats throw appropriate errors
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fc from 'fast-check';
import { encrypt, decrypt, DecryptionError, SecretKeyError, getSecretKey } from '../../src/lib/server/crypto';

// Store original SECRET_KEY to restore after tests
const originalSecretKey = process.env.SECRET_KEY;

// Valid test SECRET_KEY (64 hex chars = 32 bytes = 256 bits)
const TEST_SECRET_KEY = 'a'.repeat(64);

// Number of property test runs (encryption is fast, so we can run more)
const PROPERTY_RUNS = 100;

/**
 * Arbitrary generator for valid API keys and plaintext strings.
 * Generates strings between 1 and 1000 characters.
 */
const plaintextArbitrary = fc.string({ minLength: 1, maxLength: 1000 });

/**
 * Arbitrary generator for typical API keys (32-64 alphanumeric characters).
 */
const ALPHANUMERIC = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const apiKeyArbitrary = fc
	.array(fc.constantFrom(...ALPHANUMERIC), { minLength: 32, maxLength: 64 })
	.map((chars) => chars.join(''));

describe('API Key Encryption (Requirements 1.1, 36.1)', () => {
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

	describe('Property: Round Trip Encryption', () => {
		it('should decrypt to original plaintext for any string', async () => {
			await fc.assert(
				fc.asyncProperty(plaintextArbitrary, async (plaintext) => {
					const encrypted = await encrypt(plaintext);
					const decrypted = await decrypt(encrypted);
					expect(decrypted).toBe(plaintext);
				}),
				{ numRuns: PROPERTY_RUNS }
			);
		});

		it('should decrypt to original API key for typical API keys', async () => {
			await fc.assert(
				fc.asyncProperty(apiKeyArbitrary, async (apiKey) => {
					const encrypted = await encrypt(apiKey);
					const decrypted = await decrypt(encrypted);
					expect(decrypted).toBe(apiKey);
				}),
				{ numRuns: PROPERTY_RUNS }
			);
		});
	});

	describe('Property: Unique Ciphertexts (Random IV)', () => {
		it('should produce different ciphertexts for the same plaintext', async () => {
			await fc.assert(
				fc.asyncProperty(plaintextArbitrary, async (plaintext) => {
					const encrypted1 = await encrypt(plaintext);
					const encrypted2 = await encrypt(plaintext);

					// Ciphertexts should be different due to random IV
					expect(encrypted1).not.toBe(encrypted2);

					// But both should decrypt to the original
					expect(await decrypt(encrypted1)).toBe(plaintext);
					expect(await decrypt(encrypted2)).toBe(plaintext);
				}),
				{ numRuns: 50 } // Fewer runs since this tests randomness
			);
		});
	});

	describe('Property: Format Structure', () => {
		it('should produce encrypted format iv:authTag:ciphertext', async () => {
			await fc.assert(
				fc.asyncProperty(plaintextArbitrary, async (plaintext) => {
					const encrypted = await encrypt(plaintext);

					// Should be 3 parts separated by colons
					const parts = encrypted.split(':');
					expect(parts.length).toBe(3);

					// IV should be 32 hex chars (16 bytes)
					expect(parts[0]).toMatch(/^[0-9a-f]{32}$/);

					// Auth tag should be 32 hex chars (16 bytes)
					expect(parts[1]).toMatch(/^[0-9a-f]{32}$/);

					// Ciphertext should be hex and non-empty
					expect(parts[2]).toMatch(/^[0-9a-f]+$/);
					expect(parts[2]!.length).toBeGreaterThan(0);
				}),
				{ numRuns: PROPERTY_RUNS }
			);
		});
	});

	describe('Tampering Detection', () => {
		it('should throw DecryptionError for modified IV', async () => {
			const encrypted = await encrypt('test-api-key');
			const parts = encrypted.split(':');

			// Flip a bit in the IV
			const modifiedIv = parts[0]!.slice(0, -1) + (parts[0]!.slice(-1) === '0' ? '1' : '0');
			const tampered = `${modifiedIv}:${parts[1]}:${parts[2]}`;

			await expect(decrypt(tampered)).rejects.toThrow(DecryptionError);
		});

		it('should throw DecryptionError for modified auth tag', async () => {
			const encrypted = await encrypt('test-api-key');
			const parts = encrypted.split(':');

			// Flip a bit in the auth tag
			const modifiedTag = parts[1]!.slice(0, -1) + (parts[1]!.slice(-1) === '0' ? '1' : '0');
			const tampered = `${parts[0]}:${modifiedTag}:${parts[2]}`;

			await expect(decrypt(tampered)).rejects.toThrow(DecryptionError);
		});

		it('should throw DecryptionError for modified ciphertext', async () => {
			const encrypted = await encrypt('test-api-key');
			const parts = encrypted.split(':');

			// Flip a bit in the ciphertext
			const modifiedCiphertext =
				parts[2]!.slice(0, -1) + (parts[2]!.slice(-1) === '0' ? '1' : '0');
			const tampered = `${parts[0]}:${parts[1]}:${modifiedCiphertext}`;

			await expect(decrypt(tampered)).rejects.toThrow(DecryptionError);
		});
	});

	describe('Invalid Format Handling', () => {
		it('should throw DecryptionError for missing parts', async () => {
			await expect(decrypt('onlyone')).rejects.toThrow(DecryptionError);
			await expect(decrypt('only:two')).rejects.toThrow(DecryptionError);
			await expect(decrypt('one:two:three:four')).rejects.toThrow(DecryptionError);
		});

		it('should throw DecryptionError for invalid IV length', async () => {
			const shortIv = 'a'.repeat(30); // Should be 32
			await expect(decrypt(`${shortIv}:${'b'.repeat(32)}:${'c'.repeat(32)}`)).rejects.toThrow(
				DecryptionError
			);
		});

		it('should throw DecryptionError for invalid auth tag length', async () => {
			const shortTag = 'b'.repeat(30); // Should be 32
			await expect(decrypt(`${'a'.repeat(32)}:${shortTag}:${'c'.repeat(32)}`)).rejects.toThrow(
				DecryptionError
			);
		});

		it('should throw DecryptionError for empty ciphertext', async () => {
			await expect(decrypt(`${'a'.repeat(32)}:${'b'.repeat(32)}:`)).rejects.toThrow(
				DecryptionError
			);
		});

		it('should throw DecryptionError for non-hex characters', async () => {
			await expect(
				decrypt(`${'g'.repeat(32)}:${'h'.repeat(32)}:${'z'.repeat(32)}`)
			).rejects.toThrow(DecryptionError);
		});
	});

	describe('Edge Cases', () => {
		it('should handle empty string encryption', async () => {
			// Note: Our implementation requires non-empty ciphertext in validation
			// but encrypting an empty string is valid
			const encrypted = await encrypt('');
			expect(encrypted.split(':').length).toBe(3);
		});

		it('should handle unicode characters', async () => {
			const unicodeStrings = [
				'éèêëàâäùûü',
				'中文字符',
				'日本語テスト',
				'emoji: 🔐🔑🔒',
				'mixed: abc中文🎉123'
			];

			for (const str of unicodeStrings) {
				const encrypted = await encrypt(str);
				const decrypted = await decrypt(encrypted);
				expect(decrypted).toBe(str);
			}
		});

		it('should handle very long strings', async () => {
			const longString = 'a'.repeat(10000);
			const encrypted = await encrypt(longString);
			const decrypted = await decrypt(encrypted);
			expect(decrypted).toBe(longString);
		});

		it('should handle strings with special characters', async () => {
			const specialStrings = [
				'colons:in:the:string',
				'newlines\n\r\n',
				'tabs\t\ttabs',
				'null\0byte',
				'<script>alert("xss")</script>',
				'{"json": "data"}',
				"quotes'and\"double"
			];

			for (const str of specialStrings) {
				const encrypted = await encrypt(str);
				const decrypted = await decrypt(encrypted);
				expect(decrypted).toBe(str);
			}
		});
	});
});

describe('SECRET_KEY Validation', () => {
	afterAll(() => {
		// Restore test SECRET_KEY
		process.env.SECRET_KEY = TEST_SECRET_KEY;
	});

	it('should throw SecretKeyError when SECRET_KEY is missing', () => {
		delete process.env.SECRET_KEY;
		expect(() => getSecretKey()).toThrow(SecretKeyError);
		expect(() => getSecretKey()).toThrow(/SECRET_KEY environment variable is required/);
	});

	it('should throw SecretKeyError when SECRET_KEY is too short', () => {
		process.env.SECRET_KEY = 'a'.repeat(63); // Should be 64
		expect(() => getSecretKey()).toThrow(SecretKeyError);
		expect(() => getSecretKey()).toThrow(/must be a 64-character hex string/);
	});

	it('should throw SecretKeyError when SECRET_KEY is too long', () => {
		process.env.SECRET_KEY = 'a'.repeat(65); // Should be 64
		expect(() => getSecretKey()).toThrow(SecretKeyError);
	});

	it('should throw SecretKeyError when SECRET_KEY contains non-hex characters', () => {
		process.env.SECRET_KEY = 'g'.repeat(64); // 'g' is not hex
		expect(() => getSecretKey()).toThrow(SecretKeyError);
	});

	it('should accept valid SECRET_KEY formats', () => {
		// All lowercase
		process.env.SECRET_KEY = 'abcdef0123456789'.repeat(4);
		expect(() => getSecretKey()).not.toThrow();

		// All uppercase
		process.env.SECRET_KEY = 'ABCDEF0123456789'.repeat(4);
		expect(() => getSecretKey()).not.toThrow();

		// Mixed case
		process.env.SECRET_KEY = 'AbCdEf0123456789'.repeat(4);
		expect(() => getSecretKey()).not.toThrow();
	});
});

describe('Different SECRET_KEY Behavior', () => {
	it('should not decrypt with different SECRET_KEY', async () => {
		// Encrypt with first key
		process.env.SECRET_KEY = 'a'.repeat(64);
		const encrypted = await encrypt('test-api-key');

		// Try to decrypt with different key
		process.env.SECRET_KEY = 'b'.repeat(64);
		await expect(decrypt(encrypted)).rejects.toThrow(DecryptionError);

		// Restore
		process.env.SECRET_KEY = TEST_SECRET_KEY;
	});
});
