/**
 * Common types for *arr API clients
 *
 * @module connectors/common/types
 * @requirements 23.1, 23.2
 */

/**
 * Supported *arr application types
 */
export type ConnectorType = 'sonarr' | 'radarr' | 'whisparr';

/**
 * Configuration for BaseArrClient
 */
export interface BaseClientConfig {
	/** Base URL of the *arr application (e.g., http://localhost:8989) */
	baseUrl: string;

	/** API key for authentication (already decrypted) */
	apiKey: string;

	/** Request timeout in milliseconds (default: 30000) */
	timeout?: number;

	/** User-Agent header value (default: 'Comradarr/1.0') */
	userAgent?: string;
}

/**
 * Options for individual API requests
 */
export interface RequestOptions {
	/** HTTP method (default: 'GET') */
	method?: 'GET' | 'POST' | 'PUT' | 'DELETE';

	/** Request body (will be JSON stringified) */
	body?: unknown;

	/** Override timeout for this request */
	timeout?: number;

	/** External abort signal to cancel request */
	signal?: AbortSignal;
}

/**
 * System status response from *arr applications
 * GET /api/v3/system/status
 */
export interface SystemStatus {
	appName: string;
	instanceName: string;
	version: string;
	buildTime: string;
	isDebug: boolean;
	isProduction: boolean;
	isAdmin: boolean;
	isUserInteractive: boolean;
	startupPath: string;
	appData: string;
	osName: string;
	osVersion: string;
	isDocker: boolean;
	isMono: boolean;
	isLinux: boolean;
	isOsx: boolean;
	isWindows: boolean;
	branch: string;
	authentication: string;
	sqliteVersion: string;
	urlBase: string;
	runtimeVersion: string;
	runtimeName: string;
	startTime: string;
	packageVersion?: string;
	packageAuthor?: string;
	packageUpdateMechanism?: string;
}

/**
 * Health check item from *arr applications
 * GET /api/v3/health
 */
export interface HealthCheck {
	source: string;
	type: 'ok' | 'notice' | 'warning' | 'error';
	message: string;
	wikiUrl?: string;
}

/**
 * Paginated response wrapper from *arr APIs
 */
export interface PaginatedResponse<T> {
	page: number;
	pageSize: number;
	sortKey: string;
	sortDirection: 'ascending' | 'descending';
	totalRecords: number;
	records: T[];
}

/**
 * Options for paginated API requests
 */
export interface PaginationOptions {
	page?: number;
	pageSize?: number;
	sortKey?: string;
	sortDirection?: 'ascending' | 'descending';
}

/**
 * Command response from *arr applications
 * POST /api/v3/command
 */
export interface CommandResponse {
	id: number;
	name: string;
	commandName: string;
	message?: string;
	body: Record<string, unknown>;
	priority: string;
	status: CommandStatus;
	queued: string;
	started?: string;
	ended?: string;
	duration?: string;
	trigger: string;
	stateChangeTime: string;
	sendUpdatesToClient: boolean;
	updateScheduledTask: boolean;
	lastExecutionTime?: string;
}

/**
 * Command execution status
 */
export type CommandStatus = 'queued' | 'started' | 'completed' | 'failed';
