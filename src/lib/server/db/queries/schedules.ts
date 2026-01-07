import { eq, isNull, or } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	connectors,
	type NewSweepSchedule,
	type SweepSchedule,
	sweepSchedules,
	throttleProfiles
} from '$lib/server/db/schema';

export type SweepType = 'incremental' | 'full_reconciliation';

export interface CreateScheduleInput {
	connectorId?: number | null; // null = global schedule
	name: string;
	sweepType: SweepType;
	cronExpression: string;
	timezone?: string;
	enabled?: boolean;
	throttleProfileId?: number | null;
}

export interface UpdateScheduleInput {
	name?: string;
	sweepType?: SweepType;
	cronExpression?: string;
	timezone?: string;
	enabled?: boolean;
	throttleProfileId?: number | null;
}

export interface ScheduleWithRelations extends SweepSchedule {
	connector: {
		id: number;
		name: string;
		type: string;
	} | null;
	throttleProfile: {
		id: number;
		name: string;
	} | null;
}

export async function getAllSchedules(): Promise<ScheduleWithRelations[]> {
	const results = await db
		.select({
			schedule: sweepSchedules,
			connector: {
				id: connectors.id,
				name: connectors.name,
				type: connectors.type
			},
			throttleProfile: {
				id: throttleProfiles.id,
				name: throttleProfiles.name
			}
		})
		.from(sweepSchedules)
		.leftJoin(connectors, eq(sweepSchedules.connectorId, connectors.id))
		.leftJoin(throttleProfiles, eq(sweepSchedules.throttleProfileId, throttleProfiles.id))
		.orderBy(sweepSchedules.name);

	return results.map((row) => ({
		...row.schedule,
		connector: row.connector?.id ? row.connector : null,
		throttleProfile: row.throttleProfile?.id ? row.throttleProfile : null
	}));
}

export async function getScheduleById(id: number): Promise<ScheduleWithRelations | null> {
	const results = await db
		.select({
			schedule: sweepSchedules,
			connector: {
				id: connectors.id,
				name: connectors.name,
				type: connectors.type
			},
			throttleProfile: {
				id: throttleProfiles.id,
				name: throttleProfiles.name
			}
		})
		.from(sweepSchedules)
		.leftJoin(connectors, eq(sweepSchedules.connectorId, connectors.id))
		.leftJoin(throttleProfiles, eq(sweepSchedules.throttleProfileId, throttleProfiles.id))
		.where(eq(sweepSchedules.id, id))
		.limit(1);

	if (results.length === 0) return null;

	const row = results[0]!;
	return {
		...row.schedule,
		connector: row.connector?.id ? row.connector : null,
		throttleProfile: row.throttleProfile?.id ? row.throttleProfile : null
	};
}

export async function getSchedulesForConnector(connectorId: number): Promise<SweepSchedule[]> {
	return db
		.select()
		.from(sweepSchedules)
		.where(or(eq(sweepSchedules.connectorId, connectorId), isNull(sweepSchedules.connectorId)))
		.orderBy(sweepSchedules.name);
}

export async function getEnabledSchedules(): Promise<ScheduleWithRelations[]> {
	const results = await db
		.select({
			schedule: sweepSchedules,
			connector: {
				id: connectors.id,
				name: connectors.name,
				type: connectors.type
			},
			throttleProfile: {
				id: throttleProfiles.id,
				name: throttleProfiles.name
			}
		})
		.from(sweepSchedules)
		.leftJoin(connectors, eq(sweepSchedules.connectorId, connectors.id))
		.leftJoin(throttleProfiles, eq(sweepSchedules.throttleProfileId, throttleProfiles.id))
		.where(eq(sweepSchedules.enabled, true))
		.orderBy(sweepSchedules.id);

	return results.map((row) => ({
		...row.schedule,
		connector: row.connector?.id ? row.connector : null,
		throttleProfile: row.throttleProfile?.id ? row.throttleProfile : null
	}));
}

export async function createSchedule(input: CreateScheduleInput): Promise<SweepSchedule> {
	const result = await db
		.insert(sweepSchedules)
		.values({
			connectorId: input.connectorId ?? null,
			name: input.name,
			sweepType: input.sweepType,
			cronExpression: input.cronExpression,
			timezone: input.timezone ?? 'UTC',
			enabled: input.enabled ?? true,
			throttleProfileId: input.throttleProfileId ?? null
		})
		.returning();

	return result[0]!;
}

export async function updateSchedule(
	id: number,
	input: UpdateScheduleInput
): Promise<SweepSchedule | null> {
	const updateData: Partial<NewSweepSchedule> & { updatedAt: Date } = {
		updatedAt: new Date()
	};

	if (input.name !== undefined) updateData.name = input.name;
	if (input.sweepType !== undefined) updateData.sweepType = input.sweepType;
	if (input.cronExpression !== undefined) updateData.cronExpression = input.cronExpression;
	if (input.timezone !== undefined) updateData.timezone = input.timezone;
	if (input.enabled !== undefined) updateData.enabled = input.enabled;
	if (input.throttleProfileId !== undefined) updateData.throttleProfileId = input.throttleProfileId;

	const result = await db
		.update(sweepSchedules)
		.set(updateData)
		.where(eq(sweepSchedules.id, id))
		.returning();

	return result[0] ?? null;
}

export async function deleteSchedule(id: number): Promise<boolean> {
	const result = await db
		.delete(sweepSchedules)
		.where(eq(sweepSchedules.id, id))
		.returning({ id: sweepSchedules.id });

	return result.length > 0;
}

export async function toggleScheduleEnabled(
	id: number,
	enabled: boolean
): Promise<SweepSchedule | null> {
	const result = await db
		.update(sweepSchedules)
		.set({ enabled, updatedAt: new Date() })
		.where(eq(sweepSchedules.id, id))
		.returning();

	return result[0] ?? null;
}

export async function updateNextRunAt(id: number, nextRunAt: Date): Promise<void> {
	await db
		.update(sweepSchedules)
		.set({ nextRunAt, updatedAt: new Date() })
		.where(eq(sweepSchedules.id, id));
}

export async function updateLastRunAt(id: number, lastRunAt: Date): Promise<void> {
	await db
		.update(sweepSchedules)
		.set({ lastRunAt, updatedAt: new Date() })
		.where(eq(sweepSchedules.id, id));
}

export async function updateScheduleRunTimes(
	id: number,
	lastRunAt: Date,
	nextRunAt: Date
): Promise<void> {
	await db
		.update(sweepSchedules)
		.set({ lastRunAt, nextRunAt, updatedAt: new Date() })
		.where(eq(sweepSchedules.id, id));
}
