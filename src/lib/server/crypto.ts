/**
 * API key encryption utilities using AES-256-GCM.
 *
 * Uses AES-256-GCM for authenticated encryption with:
 * - 256-bit key from SECRET_KEY environment variable
 * - Random 16-byte IV per encryption
 * - 16-byte authentication tag for integrity verification
 *
 * Encrypted format: iv:authTag:ciphertext (hex encoded)
 */

/** AES-256-GCM algorithm configuration */
const ALGORITHM = 'AES-GCM';
const KEY_LENGTH = 256;
const IV_LENGTH = 16; // 128 bits
const AUTH_TAG_LENGTH = 128; // bits

/**
 * Custom error for decryption failures.
 * Thrown when ciphertext is invalid, tampered, or uses wrong key.
 */
export class DecryptionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'DecryptionError';
	}
}

/**
 * Custom error for invalid SECRET_KEY configuration.
 */
export class SecretKeyError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'SecretKeyError';
	}
}

/** Cached CryptoKey instance for performance */
let cachedKey: CryptoKey | null = null;
let cachedKeyHex: string | null = null;

/**
 * Gets and validates the SECRET_KEY from environment.
 * Throws SecretKeyError if missing or invalid format.
 *
 * @returns The validated SECRET_KEY hex string
 * @throws SecretKeyError if SECRET_KEY is missing or invalid
 */
export function getSecretKey(): string {
	const key = process.env.SECRET_KEY;

	if (!key) {
		throw new SecretKeyError(
			'SECRET_KEY environment variable is required. ' +
				'Generate one with: openssl rand -hex 32'
		);
	}

	// Validate format: 64 hex characters = 32 bytes = 256 bits
	if (!/^[0-9a-fA-F]{64}$/.test(key)) {
		throw new SecretKeyError(
			'SECRET_KEY must be a 64-character hex string (256 bits). ' +
				'Generate one with: openssl rand -hex 32'
		);
	}

	return key;
}

/**
 * Converts a hex string to Uint8Array.
 */
function hexToBytes(hex: string): Uint8Array {
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	}
	return bytes;
}

/**
 * Converts Uint8Array to hex string.
 */
function bytesToHex(bytes: Uint8Array): string {
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Gets or creates the CryptoKey from SECRET_KEY.
 * Caches the key for performance.
 */
async function getCryptoKey(): Promise<CryptoKey> {
	const keyHex = getSecretKey();

	// Return cached key if SECRET_KEY hasn't changed
	if (cachedKey && cachedKeyHex === keyHex) {
		return cachedKey;
	}

	const keyBytes = hexToBytes(keyHex);

	cachedKey = await crypto.subtle.importKey(
		'raw',
		keyBytes.buffer as ArrayBuffer,
		{ name: ALGORITHM },
		false,
		['encrypt', 'decrypt']
	);
	cachedKeyHex = keyHex;

	return cachedKey;
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 *
 * Uses a random IV for each encryption, making identical plaintexts
 * produce different ciphertexts. The IV and auth tag are prepended
 * to the ciphertext in the format: iv:authTag:ciphertext
 *
 * @param plaintext - The string to encrypt
 * @returns Encrypted string in format iv:authTag:ciphertext (hex encoded)
 * @throws SecretKeyError if SECRET_KEY is missing or invalid
 */
export async function encrypt(plaintext: string): Promise<string> {
	const key = await getCryptoKey();

	// Generate random IV for each encryption
	const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

	// Encode plaintext to bytes
	const encoder = new TextEncoder();
	const plaintextBytes = encoder.encode(plaintext);

	// Encrypt with AES-256-GCM
	const encrypted = await crypto.subtle.encrypt(
		{
			name: ALGORITHM,
			iv,
			tagLength: AUTH_TAG_LENGTH
		},
		key,
		plaintextBytes
	);

	// Web Crypto API appends auth tag to ciphertext
	// Extract them separately for our format
	const encryptedArray = new Uint8Array(encrypted);
	const authTagStart = encryptedArray.length - AUTH_TAG_LENGTH / 8;
	const ciphertext = encryptedArray.slice(0, authTagStart);
	const authTag = encryptedArray.slice(authTagStart);

	// Format: iv:authTag:ciphertext
	return `${bytesToHex(iv)}:${bytesToHex(authTag)}:${bytesToHex(ciphertext)}`;
}

/**
 * Decrypts an encrypted string using AES-256-GCM.
 *
 * Validates the authentication tag to detect tampering.
 *
 * @param encrypted - Encrypted string in format iv:authTag:ciphertext
 * @returns The decrypted plaintext string
 * @throws DecryptionError if ciphertext is invalid, tampered, or uses wrong key
 * @throws SecretKeyError if SECRET_KEY is missing or invalid
 */
export async function decrypt(encrypted: string): Promise<string> {
	const key = await getCryptoKey();

	// Parse the encrypted format
	const parts = encrypted.split(':');
	if (parts.length !== 3) {
		throw new DecryptionError('Invalid encrypted format: expected iv:authTag:ciphertext');
	}

	const [ivHex, authTagHex, ciphertextHex] = parts;

	// Validate component lengths
	if (!ivHex || ivHex.length !== IV_LENGTH * 2) {
		throw new DecryptionError(`Invalid IV length: expected ${IV_LENGTH * 2} hex characters`);
	}
	if (!authTagHex || authTagHex.length !== (AUTH_TAG_LENGTH / 8) * 2) {
		throw new DecryptionError(
			`Invalid auth tag length: expected ${(AUTH_TAG_LENGTH / 8) * 2} hex characters`
		);
	}
	if (!ciphertextHex || ciphertextHex.length === 0) {
		throw new DecryptionError('Ciphertext cannot be empty');
	}

	// Validate hex format
	if (!/^[0-9a-fA-F]+$/.test(ivHex + authTagHex + ciphertextHex)) {
		throw new DecryptionError('Invalid hex encoding in encrypted data');
	}

	const iv = hexToBytes(ivHex);
	const authTag = hexToBytes(authTagHex);
	const ciphertext = hexToBytes(ciphertextHex);

	// Web Crypto expects auth tag appended to ciphertext
	const combined = new Uint8Array(ciphertext.length + authTag.length);
	combined.set(ciphertext);
	combined.set(authTag, ciphertext.length);

	try {
		const decrypted = await crypto.subtle.decrypt(
			{
				name: ALGORITHM,
				iv: iv.buffer as ArrayBuffer,
				tagLength: AUTH_TAG_LENGTH
			},
			key,
			combined.buffer as ArrayBuffer
		);

		const decoder = new TextDecoder();
		return decoder.decode(decrypted);
	} catch {
		// Crypto errors indicate tampering, wrong key, or corrupted data
		throw new DecryptionError('Decryption failed: data may be tampered or encrypted with a different key');
	}
}
