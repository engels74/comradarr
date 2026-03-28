/**
 * Password hashing using Argon2id with OWASP-recommended parameters.
 * Reference: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
 */

import { hash, verify } from '@node-rs/argon2';

const ARGON2_OPTIONS = {
	memoryCost: 65536,
	timeCost: 3,
	parallelism: 1,
	algorithm: 2
} as const;

export async function hashPassword(password: string): Promise<string> {
	return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
	try {
		return await verify(storedHash, password, ARGON2_OPTIONS);
	} catch {
		// Return false instead of throwing to prevent information leakage
		return false;
	}
}
