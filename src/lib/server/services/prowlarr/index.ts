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

// Types
export type {
	ProwlarrClientConfig,
	ProwlarrIndexerStatus,
	ProwlarrIndexer,
	IndexerHealth,
	ProwlarrHealthStatus,
	HealthCheckResult,
	CachedIndexerHealth,
	HealthSummary,
	HealthMonitorConfig
} from './types.js';

// Parsers
export {
	parseProwlarrIndexerStatus,
	parseProwlarrIndexer,
	ProwlarrIndexerStatusSchema,
	ProwlarrIndexerSchema
} from './parsers.js';
