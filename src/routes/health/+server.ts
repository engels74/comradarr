/**
 * Health check endpoint for container orchestration and monitoring.
 *
 * This endpoint is intentionally outside authenticated routes to allow
 * health checks from load balancers, Docker, Kubernetes, etc.
 *
 * Response:
 * - HTTP 200: healthy or degraded (application is operational)
 * - HTTP 503: unhealthy (database unreachable or critical failure)
 *
 * Requirements: 32.1, 32.2, 32.3, 32.4, 32.5
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getHealthSummary, type HealthStatus } from '$lib/server/db/queries/health';

// =============================================================================
// Types
// =============================================================================

/**
 * Application status information.
 */
interface ApplicationStatus {
	name: string;
	version: string;
	uptime: number; // seconds
}

/**
 * Database status information.
 */
interface DatabaseStatus {
	status: 'connected' | 'disconnected';
	latencyMs?: number;
	error?: string;
}

/**
 * Memory usage information.
 */
interface MemoryStatus {
	heapUsed: number; // bytes
	heapTotal: number; // bytes
	rss: number; // bytes
}

/**
 * Per-connector health status.
 */
interface ConnectorStatus {
	id: number;
	name: string;
	type: string;
	healthStatus: string;
	queuePaused: boolean;
	queueDepth: number;
}

/**
 * Queue status summary.
 */
interface QueueStatus {
	totalDepth: number;
	pausedConnectors: number;
}

/**
 * Complete health check response.
 */
interface HealthResponse {
	status: HealthStatus;
	timestamp: string;
	application: ApplicationStatus;
	database: DatabaseStatus;
	memory: MemoryStatus;
	connectors: ConnectorStatus[];
	queue: QueueStatus;
}

// =============================================================================
// Constants
// =============================================================================

/** Application name for health response */
const APP_NAME = 'Comradarr';

/** Application version from package.json */
const APP_VERSION = '0.0.1';

// =============================================================================
// Handler
// =============================================================================

/**
 * GET /health
 *
 * Returns comprehensive health status for the application.
 *
 * Status codes:
 * - 200: healthy or degraded (Requirement 32.4)
 * - 503: unhealthy/database unreachable (Requirement 32.3)
 */
export const GET: RequestHandler = async () => {
	// Get health summary from database queries
	const healthSummary = await getHealthSummary();

	// Get memory usage (Requirement 32.1)
	const memoryUsage = process.memoryUsage();

	// Build response
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

	// Return 503 for unhealthy status (Requirement 32.3)
	// Return 200 for healthy or degraded (Requirement 32.4)
	const httpStatus = healthSummary.overallStatus === 'unhealthy' ? 503 : 200;

	return json(response, { status: httpStatus });
};
