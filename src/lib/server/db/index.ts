import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import * as schema from './schema';

const client = new SQL({
	url: process.env.DATABASE_URL!,
	max: 10, // Pool size (requirement 13.4: 10-25)
	idleTimeout: 30, // Close idle after 30s
	maxLifetime: 60 * 30, // Recycle connections after 30min
	connectionTimeout: 30 // Acquisition timeout
});

export const db = drizzle({ client, schema });

// Re-export schema for type inference
export { schema };

/** Close the database connection pool. Used for graceful shutdown. */
export async function closePool(): Promise<void> {
	await client.close();
}

// Register shutdown handlers to gracefully close connections
let shuttingDown = false;

const createShutdownHandler = (signal: 'SIGTERM' | 'SIGINT') => {
	const handler = async () => {
		if (shuttingDown) return;
		shuttingDown = true;
		console.log(`[db] Received ${signal}, closing connection pool...`);
		try {
			await closePool();
			console.log('[db] Connection pool closed');
		} catch (err) {
			console.error('[db] Error closing pool:', err);
		}
		// Remove only our handler and re-raise signal for default termination behavior
		process.off(signal, handler);
		process.kill(process.pid, signal);
	};
	return handler;
};

const sigtermHandler = createShutdownHandler('SIGTERM');
const sigintHandler = createShutdownHandler('SIGINT');

process.on('SIGTERM', sigtermHandler);
process.on('SIGINT', sigintHandler);
