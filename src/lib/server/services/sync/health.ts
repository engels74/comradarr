import { updateConnectorHealth } from '$lib/server/db/queries/connectors';
import {
	calculateSyncBackoffDelay,
	determineHealthStatus,
	type HealthStatus,
	type SyncFailureContext,
	shouldRetrySync
} from './health-utils';

// Re-export pure functions and types from health-utils
export {
	determineHealthStatus,
	shouldRetrySync,
	calculateSyncBackoffDelay,
	type HealthStatus,
	type SyncFailureContext
};

export async function updateHealthFromSyncResult(
	connectorId: number,
	success: boolean,
	consecutiveFailures: number,
	error?: unknown
): Promise<HealthStatus> {
	const newStatus = determineHealthStatus(success, consecutiveFailures, error);

	await updateConnectorHealth(connectorId, newStatus);

	return newStatus;
}
