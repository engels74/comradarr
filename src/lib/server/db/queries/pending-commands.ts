import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	type NewPendingCommand,
	type PendingCommand,
	pendingCommands
} from '$lib/server/db/schema';

export type CommandStatus = 'queued' | 'started' | 'completed' | 'failed';

export interface CreatePendingCommandInput {
	connectorId: number;
	searchRegistryId: number;
	commandId: number;
	contentType: 'episode' | 'movie';
	contentId: number;
	searchType: 'gap' | 'upgrade';
}

export async function createPendingCommand(
	input: CreatePendingCommandInput
): Promise<PendingCommand> {
	const values: NewPendingCommand = {
		connectorId: input.connectorId,
		searchRegistryId: input.searchRegistryId,
		commandId: input.commandId,
		contentType: input.contentType,
		contentId: input.contentId,
		searchType: input.searchType,
		commandStatus: 'queued'
	};

	const result = await db.insert(pendingCommands).values(values).returning();

	return result[0]!;
}

export async function getPendingCommandsByConnector(
	connectorId: number
): Promise<PendingCommand[]> {
	return db
		.select()
		.from(pendingCommands)
		.where(and(eq(pendingCommands.connectorId, connectorId), isNull(pendingCommands.completedAt)));
}

export async function getPendingCommandsForContent(
	contentType: 'episode' | 'movie',
	contentId: number
): Promise<PendingCommand[]> {
	return db
		.select()
		.from(pendingCommands)
		.where(
			and(
				eq(pendingCommands.contentType, contentType),
				eq(pendingCommands.contentId, contentId),
				isNull(pendingCommands.fileAcquired)
			)
		)
		.orderBy(pendingCommands.dispatchedAt);
}

export async function updateCommandStatus(
	id: number,
	status: CommandStatus,
	fileAcquired?: boolean
): Promise<void> {
	const updateData: Partial<PendingCommand> = {
		commandStatus: status
	};

	if (status === 'completed' || status === 'failed') {
		updateData.completedAt = new Date();
	}

	if (fileAcquired !== undefined) {
		updateData.fileAcquired = fileAcquired;
	}

	await db.update(pendingCommands).set(updateData).where(eq(pendingCommands.id, id));
}

export async function markCommandFileAcquired(id: number): Promise<void> {
	await db
		.update(pendingCommands)
		.set({
			fileAcquired: true,
			completedAt: new Date()
		})
		.where(eq(pendingCommands.id, id));
}

export async function getOldestPendingCommandForContent(
	contentType: 'episode' | 'movie',
	contentId: number
): Promise<PendingCommand | null> {
	const result = await db
		.select()
		.from(pendingCommands)
		.where(
			and(
				eq(pendingCommands.contentType, contentType),
				eq(pendingCommands.contentId, contentId),
				isNull(pendingCommands.fileAcquired)
			)
		)
		.orderBy(pendingCommands.dispatchedAt)
		.limit(1);

	return result[0] ?? null;
}

export async function cleanupTimedOutCommands(timeoutHours: number = 24): Promise<number> {
	const cutoff = new Date(Date.now() - timeoutHours * 60 * 60 * 1000);

	const result = await db
		.update(pendingCommands)
		.set({
			commandStatus: 'failed',
			completedAt: new Date(),
			fileAcquired: false
		})
		.where(and(lt(pendingCommands.dispatchedAt, cutoff), isNull(pendingCommands.completedAt)))
		.returning({ id: pendingCommands.id });

	return result.length;
}

export async function getUncompletedCommands(connectorId: number): Promise<PendingCommand[]> {
	return db
		.select()
		.from(pendingCommands)
		.where(and(eq(pendingCommands.connectorId, connectorId), isNull(pendingCommands.completedAt)));
}

export async function getCommandsByIds(ids: number[]): Promise<PendingCommand[]> {
	if (ids.length === 0) return [];

	return db.select().from(pendingCommands).where(inArray(pendingCommands.id, ids));
}

export async function deleteCompletedCommands(retentionDays: number = 7): Promise<number> {
	const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

	const result = await db
		.delete(pendingCommands)
		.where(
			and(sql`${pendingCommands.completedAt} IS NOT NULL`, lt(pendingCommands.completedAt, cutoff))
		)
		.returning({ id: pendingCommands.id });

	return result.length;
}
