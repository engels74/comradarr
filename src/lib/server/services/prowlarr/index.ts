/**
 * Prowlarr integration module exports.
 *
 * Prowlarr is an optional service for indexer health monitoring.
 * It provides visibility into indexer rate-limiting status.
 *
 * @module services/prowlarr
 * @requirements 38.1, 38.2, 38.3
 */

// Client
export { ProwlarrClient } from './client.js';

// Types
export type {
	ProwlarrClientConfig,
	ProwlarrIndexerStatus,
	ProwlarrIndexer,
	IndexerHealth,
	ProwlarrHealthStatus
} from './types.js';

// Parsers
export {
	parseProwlarrIndexerStatus,
	parseProwlarrIndexer,
	ProwlarrIndexerStatusSchema,
	ProwlarrIndexerSchema
} from './parsers.js';
