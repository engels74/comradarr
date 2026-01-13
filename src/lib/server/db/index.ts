import { SQL } from 'bun';
import { sql } from 'drizzle-orm';
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

/**
 * Warm up the connection pool by executing a simple query.
 * This ensures at least one connection is established and ready before accepting requests.
 * Prevents race conditions where first queries fail due to lazy connection initialization.
 */
export async function warmupPool(): Promise<void> {
	const startTime = performance.now();
	try {
		await db.execute(sql`SELECT 1`);
		const latencyMs = Math.round(performance.now() - startTime);
		console.log(`[db] Connection pool warmed up (${latencyMs}ms)`);
	} catch (error) {
		// Log only the message to avoid exposing sensitive connection details (URLs/credentials)
		const message = error instanceof Error ? error.message : 'Unknown error';
		console.error('[db] Failed to warm up connection pool:', message);
		throw error;
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
