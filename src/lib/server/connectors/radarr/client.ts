/**
 * Radarr API client
 *
 * Extends BaseArrClient with Radarr-specific functionality.
 * Inherits ping(), getSystemStatus(), and getHealth() from base class.
 *
 * @module connectors/radarr/client
 * @requirements 25.6
 */

import { BaseArrClient } from '../common/base-client.js';
import type { BaseClientConfig } from '../common/types.js';

/**
 * API version detection result
 */
export interface ApiVersionInfo {
	/** The full Radarr application version string (e.g., "5.2.0.8171") */
	appVersion: string;
	/** The major version number (e.g., 5) */
	majorVersion: number;
	/** The API version path to use (e.g., "v3") */
	apiVersion: string;
}

/**
 * Radarr API client for movie library management
 *
 * Provides methods for communicating with Radarr's API v3:
 * - Connection testing via ping()
 * - System status retrieval via getSystemStatus()
 * - Health check via getHealth()
 * - API version detection via detectApiVersion()
 *
 * @example
 * ```typescript
 * const client = new RadarrClient({
 *   baseUrl: 'http://localhost:7878',
 *   apiKey: 'your-api-key'
 * });
 *
 * const isReachable = await client.ping();
 * const status = await client.getSystemStatus();
 * const health = await client.getHealth();
 * const version = await client.detectApiVersion();
 * ```
 */
export class RadarrClient extends BaseArrClient {
	/**
	 * Create a new RadarrClient instance
	 *
	 * @param config - Client configuration including baseUrl and apiKey
	 */
	constructor(config: BaseClientConfig) {
		super(config);
	}

	// Inherited from BaseArrClient:
	// - ping(): Promise<boolean>
	// - getSystemStatus(): Promise<SystemStatus>
	// - getHealth(): Promise<HealthCheck[]>

	/**
	 * Detect the Radarr API version from system status
	 *
	 * Radarr versions 3, 4, and 5 all use API v3. This method provides
	 * version detection for potential future API version differences
	 * and feature compatibility checking.
	 *
	 * @returns API version information including app version and API version
	 * @throws {ArrClientError} On any API error (network, auth, rate limit, etc.)
	 * @requirements 25.6 - Support v3, v4, and v5 API versions
	 *
	 * @example
	 * ```typescript
	 * const client = new RadarrClient({ baseUrl, apiKey });
	 * const versionInfo = await client.detectApiVersion();
	 * console.log(`Radarr ${versionInfo.appVersion} using API ${versionInfo.apiVersion}`);
	 *
	 * if (versionInfo.majorVersion >= 5) {
	 *   // Use v5-specific features
	 * }
	 * ```
	 */
	async detectApiVersion(): Promise<ApiVersionInfo> {
		const status = await this.getSystemStatus();

		// Parse major version from app version (e.g., "5.2.0.8171" -> 5)
		const versionParts = status.version.split('.');
		const majorVersion = parseInt(versionParts[0] ?? '3', 10);

		// Radarr v3, v4, and v5 all currently use API v3
		// This provides forward compatibility for detecting version-specific behavior
		const apiVersion = 'v3';

		return {
			appVersion: status.version,
			majorVersion: Number.isNaN(majorVersion) ? 3 : majorVersion,
			apiVersion
		};
	}
}
