/**
 * Schedule list page server load and actions.
 */

import { fail } from '@sveltejs/kit';
import { Cron } from 'croner';
import type {
	CalendarDay,
	DayGroup,
	ScheduledRun,
	SweepType,
	TimelineData
} from '$lib/components/schedules/types';
import { getAllConnectors } from '$lib/server/db/queries/connectors';
import {
	getAllSchedules,
	type ScheduleWithRelations,
	toggleScheduleEnabled
} from '$lib/server/db/queries/schedules';
import { createLogger } from '$lib/server/logger';
import { refreshDynamicSchedules } from '$lib/server/scheduler';
import type { Actions, PageServerLoad } from './$types';

const logger = createLogger('schedules');

const CONFLICT_THRESHOLD_MINUTES = 5;
const DAYS_TO_SHOW = 7;
const MAX_RUNS_PER_SCHEDULE = 100;

/**
 * Compute timeline data for the next 7 days.
 *
 * @param schedules - All schedules with relations
 * @returns Timeline data for calendar and list views
 */
function computeTimelineData(schedules: ScheduleWithRelations[]): TimelineData {
	const now = new Date();
	const todayMidnight = new Date(now);
	todayMidnight.setHours(0, 0, 0, 0);

	const endDate = new Date(todayMidnight);
	endDate.setDate(endDate.getDate() + DAYS_TO_SHOW);

	const allRuns: ScheduledRun[] = [];

	for (const schedule of schedules) {
		if (!schedule.enabled) continue;

		try {
			const cron = new Cron(schedule.cronExpression, { timezone: schedule.timezone });
			let nextRun = cron.nextRun();
			let runCount = 0;

			while (nextRun && nextRun < endDate && runCount < MAX_RUNS_PER_SCHEDULE) {
				allRuns.push({
					id: `${schedule.id}-${nextRun.getTime()}`,
					scheduleId: schedule.id,
					scheduleName: schedule.name,
					sweepType: schedule.sweepType as SweepType,
					runAt: nextRun.toISOString(),
					timezone: schedule.timezone,
					connector: schedule.connector,
					enabled: schedule.enabled,
					conflictsWith: []
				});

				nextRun = cron.nextRun(new Date(nextRun.getTime() + 1000));
				runCount++;
			}
		} catch (error) {
			logger.warn('Failed to parse cron for schedule', {
				scheduleId: schedule.id,
				error: error instanceof Error ? error.message : String(error)
			});
		}
	}

	allRuns.sort((a, b) => new Date(a.runAt).getTime() - new Date(b.runAt).getTime());

	let conflictCount = 0;
	for (let i = 0; i < allRuns.length; i++) {
		const runA = allRuns[i];
		if (!runA) continue;

		for (let j = i + 1; j < allRuns.length; j++) {
			const runB = allRuns[j];
			if (!runB) continue;

			const diffMs = new Date(runB.runAt).getTime() - new Date(runA.runAt).getTime();
			const diffMinutes = diffMs / (1000 * 60);

			if (diffMinutes > CONFLICT_THRESHOLD_MINUTES) break; // No more conflicts possible

			// Check if they could actually conflict (same or overlapping target)
			const couldConflict =
				runA.connector === null || // A is global
				runB.connector === null || // B is global
				runA.connector?.id === runB.connector?.id; // Same connector

			if (couldConflict) {
				// Mark both as conflicting
				if (!runA.conflictsWith.includes(runB.id)) {
					runA.conflictsWith.push(runB.id);
					conflictCount++;
				}
				if (!runB.conflictsWith.includes(runA.id)) {
					runB.conflictsWith.push(runA.id);
				}
			}
		}
	}

	const calendarDays: CalendarDay[] = [];
	for (let d = 0; d < DAYS_TO_SHOW; d++) {
		const dayStart = new Date(todayMidnight);
		dayStart.setDate(dayStart.getDate() + d);

		const dayEnd = new Date(dayStart);
		dayEnd.setDate(dayEnd.getDate() + 1);

		const dayRuns = allRuns.filter((run) => {
			const runDate = new Date(run.runAt);
			return runDate >= dayStart && runDate < dayEnd;
		});

		calendarDays.push({
			date: dayStart.toISOString(),
			dayOfWeek: dayStart.getDay(),
			isToday: d === 0,
			runs: dayRuns,
			hasConflicts: dayRuns.some((run) => run.conflictsWith.length > 0)
		});
	}

	const dayGroups: DayGroup[] = [];
	const dayFormatter = new Intl.DateTimeFormat('en-US', {
		weekday: 'long',
		month: 'short',
		day: 'numeric'
	});

	for (let i = 0; i < calendarDays.length; i++) {
		const calDay = calendarDays[i];
		if (!calDay || calDay.runs.length === 0) continue;

		let label: string;
		if (calDay.isToday) {
			label = 'Today';
		} else if (i === 1) {
			label = 'Tomorrow';
		} else {
			label = dayFormatter.format(new Date(calDay.date));
		}

		dayGroups.push({
			label,
			date: calDay.date,
			isToday: calDay.isToday,
			runs: calDay.runs
		});
	}

	return {
		calendarDays,
		dayGroups,
		totalRuns: allRuns.length,
		conflictCount,
		conflictThresholdMinutes: CONFLICT_THRESHOLD_MINUTES
	};
}

export const load: PageServerLoad = async () => {
	const [schedules, connectors] = await Promise.all([getAllSchedules(), getAllConnectors()]);
	const timeline = computeTimelineData(schedules);

	return {
		schedules,
		connectors,
		timeline
	};
};

export const actions: Actions = {
	toggle: async ({ request }) => {
		const data = await request.formData();
		const id = Number(data.get('id'));
		const enabled = data.get('enabled') === 'true';

		if (Number.isNaN(id)) {
			return fail(400, { error: 'Invalid schedule ID' });
		}

		const updated = await toggleScheduleEnabled(id, enabled);

		if (!updated) {
			return fail(404, { error: 'Schedule not found' });
		}

		await refreshDynamicSchedules();

		return { success: true };
	}
};
