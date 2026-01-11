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
// Note: Signal handlers must NOT be async - Node.js doesn't await them.
// We use .then()/.finally() to sequence operations before re-raising the signal.
let shuttingDown = false;

const createShutdownHandler = (signal: 'SIGTERM' | 'SIGINT') => {
	const handler = () => {
		if (shuttingDown) return;
		shuttingDown = true;
		console.log(`[db] Received ${signal}, closing connection pool...`);

		closePool()
			.then(() => console.log('[db] Connection pool closed'))
			.catch((err) => console.error('[db] Error closing pool:', err))
			.finally(() => {
				process.off(signal, handler);
				// Small delay to ensure I/O completes before re-raising signal
				setTimeout(() => process.kill(process.pid, signal), 100);
			});
	};
	return handler;
};

const sigtermHandler = createShutdownHandler('SIGTERM');
const sigintHandler = createShutdownHandler('SIGINT');

process.on('SIGTERM', sigtermHandler);
process.on('SIGINT', sigintHandler);
