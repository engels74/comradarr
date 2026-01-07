/**
 * AES-256-GCM encryption utilities.
 * Encrypted format: iv:authTag:ciphertext (hex encoded)
 */

const ALGORITHM = 'AES-GCM';
const _KEY_LENGTH = 256;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 128;

export class DecryptionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'DecryptionError';
	}
}

export class SecretKeyError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'SecretKeyError';
	}
}

let cachedKey: CryptoKey | null = null;
let cachedKeyHex: string | null = null;

export function getSecretKey(): string {
	const key = process.env.SECRET_KEY;

	if (!key) {
		throw new SecretKeyError(
			'SECRET_KEY environment variable is required. ' + 'Generate one with: openssl rand -hex 32'
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

function hexToBytes(hex: string): Uint8Array {
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	}
	return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function getCryptoKey(): Promise<CryptoKey> {
	const keyHex = getSecretKey();

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

export async function encrypt(plaintext: string): Promise<string> {
	const key = await getCryptoKey();
	const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
	const encoder = new TextEncoder();
	const plaintextBytes = encoder.encode(plaintext);

	const encrypted = await crypto.subtle.encrypt(
		{
			name: ALGORITHM,
			iv,
			tagLength: AUTH_TAG_LENGTH
		},
		key,
		plaintextBytes
	);

	// Web Crypto API appends auth tag to ciphertext - extract separately for our format
	const encryptedArray = new Uint8Array(encrypted);
	const authTagStart = encryptedArray.length - AUTH_TAG_LENGTH / 8;
	const ciphertext = encryptedArray.slice(0, authTagStart);
	const authTag = encryptedArray.slice(authTagStart);

	return `${bytesToHex(iv)}:${bytesToHex(authTag)}:${bytesToHex(ciphertext)}`;
}

export async function decrypt(encrypted: string): Promise<string> {
	const key = await getCryptoKey();
	const parts = encrypted.split(':');
	if (parts.length !== 3) {
		throw new DecryptionError('Invalid encrypted format: expected iv:authTag:ciphertext');
	}

	const [ivHex, authTagHex, ciphertextHex] = parts;

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

	if (!/^[0-9a-fA-F]+$/.test(ivHex + authTagHex + ciphertextHex)) {
		throw new DecryptionError('Invalid hex encoding in encrypted data');
	}

	const iv = hexToBytes(ivHex);
	const authTag = hexToBytes(authTagHex);
	const ciphertext = hexToBytes(ciphertextHex);

	// Web Crypto API expects auth tag appended to ciphertext
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
		throw new DecryptionError(
			'Decryption failed: data may be tampered or encrypted with a different key'
		);
	}
}
