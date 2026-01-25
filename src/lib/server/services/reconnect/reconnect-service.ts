import {
	AuthenticationError,
	NetworkError,
	TimeoutError
} from '$lib/server/connectors/common/errors';
import { createConnectorClient } from '$lib/server/connectors/factory';
import {
	getConnector,
	getDecryptedApiKey,
	updateConnectorHealth
} from '$lib/server/db/queries/connectors';
import {
	type ConnectorWithReconnectState,
	ensureSyncStateExists,
	getConnectorsDueForReconnect,
	getReconnectState,
	incrementReconnectAttempts,
	initializeReconnectState,
	pauseReconnect,
	type ReconnectState,
	resetReconnectState,
	resumeReconnect,
	updateReconnectState
} from '$lib/server/db/queries/reconnect';
import type { Connector } from '$lib/server/db/schema';
import { createLogger } from '$lib/server/logger';
import {
	determineHealthFromChecks,
	type HealthStatus
} from '$lib/server/services/sync/health-utils';
import { RECONNECT_CONFIG } from './config';

const logger = createLogger('reconnect-service');

export interface ReconnectResult {
	success: boolean;
	connectorId: number;
	connectorName: string;
	previousStatus: string;
	newStatus: HealthStatus;
	attemptNumber: number;
	error?: string;
	nextReconnectAt?: Date;
}

export interface ProcessReconnectionsResult {
	processed: number;
	succeeded: number;
	failed: number;
	results: ReconnectResult[];
}

export function calculateNextReconnectTime(attemptCount: number): Date {
	const delay = calculateBackoffDelay(attemptCount);
	return new Date(Date.now() + delay);
}

export function calculateBackoffDelay(attemptCount: number): number {
	const baseDelay = RECONNECT_CONFIG.BASE_DELAY_MS * RECONNECT_CONFIG.MULTIPLIER ** attemptCount;
	const cappedDelay = Math.min(baseDelay, RECONNECT_CONFIG.MAX_DELAY_MS);

	const jitterRange = cappedDelay * RECONNECT_CONFIG.JITTER;
	const jitter = (Math.random() * 2 - 1) * jitterRange;

	return Math.round(cappedDelay + jitter);
}

export async function attemptReconnect(
	connector: Connector | ConnectorWithReconnectState,
	currentAttemptCount?: number
): Promise<ReconnectResult> {
	const attemptNumber = (currentAttemptCount ?? 0) + 1;

	logger.info('Attempting reconnection', {
		connectorId: connector.id,
		connectorName: connector.name,
		attemptNumber,
		previousStatus: connector.healthStatus
	});

	try {
		const apiKey = await getDecryptedApiKey(connector);
		const client = createConnectorClient(connector, apiKey);

		const isReachable = await client.ping();

		if (!isReachable) {
			const nextReconnectAt = calculateNextReconnectTime(attemptNumber);
			await updateConnectorHealth(connector.id, 'offline');
			await incrementReconnectAttempts(
				connector.id,
				nextReconnectAt,
				'Connection failed - no response'
			);

			logger.warn('Reconnection failed - not reachable', {
				connectorId: connector.id,
				connectorName: connector.name,
				attemptNumber,
				nextReconnectAt: nextReconnectAt.toISOString()
			});

			return {
				success: false,
				connectorId: connector.id,
				connectorName: connector.name,
				previousStatus: connector.healthStatus,
				newStatus: 'offline',
				attemptNumber,
				error: 'Connection failed - no response',
				nextReconnectAt
			};
		}

		const healthChecks = await client.getHealth();
		const newStatus = determineHealthFromChecks(healthChecks);

		await updateConnectorHealth(connector.id, newStatus);
		await resetReconnectState(connector.id);

		logger.info('Reconnection successful', {
			connectorId: connector.id,
			connectorName: connector.name,
			attemptNumber,
			previousStatus: connector.healthStatus,
			newStatus
		});

		return {
			success: true,
			connectorId: connector.id,
			connectorName: connector.name,
			previousStatus: connector.healthStatus,
			newStatus,
			attemptNumber
		};
	} catch (error) {
		let errorMessage: string;
		let newStatus: HealthStatus;

		if (error instanceof AuthenticationError) {
			newStatus = 'unhealthy';
			errorMessage = 'Authentication failed - check API key';
		} else if (error instanceof NetworkError || error instanceof TimeoutError) {
			newStatus = 'offline';
			errorMessage = error.message;
		} else {
			newStatus = 'unhealthy';
			errorMessage = error instanceof Error ? error.message : 'Unknown error';
		}

		await updateConnectorHealth(connector.id, newStatus);
		const nextReconnectAt = calculateNextReconnectTime(attemptNumber);
		await incrementReconnectAttempts(connector.id, nextReconnectAt, errorMessage);

		logger.warn('Reconnection failed', {
			connectorId: connector.id,
			connectorName: connector.name,
			attemptNumber,
			error: errorMessage,
			nextReconnectAt: nextReconnectAt.toISOString()
		});

		return {
			success: false,
			connectorId: connector.id,
			connectorName: connector.name,
			previousStatus: connector.healthStatus,
			newStatus,
			attemptNumber,
			error: errorMessage,
			nextReconnectAt
		};
	}
}

