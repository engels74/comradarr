import { and, eq, isNotNull, lte, or } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { type Connector, connectors, syncState } from '$lib/server/db/schema';

export interface ReconnectState {
	reconnectAttempts: number;
	nextReconnectAt: Date | null;
	reconnectStartedAt: Date | null;
	lastReconnectError: string | null;
	reconnectPaused: boolean;
}

export async function getReconnectState(connectorId: number): Promise<ReconnectState | null> {
	const result = await db
		.select({
			reconnectAttempts: syncState.reconnectAttempts,
			nextReconnectAt: syncState.nextReconnectAt,
			reconnectStartedAt: syncState.reconnectStartedAt,
			lastReconnectError: syncState.lastReconnectError,
			reconnectPaused: syncState.reconnectPaused
		})
		.from(syncState)
		.where(eq(syncState.connectorId, connectorId))
		.limit(1);

	return result[0] ?? null;
}

export async function updateReconnectState(
	connectorId: number,
	state: Partial<ReconnectState>
): Promise<void> {
	await db
		.update(syncState)
		.set({
			...state,
			updatedAt: new Date()
		})
		.where(eq(syncState.connectorId, connectorId));
}

export interface ConnectorWithReconnectState extends Connector {
	reconnectAttempts: number;
	nextReconnectAt: Date | null;
	reconnectStartedAt: Date | null;
	lastReconnectError: string | null;
	reconnectPaused: boolean;
}

export async function getConnectorsDueForReconnect(): Promise<ConnectorWithReconnectState[]> {
	const now = new Date();

	const result = await db
		.select({
			connector: connectors,
			reconnectAttempts: syncState.reconnectAttempts,
			nextReconnectAt: syncState.nextReconnectAt,
			reconnectStartedAt: syncState.reconnectStartedAt,
			lastReconnectError: syncState.lastReconnectError,
			reconnectPaused: syncState.reconnectPaused
		})
		.from(connectors)
		.innerJoin(syncState, eq(connectors.id, syncState.connectorId))
		.where(
			and(
				eq(connectors.enabled, true),
				or(eq(connectors.healthStatus, 'offline'), eq(connectors.healthStatus, 'unhealthy')),
				eq(syncState.reconnectPaused, false),
				isNotNull(syncState.nextReconnectAt),
				lte(syncState.nextReconnectAt, now)
			)
		);

	return result.map((row) => ({
		...row.connector,
		reconnectAttempts: row.reconnectAttempts,
		nextReconnectAt: row.nextReconnectAt,
		reconnectStartedAt: row.reconnectStartedAt,
		lastReconnectError: row.lastReconnectError,
		reconnectPaused: row.reconnectPaused
	}));
}

export async function getOfflineConnectors(): Promise<Connector[]> {
	return db
		.select()
		.from(connectors)
		.where(
			and(
				eq(connectors.enabled, true),
				or(eq(connectors.healthStatus, 'offline'), eq(connectors.healthStatus, 'unhealthy'))
			)
		);
}

export async function resetReconnectState(connectorId: number): Promise<void> {
	await db
		.update(syncState)
		.set({
			reconnectAttempts: 0,
			nextReconnectAt: null,
			reconnectStartedAt: null,
			lastReconnectError: null,
			reconnectPaused: false,
			updatedAt: new Date()
		})
		.where(eq(syncState.connectorId, connectorId));
}

export async function initializeReconnectState(
	connectorId: number,
	nextReconnectAt: Date
): Promise<void> {
	const existing = await db
		.select({ id: syncState.id })
		.from(syncState)
		.where(eq(syncState.connectorId, connectorId))
		.limit(1);

	if (existing.length === 0) {
		await db.insert(syncState).values({
			connectorId,
			reconnectAttempts: 0,
			nextReconnectAt,
			reconnectStartedAt: new Date()
		});
	} else {
		const currentState = await getReconnectState(connectorId);
		if (currentState && currentState.reconnectStartedAt === null) {
			await db
				.update(syncState)
				.set({
					reconnectAttempts: 0,
					nextReconnectAt,
					reconnectStartedAt: new Date(),
					lastReconnectError: null,
					updatedAt: new Date()
				})
				.where(eq(syncState.connectorId, connectorId));
		}
	}
}

export async function pauseReconnect(connectorId: number): Promise<void> {
	await db
		.update(syncState)
		.set({
			reconnectPaused: true,
			updatedAt: new Date()
		})
		.where(eq(syncState.connectorId, connectorId));
}

export async function resumeReconnect(connectorId: number, nextReconnectAt: Date): Promise<void> {
	await db
		.update(syncState)
		.set({
			reconnectPaused: false,
			nextReconnectAt,
			updatedAt: new Date()
		})
		.where(eq(syncState.connectorId, connectorId));
}

export async function incrementReconnectAttempts(
	connectorId: number,
	nextReconnectAt: Date,
	error?: string
): Promise<void> {
	const current = await getReconnectState(connectorId);
	const attempts = (current?.reconnectAttempts ?? 0) + 1;

	await db
		.update(syncState)
		.set({
			reconnectAttempts: attempts,
			nextReconnectAt,
			lastReconnectError: error ?? null,
			updatedAt: new Date()
		})
		.where(eq(syncState.connectorId, connectorId));
}

export async function ensureSyncStateExists(connectorId: number): Promise<void> {
	await db.insert(syncState).values({ connectorId }).onConflictDoNothing();
}
