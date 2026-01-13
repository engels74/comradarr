import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import * as schema from './schema';

declare global {
	var __dbClient: SQL | undefined;
}

function getOrCreateClient(): SQL {
	if (!globalThis.__dbClient) {
		console.log('[db] Creating new SQL client');
		globalThis.__dbClient = new SQL({
			url: process.env.DATABASE_URL!,
			max: 20,
			idleTimeout: 30,
			maxLifetime: 60 * 30,
			connectionTimeout: 30
		});
	} else {
		console.log('[db] Reusing existing SQL client');
	}
	return globalThis.__dbClient;
}

const client = getOrCreateClient();
export const db = drizzle({ client, schema });

export { schema };

/** Close the database connection pool. Used for graceful shutdown. */
export async function closePool(): Promise<void> {
	if (globalThis.__dbClient) {
		await globalThis.__dbClient.close();
		globalThis.__dbClient = undefined;
	}
}

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
				setTimeout(() => process.kill(process.pid, signal), 100);
			});
	};
	return handler;
};

const sigtermHandler = createShutdownHandler('SIGTERM');
const sigintHandler = createShutdownHandler('SIGINT');

process.on('SIGTERM', sigtermHandler);
process.on('SIGINT', sigintHandler);
