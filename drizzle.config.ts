import { defineConfig } from 'drizzle-kit';

export default defineConfig({
	out: './drizzle',
	schema: './src/lib/server/db/schema/index.ts',
	dialect: 'postgresql',
	// drizzle-kit uses the 'postgres' package (Node.js driver) for migrations/push/studio
	// Runtime uses bun:sql via drizzle-orm/bun-sql in src/lib/server/db/index.ts
	dbCredentials: {
		url: process.env.DATABASE_URL!
	},
	migrations: {
		prefix: 'timestamp',
		table: '__drizzle_migrations__'
	},
	strict: true,
	verbose: true
});
