/**
 * Prowlarr integration module exports.
 *
 * Prowlarr is an optional service for indexer health monitoring.
 * It provides visibility into indexer rate-limiting status.
 *
 * @module services/prowlarr
 * @requirements 38.1, 38.2, 38.3, 38.4
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
