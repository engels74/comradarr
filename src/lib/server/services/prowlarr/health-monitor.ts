/**
 * Prowlarr health monitoring service.
 *
 * Periodically checks Prowlarr instances for indexer health status
 * and caches the results in the database for quick access by other services.
 *
 * @module services/prowlarr/health-monitor
 * @requirements 38.2, 38.4
 */

import { ProwlarrClient } from './client.js';
import type {
	HealthCheckResult,
	CachedIndexerHealth,
	HealthSummary,
	HealthMonitorConfig,
	ProwlarrHealthStatus
} from './types.js';
import type { ProwlarrInstance } from '$lib/server/db/schema';
import {
	getEnabledProwlarrInstances,
	getAllProwlarrInstances,
	getDecryptedApiKey,
	updateProwlarrHealth,
	upsertIndexerHealth,
	getIndexerHealthByInstance,
	getAllCachedIndexerHealth,
	deleteStaleIndexerHealth
} from '$lib/server/db/queries/prowlarr';
import { isArrClientError } from '$lib/server/connectors/common/errors';

// =============================================================================
// Constants
// =============================================================================

/** Default health check interval: 5 minutes */
const DEFAULT_CHECK_INTERVAL_MS = 5 * 60 * 1000;

/** Default stale threshold: 10 minutes */
const DEFAULT_STALE_THRESHOLD_MS = 10 * 60 * 1000;

// =============================================================================
// ProwlarrHealthMonitor
// =============================================================================

/**
 * Prowlarr health monitoring service.
 *
 * Provides periodic health checking for Prowlarr instances and caches
 * indexer health status in the database.
 *
 * @requirements 38.2, 38.4
 *
 * @example
 * ```typescript
 * // Check all enabled instances
 * const results = await prowlarrHealthMonitor.checkAllInstances();
 *
 * // Get cached health for display
 * const cached = await prowlarrHealthMonitor.getCachedHealth(1);
 *
 * // Get health summary
 * const summary = await prowlarrHealthMonitor.getHealthSummary();
 * ```
 */
export class ProwlarrHealthMonitor {
	private readonly checkIntervalMs: number;
	private readonly staleThresholdMs: number;

	constructor(config: HealthMonitorConfig = {}) {
		this.checkIntervalMs = config.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS;
		this.staleThresholdMs = config.staleThresholdMs ?? DEFAULT_STALE_THRESHOLD_MS;
	}

	/**
	 * Check health for all enabled Prowlarr instances.
	 * Updates both instance-level and per-indexer health in database.
	 *
	 * @returns Array of health check results for each instance
	 *
	 * @requirements 38.2
	 */
	async checkAllInstances(): Promise<HealthCheckResult[]> {
		const instances = await getEnabledProwlarrInstances();

		if (instances.length === 0) {
			return [];
		}

		// Check instances sequentially to avoid overwhelming Prowlarr
		const results: HealthCheckResult[] = [];
		for (const instance of instances) {
			const result = await this.checkInstance(instance);
			results.push(result);
		}

		return results;
	}

	/**
	 * Check health for a single Prowlarr instance.
	 *
	 * @param instance - Prowlarr instance to check
	 * @returns Health check result
	 *
	 * @requirements 38.2
	 */
	async checkInstance(instance: ProwlarrInstance): Promise<HealthCheckResult> {
		const checkedAt = new Date();

		try {
			// Decrypt API key for the request
			const apiKey = await getDecryptedApiKey(instance);

			// Create client and fetch health
			const client = new ProwlarrClient({
				baseUrl: instance.url,
				apiKey
			});

			// First ping to verify connectivity
			const isOnline = await client.ping();
			if (!isOnline) {
				await updateProwlarrHealth(instance.id, 'offline');
				return {
					instanceId: instance.id,
					instanceName: instance.name,
					status: 'offline',
					indexersChecked: 0,
					indexersRateLimited: 0,
					error: 'Prowlarr is not responding to ping',
					checkedAt
				};
			}

			// Fetch indexer health
			const indexerHealth = await client.getIndexerHealth();

			// Update database cache
			await upsertIndexerHealth(instance.id, indexerHealth);

			// Remove any indexers that no longer exist in Prowlarr
			const activeIndexerIds = indexerHealth.map((h) => h.indexerId);
			await deleteStaleIndexerHealth(instance.id, activeIndexerIds);

			// Calculate rate-limited count
			const rateLimitedCount = indexerHealth.filter((h) => h.isRateLimited).length;

			// Determine instance health status
			const status = this.determineInstanceHealth(indexerHealth.length, rateLimitedCount);

			// Update instance health in database
			await updateProwlarrHealth(instance.id, status);

			return {
				instanceId: instance.id,
				instanceName: instance.name,
				status,
				indexersChecked: indexerHealth.length,
				indexersRateLimited: rateLimitedCount,
				checkedAt
			};
		} catch (error) {
			// Categorize error and determine status
			const { status, errorMessage } = this.categorizeError(error);

			// Update instance health to reflect error
			await updateProwlarrHealth(instance.id, status);

			return {
				instanceId: instance.id,
				instanceName: instance.name,
				status,
				indexersChecked: 0,
				indexersRateLimited: 0,
				error: errorMessage,
				checkedAt
			};
		}
	}

