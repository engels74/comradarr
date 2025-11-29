import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import * as schema from './schema';

const client = new SQL({
	url: process.env.DATABASE_URL!,
	max: 20, // Pool size (requirement 13.4: 10-25)
	idleTimeout: 30, // Close idle after 30s
	maxLifetime: 60 * 30, // Recycle connections after 30min
	connectionTimeout: 30 // Acquisition timeout
});

export const db = drizzle({ client, schema });

// Re-export schema for type inference
export { schema };
