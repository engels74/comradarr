import { isArrClientError } from '$lib/server/connectors/common/errors';
import {
	deleteStaleIndexerHealth,
	getAllCachedIndexerHealth,
	getAllProwlarrInstances,
	getDecryptedApiKey,
	getEnabledProwlarrInstances,
	getIndexerHealthByInstance,
	updateProwlarrHealth,
	upsertIndexerHealth
} from '$lib/server/db/queries/prowlarr';
import type { ProwlarrInstance } from '$lib/server/db/schema';
import { createLogger } from '$lib/server/logger';
import { ProwlarrClient } from './client.js';
import type {
	CachedIndexerHealth,
	HealthCheckResult,
	HealthMonitorConfig,
	HealthSummary,
	ProwlarrHealthStatus
} from './types.js';

const logger = createLogger('prowlarr-health');

const DEFAULT_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_STALE_THRESHOLD_MS = 10 * 60 * 1000;

export class ProwlarrHealthMonitor {
	private readonly checkIntervalMs: number;
	private readonly staleThresholdMs: number;

	constructor(config: HealthMonitorConfig = {}) {
		this.checkIntervalMs = config.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS;
		this.staleThresholdMs = config.staleThresholdMs ?? DEFAULT_STALE_THRESHOLD_MS;
	}

	async checkAllInstances(): Promise<HealthCheckResult[]> {
		const instances = await getEnabledProwlarrInstances();

		if (instances.length === 0) {
			logger.debug('No enabled Prowlarr instances to check');
			return [];
		}

		logger.debug('Checking Prowlarr instances', { count: instances.length });

		// Check instances sequentially to avoid overwhelming Prowlarr
		const results: HealthCheckResult[] = [];
		for (const instance of instances) {
			const result = await this.checkInstance(instance);
			results.push(result);
		}

		const healthySummary = results.filter((r) => r.status === 'healthy').length;
		const rateLimitedTotal = results.reduce((sum, r) => sum + r.indexersRateLimited, 0);

		logger.info('Prowlarr health check completed', {
			instancesChecked: results.length,
			healthyInstances: healthySummary,
			totalRateLimitedIndexers: rateLimitedTotal
		});

		return results;
	}

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
				logger.warn('Prowlarr instance offline', {
					instanceId: instance.id,
					instanceName: instance.name
				});
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

			if (rateLimitedCount > 0) {
				logger.warn('Indexers rate limited', {
					instanceId: instance.id,
					instanceName: instance.name,
					rateLimitedCount,
					totalIndexers: indexerHealth.length
				});
			}

			logger.debug('Instance health checked', {
				instanceId: instance.id,
				instanceName: instance.name,
				status,
				indexersChecked: indexerHealth.length,
				rateLimitedCount
			});

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

			logger.error('Prowlarr health check failed', {
				instanceId: instance.id,
				instanceName: instance.name,
				status,
				error: errorMessage
			});

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

	// Returns cached data even if stale for display purposes
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

	getCheckIntervalMs(): number {
		return this.checkIntervalMs;
	}

	getStaleThresholdMs(): number {
		return this.staleThresholdMs;
	}

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

export const prowlarrHealthMonitor = new ProwlarrHealthMonitor();
