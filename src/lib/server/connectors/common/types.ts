export type ConnectorType = 'sonarr' | 'radarr' | 'whisparr';

export interface RetryConfig {
	maxRetries?: number;
	baseDelay?: number;
	maxDelay?: number;
	multiplier?: number;
	jitter?: boolean;
}

export interface BaseClientConfig {
	baseUrl: string;
	apiKey: string;
	timeout?: number;
	userAgent?: string;
	sslVerify?: boolean;
	retry?: RetryConfig;
}

export interface RequestOptions {
	method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
	body?: unknown;
	timeout?: number;
	signal?: AbortSignal;
}

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

export interface HealthCheck {
	source: string;
	type: 'ok' | 'notice' | 'warning' | 'error';
	message: string;
	wikiUrl?: string;
}

export interface PaginatedResponse<T> {
	page: number;
	pageSize: number;
	sortKey: string;
	sortDirection: 'ascending' | 'descending';
	totalRecords: number;
	records: T[];
}

export interface PaginationOptions {
	page?: number;
	pageSize?: number;
	sortKey?: string;
	sortDirection?: 'ascending' | 'descending';
}

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

export type CommandStatus =
	| 'queued'
	| 'started'
	| 'completed'
	| 'failed'
	| 'aborted'
	| 'cancelled'
	| 'orphaned';