	/**
	 * Get cached indexer health for an instance.
	 * Returns cached data even if stale (for 38.6 requirement).
	 *
	 * @param instanceId - Prowlarr instance ID
	 * @returns Array of cached indexer health with stale indicators
	 *
	 * @requirements 38.4, 38.6
	 */
	async getCachedHealth(instanceId: number): Promise<CachedIndexerHealth[]> {
		const cached = await getIndexerHealthByInstance(instanceId);
		const now = new Date();

		return cached.map((entry) => ({
			instanceId: entry.prowlarrInstanceId,
			indexerId: entry.indexerId,
			name: entry.name,
			enabled: entry.enabled,
			isRateLimited: entry.isRateLimited,
			rateLimitExpiresAt: entry.rateLimitExpiresAt,
			mostRecentFailure: entry.mostRecentFailure,
			lastUpdated: entry.lastUpdated,
			isStale: now.getTime() - entry.lastUpdated.getTime() > this.staleThresholdMs
		}));
	}

	/**
	 * Get all cached indexer health across all instances.
	 *
	 * @returns Array of all cached indexer health with stale indicators
	 *
	 * @requirements 38.4
	 */
	async getAllCachedHealth(): Promise<CachedIndexerHealth[]> {
		const cached = await getAllCachedIndexerHealth();
		const now = new Date();

		return cached.map((entry) => ({
			instanceId: entry.prowlarrInstanceId,
			indexerId: entry.indexerId,
			name: entry.name,
			enabled: entry.enabled,
			isRateLimited: entry.isRateLimited,
			rateLimitExpiresAt: entry.rateLimitExpiresAt,
			mostRecentFailure: entry.mostRecentFailure,
			lastUpdated: entry.lastUpdated,
			isStale: now.getTime() - entry.lastUpdated.getTime() > this.staleThresholdMs
		}));
	}

	/**
	 * Get summary health status for all instances.
	 *
	 * @returns Health summary
	 *
	 * @requirements 38.4
	 */
	async getHealthSummary(): Promise<HealthSummary> {
		const instances = await getAllProwlarrInstances();
		const allHealth = await getAllCachedIndexerHealth();

		const healthyInstances = instances.filter((i) => i.healthStatus === 'healthy').length;
		const rateLimitedIndexers = allHealth.filter((h) => h.isRateLimited).length;

		return {
			totalInstances: instances.length,
			healthyInstances,
			totalIndexers: allHealth.length,
			rateLimitedIndexers
		};
	}

	/**
	 * Get the configured check interval in milliseconds.
	 */
	getCheckIntervalMs(): number {
		return this.checkIntervalMs;
	}

	/**
	 * Get the configured stale threshold in milliseconds.
	 */
	getStaleThresholdMs(): number {
		return this.staleThresholdMs;
	}

	/**
	 * Determine instance health status based on indexer states.
	 *
	 * @param totalIndexers - Total number of indexers
	 * @param rateLimitedCount - Number of rate-limited indexers
	 * @returns Health status
	 */
	private determineInstanceHealth(
		totalIndexers: number,
		rateLimitedCount: number
	): ProwlarrHealthStatus {
		if (totalIndexers === 0) {
			// No indexers configured
			return 'unknown';
		}

		if (rateLimitedCount === 0) {
			// All indexers healthy
			return 'healthy';
		}

		// Calculate percentage of rate-limited indexers
		const rateLimitedPercent = (rateLimitedCount / totalIndexers) * 100;

		if (rateLimitedPercent >= 50) {
			// More than half are rate-limited
			return 'unhealthy';
		}

		// Some indexers are rate-limited but not majority
		return 'degraded';
	}

	/**
	 * Categorize an error and determine appropriate health status.
	 *
	 * @param error - The caught error
	 * @returns Status and error message
	 */
	private categorizeError(error: unknown): {
		status: ProwlarrHealthStatus;
		errorMessage: string;
	} {
		if (isArrClientError(error)) {
			// Network errors = offline
			if (error.name === 'NetworkError' || error.name === 'TimeoutError') {
				return {
					status: 'offline',
					errorMessage: error.message
				};
			}

			// Auth errors = unhealthy (needs configuration fix)
			if (error.name === 'AuthenticationError') {
				return {
					status: 'unhealthy',
					errorMessage: 'Authentication failed - check API key'
				};
			}

			// Server errors = unhealthy
			if (error.name === 'ServerError') {
				return {
					status: 'unhealthy',
					errorMessage: error.message
				};
			}
		}

		// Unknown error
		const message = error instanceof Error ? error.message : 'Unknown error';
		return {
			status: 'unhealthy',
			errorMessage: message
		};
	}
}

// =============================================================================
// Singleton Instance
// =============================================================================

/**
 * Singleton instance of ProwlarrHealthMonitor.
 * Use this for application-wide health monitoring.
 */
export const prowlarrHealthMonitor = new ProwlarrHealthMonitor();
