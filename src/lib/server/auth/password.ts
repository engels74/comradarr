/**
 * Password hashing utilities using Argon2id.
 *
 * Uses @node-rs/argon2 with OWASP-recommended parameters:
 * - memoryCost: 65536 KiB (64 MiB)
 * - timeCost: 3 iterations
 * - parallelism: 1 thread
 *
 * Reference: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
 */

import { hash, verify } from '@node-rs/argon2';

// OWASP recommended parameters for Argon2id
// Algorithm values: 0 = Argon2d, 1 = Argon2i, 2 = Argon2id
const ARGON2_OPTIONS = {
	memoryCost: 65536, // 64 MiB
	timeCost: 3, // 3 iterations
	parallelism: 1, // 1 thread
	algorithm: 2 // Argon2id (cannot use const enum with verbatimModuleSyntax)
} as const;

/**
 * Hashes a password using Argon2id with secure defaults.
 * Salt is automatically generated and embedded in the output.
 *
 * @param password - Plain text password to hash
 * @returns Promise resolving to Argon2id hash string
 */
export async function hashPassword(password: string): Promise<string> {
	return hash(password, ARGON2_OPTIONS);
}

/**
 * Verifies a password against an Argon2id hash.
 * Uses constant-time comparison to prevent timing attacks.
 *
 * @param storedHash - Stored Argon2id hash
 * @param password - Plain text password to verify
 * @returns Promise resolving to true if password matches, false otherwise
 */
export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
	try {
		return await verify(storedHash, password, ARGON2_OPTIONS);
	} catch {
		// Invalid hash format or other errors - return false instead of throwing
		// This prevents information leakage about hash validity
		return false;
	}
}
