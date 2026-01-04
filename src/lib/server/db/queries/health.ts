/**
 * Database queries for health check operations.
 *
 *
 * Provides queries for the /health endpoint including:
 * - Database connection check with latency measurement
 * - Per-connector health summary with queue status
 * - Global queue aggregation
 */

import { count, eq, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { connectors, requestQueue } from '$lib/server/db/schema';

// =============================================================================
// Types
// =============================================================================

/**
 * Overall health status for the application.
 */
export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

/**
 * Database connection status result.
 */
export interface DatabaseHealthResult {
	status: 'connected' | 'disconnected';
	latencyMs?: number;
	error?: string;
}

/**
 * Per-connector health summary for health check endpoint.
 */
export interface ConnectorHealthSummary {
	id: number;
	name: string;
	type: string;
	healthStatus: string;
	queuePaused: boolean;
	queueDepth: number;
}

/**
 * Global queue status aggregation.
 */
export interface QueueHealthSummary {
	totalDepth: number;
	pausedConnectors: number;
}

/**
 * Complete health summary from database.
 */
export interface HealthSummary {
	database: DatabaseHealthResult;
	connectors: ConnectorHealthSummary[];
	queue: QueueHealthSummary;
	overallStatus: HealthStatus;
}

// =============================================================================
// Database Health Check
// =============================================================================

/**
 * Checks database connection by executing a simple query.
 * Measures round-trip latency in milliseconds.
 *
 *
 * @returns Database connection status with latency
 */
export async function checkDatabaseConnection(): Promise<DatabaseHealthResult> {
	const startTime = performance.now();

	try {
		// Execute a simple query to verify connection
		await db.execute(sql`SELECT 1`);

		const latencyMs = Math.round(performance.now() - startTime);

		return {
			status: 'connected',
			latencyMs
		};
	} catch (error) {
		return {
			status: 'disconnected',
			error: error instanceof Error ? error.message : 'Unknown database error'
		};
	}
}

// =============================================================================
// Connector Health Summary
// =============================================================================

/**
 * Gets health summary for all connectors including queue depth per connector.
 *
 *
 * @returns Array of connector health summaries
 */
export async function getConnectorHealthSummary(): Promise<ConnectorHealthSummary[]> {
	const result = await db
		.select({
			id: connectors.id,
			name: connectors.name,
			type: connectors.type,
			healthStatus: connectors.healthStatus,
			queuePaused: connectors.queuePaused,
			queueDepth: sql<number>`COALESCE(queue_counts.queue_depth, 0)::int`.as('queue_depth')
		})
		.from(connectors)
		.leftJoin(
			sql`(
				SELECT connector_id, COUNT(*) as queue_depth
				FROM request_queue
				GROUP BY connector_id
			) AS queue_counts`,
			sql`queue_counts.connector_id = ${connectors.id}`
		)
		.orderBy(connectors.name);

	return result.map((row) => ({
		id: row.id,
		name: row.name,
		type: row.type,
		healthStatus: row.healthStatus,
		queuePaused: row.queuePaused,
		queueDepth: row.queueDepth
	}));
}

// =============================================================================
// Queue Health Summary
// =============================================================================

/**
 * Gets global queue health summary.
 *
 *
 * @returns Queue status including total depth and paused connector count
 */
export async function getQueueHealthSummary(): Promise<QueueHealthSummary> {
	// Run both queries in parallel
	const [totalDepthResult, pausedCountResult] = await Promise.all([
		// Total queue depth across all connectors
		db
			.select({ count: count() })
			.from(requestQueue),

		// Count of connectors with queuePaused = true
		db
			.select({ count: count() })
			.from(connectors)
			.where(eq(connectors.queuePaused, true))
	]);

	return {
		totalDepth: totalDepthResult[0]?.count ?? 0,
		pausedConnectors: pausedCountResult[0]?.count ?? 0
	};
}

// =============================================================================
// Combined Health Summary
// =============================================================================

/**
 * Gets complete health summary for the /health endpoint.
 *
 * Determines overall status based on:
 * - Database connection (unreachable = unhealthy)
 * - Connector health (any unhealthy/offline = degraded)
 *
 *
 * @returns Complete health summary including overall status
 */
export async function getHealthSummary(): Promise<HealthSummary> {
	// Check database connection first
	const database = await checkDatabaseConnection();

	// If database is disconnected, return unhealthy status immediately
	if (database.status === 'disconnected') {
		return {
			database,
			connectors: [],
			queue: { totalDepth: 0, pausedConnectors: 0 },
			overallStatus: 'unhealthy'
		};
	}

	// Database is connected, fetch connector and queue data
	const [connectorSummary, queue] = await Promise.all([
		getConnectorHealthSummary(),
		getQueueHealthSummary()
	]);

	// Determine overall status
	let overallStatus: HealthStatus = 'healthy';

	// Check if any connector is unhealthy or offline
	const hasUnhealthyConnector = connectorSummary.some(
		(c) => c.healthStatus === 'unhealthy' || c.healthStatus === 'offline'
	);

	if (hasUnhealthyConnector) {
		overallStatus = 'degraded';
	}

	return {
		database,
		connectors: connectorSummary,
		queue,
		overallStatus
	};
}
