import { defineConfig } from 'drizzle-kit';

export default defineConfig({
	out: './drizzle',
	schema: './src/lib/server/db/schema/index.ts',
	dialect: 'postgresql',
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
