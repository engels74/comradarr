/**
 * Database queries for sweep schedule operations.
 *
 *
 * Sweep schedules allow per-connector configuration of cron-based
 * sweep cycles for gap and upgrade discovery.
 */

import { db } from '$lib/server/db';
import {
	sweepSchedules,
	connectors,
	throttleProfiles,
	type SweepSchedule,
	type NewSweepSchedule
} from '$lib/server/db/schema';
import { eq, isNull, or } from 'drizzle-orm';

// =============================================================================
// Types
// =============================================================================

/**
 * Supported sweep types.
 */
export type SweepType = 'incremental' | 'full_reconciliation';

/**
 * Input for creating a new sweep schedule.
 */
export interface CreateScheduleInput {
	connectorId?: number | null; // null = global schedule
	name: string;
	sweepType: SweepType;
	cronExpression: string;
	timezone?: string;
	enabled?: boolean;
	throttleProfileId?: number | null;
}

/**
 * Input for updating an existing sweep schedule.
 */
export interface UpdateScheduleInput {
	name?: string;
	sweepType?: SweepType;
	cronExpression?: string;
	timezone?: string;
	enabled?: boolean;
	throttleProfileId?: number | null;
}

/**
 * Schedule with joined connector and throttle profile info.
 */
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

// =============================================================================
// Query Functions
// =============================================================================

/**
 * Gets all sweep schedules with related connector and throttle profile data.
 *
 * @returns Array of all schedules with relations
 */
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

/**
 * Gets a schedule by ID with relations.
 *
 * @param id - Schedule ID
 * @returns Schedule with relations if found, null otherwise
 */
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

/**
 * Gets all schedules for a specific connector (including global schedules).
 *
 * @param connectorId - Connector ID
 * @returns Array of schedules that apply to the connector
 */
export async function getSchedulesForConnector(connectorId: number): Promise<SweepSchedule[]> {
	return db
		.select()
		.from(sweepSchedules)
		.where(or(eq(sweepSchedules.connectorId, connectorId), isNull(sweepSchedules.connectorId)))
		.orderBy(sweepSchedules.name);
}

/**
 * Gets all enabled schedules (for scheduler initialization).
 *
 * @returns Array of enabled schedules with relations
 */
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

/**
 * Creates a new sweep schedule.
 *
 * @param input - Schedule data
 * @returns Created schedule
 */
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

/**
 * Updates an existing sweep schedule.
 *
 * @param id - Schedule ID to update
 * @param input - Fields to update
 * @returns Updated schedule, or null if not found
 */
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

/**
 * Deletes a sweep schedule.
 *
 * @param id - Schedule ID to delete
 * @returns true if deleted, false if not found
 */
export async function deleteSchedule(id: number): Promise<boolean> {
	const result = await db
		.delete(sweepSchedules)
		.where(eq(sweepSchedules.id, id))
		.returning({ id: sweepSchedules.id });

	return result.length > 0;
}

/**
 * Toggles schedule enabled status.
 *
 * @param id - Schedule ID
 * @param enabled - New enabled status
 * @returns Updated schedule, or null if not found
 */
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

/**
 * Updates the next run time for a schedule.
 * Called by scheduler after job registration.
 *
 * @param id - Schedule ID
 * @param nextRunAt - Next scheduled run time
 */
export async function updateNextRunAt(id: number, nextRunAt: Date): Promise<void> {
	await db
		.update(sweepSchedules)
		.set({ nextRunAt, updatedAt: new Date() })
		.where(eq(sweepSchedules.id, id));
}

/**
 * Updates the last run time for a schedule.
 * Called by scheduler when job executes.
 *
 * @param id - Schedule ID
 * @param lastRunAt - Time the job ran
 */
export async function updateLastRunAt(id: number, lastRunAt: Date): Promise<void> {
	await db
		.update(sweepSchedules)
		.set({ lastRunAt, updatedAt: new Date() })
		.where(eq(sweepSchedules.id, id));
}

/**
 * Updates both last run and next run times for a schedule.
 * Convenience function for post-job updates.
 *
 * @param id - Schedule ID
 * @param lastRunAt - Time the job ran
 * @param nextRunAt - Next scheduled run time
 */
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
