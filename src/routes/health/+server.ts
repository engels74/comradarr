/**
 * Health check endpoint for container orchestration and monitoring.
 *
 * This endpoint is intentionally outside authenticated routes to allow
 * health checks from load balancers, Docker, Kubernetes, etc.
 *
 * Response:
 * - HTTP 200: healthy or degraded (application is operational)
 * - HTTP 503: unhealthy (database unreachable or critical failure)
 */

import { json } from '@sveltejs/kit';
import { getHealthSummary, type HealthStatus } from '$lib/server/db/queries/health';
import type { RequestHandler } from './$types';

interface ApplicationStatus {
	name: string;
	version: string;
	uptime: number;
}

interface DatabaseStatus {
	status: 'connected' | 'disconnected';
	latencyMs?: number;
	error?: string;
}

interface MemoryStatus {
	heapUsed: number;
	heapTotal: number;
	rss: number;
}

interface ConnectorStatus {
	id: number;
	name: string;
	type: string;
	healthStatus: string;
	queuePaused: boolean;
	queueDepth: number;
}

interface QueueStatus {
	totalDepth: number;
	pausedConnectors: number;
}

interface HealthResponse {
	status: HealthStatus;
	timestamp: string;
	application: ApplicationStatus;
	database: DatabaseStatus;
	memory: MemoryStatus;
	connectors: ConnectorStatus[];
	queue: QueueStatus;
}

const APP_NAME = 'Comradarr';
const APP_VERSION = '0.0.1';

export const GET: RequestHandler = async () => {
	const healthSummary = await getHealthSummary();
	const memoryUsage = process.memoryUsage();

	const response: HealthResponse = {
		status: healthSummary.overallStatus,
		timestamp: new Date().toISOString(),
		application: {
			name: APP_NAME,
			version: APP_VERSION,
			uptime: Math.floor(process.uptime())
		},
		database: {
			status: healthSummary.database.status,
			...(healthSummary.database.latencyMs !== undefined && {
				latencyMs: healthSummary.database.latencyMs
			}),
			...(healthSummary.database.error !== undefined && {
				error: healthSummary.database.error
			})
		},
		memory: {
			heapUsed: memoryUsage.heapUsed,
			heapTotal: memoryUsage.heapTotal,
			rss: memoryUsage.rss
		},
		connectors: healthSummary.connectors,
		queue: healthSummary.queue
	};

	const httpStatus = healthSummary.overallStatus === 'unhealthy' ? 503 : 200;
	return json(response, { status: httpStatus });
};
