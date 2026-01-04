/**
 * Prowlarr integration module exports.
 *
 * Prowlarr is an optional service for indexer health monitoring.
 * It provides visibility into indexer rate-limiting status.
 *
 * @module services/prowlarr

 */

// Client
export { ProwlarrClient } from './client.js';

// Health Monitor
export { ProwlarrHealthMonitor, prowlarrHealthMonitor } from './health-monitor.js';
// Parsers
export {
	ProwlarrIndexerSchema,
	ProwlarrIndexerStatusSchema,
	parseProwlarrIndexer,
	parseProwlarrIndexerStatus
} from './parsers.js';
// Types
export type {
	CachedIndexerHealth,
	HealthCheckResult,
	HealthMonitorConfig,
	HealthSummary,
	IndexerHealth,
	ProwlarrClientConfig,
	ProwlarrHealthStatus,
	ProwlarrIndexer,
	ProwlarrIndexerStatus
} from './types.js';