export async function processReconnections(): Promise<ProcessReconnectionsResult> {
	const connectorsDue = await getConnectorsDueForReconnect();

	if (connectorsDue.length === 0) {
		return {
			processed: 0,
			succeeded: 0,
			failed: 0,
			results: []
		};
	}

	const results: ReconnectResult[] = [];
	let succeeded = 0;
	let failed = 0;

	for (const connector of connectorsDue) {
		const result = await attemptReconnect(connector, connector.reconnectAttempts);
		results.push(result);

		if (result.success) {
			succeeded++;
		} else {
			failed++;
		}
	}

	return {
		processed: connectorsDue.length,
		succeeded,
		failed,
		results
	};
}

export async function triggerManualReconnect(connectorId: number): Promise<ReconnectResult> {
	const connector = await getConnector(connectorId);

	if (!connector) {
		throw new Error(`Connector ${connectorId} not found`);
	}

	await ensureSyncStateExists(connectorId);

	await updateReconnectState(connectorId, {
		reconnectAttempts: 0,
		nextReconnectAt: null,
		reconnectStartedAt: new Date(),
		lastReconnectError: null,
		reconnectPaused: false
	});

	return attemptReconnect(connector, 0);
}

export async function initializeReconnectForOfflineConnector(connectorId: number): Promise<void> {
	await ensureSyncStateExists(connectorId);

	const currentState = await getReconnectState(connectorId);

	if (currentState && currentState.reconnectStartedAt !== null) {
		return;
	}

	const nextReconnectAt = calculateNextReconnectTime(0);
	await initializeReconnectState(connectorId, nextReconnectAt);

	logger.info('Initialized reconnect state for offline connector', {
		connectorId,
		nextReconnectAt: nextReconnectAt.toISOString()
	});
}

export async function pauseConnectorReconnect(connectorId: number): Promise<void> {
	await ensureSyncStateExists(connectorId);
	await pauseReconnect(connectorId);

	logger.info('Paused auto-reconnect', { connectorId });
}

export async function resumeConnectorReconnect(connectorId: number): Promise<void> {
	await ensureSyncStateExists(connectorId);
	const state = await getReconnectState(connectorId);
	const nextReconnectAt = calculateNextReconnectTime(state?.reconnectAttempts ?? 0);

	await resumeReconnect(connectorId, nextReconnectAt);

	logger.info('Resumed auto-reconnect', {
		connectorId,
		nextReconnectAt: nextReconnectAt.toISOString()
	});
}

export async function getConnectorReconnectState(
	connectorId: number
): Promise<ReconnectState | null> {
	return getReconnectState(connectorId);
}

export type { ReconnectState };
