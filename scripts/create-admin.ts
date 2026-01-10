#!/usr/bin/env bun
/**
 * Create admin user for Comradarr.
 *
 * This script creates the initial admin user with the provided password.
 * It's used by the Python CLI (comradarr-dev) to bootstrap the development database.
 *
 * Required environment variables:
 * - DATABASE_URL: PostgreSQL connection string
 * - ADMIN_PASSWORD: Password for the admin user
 *
 * Usage:
 *   DATABASE_URL="..." ADMIN_PASSWORD="..." bun scripts/create-admin.ts
 */

import { hash } from '@node-rs/argon2';
import { SQL } from 'bun';

// OWASP recommended parameters for Argon2id
// Must match src/lib/server/auth/password.ts
const ARGON2_OPTIONS = {
	memoryCost: 65536, // 64 MiB
	timeCost: 3, // 3 iterations
	parallelism: 1, // 1 thread
	algorithm: 2 // Argon2id
} as const;

async function createAdmin() {
	const password = process.env.ADMIN_PASSWORD;
	const databaseUrl = process.env.DATABASE_URL;

	if (!password) {
		console.error('Error: ADMIN_PASSWORD environment variable is required');
		process.exit(1);
	}

	if (!databaseUrl) {
		console.error('Error: DATABASE_URL environment variable is required');
		process.exit(1);
	}

	const passwordHash = await hash(password, ARGON2_OPTIONS);

	const client = new SQL({
		url: databaseUrl,
		max: 1,
		idleTimeout: 5
	});

	try {
		// Check if user exists
		const existing = await client`SELECT id FROM users WHERE username = 'admin' LIMIT 1`;
		if (existing.length > 0) {
			console.log('Admin user already exists');
			return;
		}

		// Insert admin user
		await client`
			INSERT INTO users (username, password_hash, display_name, role)
			VALUES ('admin', ${passwordHash}, 'Administrator', 'admin')
		`;
		console.log('Admin user created');
	} finally {
		client.end();
	}
}

createAdmin().catch((err) => {
	console.error('Failed to create admin:', err);
	process.exit(1);
});
