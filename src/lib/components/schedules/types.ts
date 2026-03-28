/**
 * Type definitions for Schedule Timeline Visualization.
 */

/**
 * Sweep types with their display properties.
 */
export type SweepType = 'incremental' | 'full_reconciliation';

/**
 * A single scheduled run occurrence.
 */
export interface ScheduledRun {
	/** Unique ID: scheduleId-timestamp */
	id: string;
	/** Reference to parent schedule */
	scheduleId: number;
	/** Schedule display name */
	scheduleName: string;
	/** Sweep type */
	sweepType: SweepType;
	/** Scheduled run time (ISO string from server) */
	runAt: string;
	/** Timezone of the schedule */
	timezone: string;
	/** Connector info (null = all connectors) */
	connector: {
		id: number;
		name: string;
		type: string;
	} | null;
	/** Whether schedule is enabled */
	enabled: boolean;
	/** IDs of conflicting runs (within conflict threshold) */
	conflictsWith: string[];
}

/**
 * A day's worth of scheduled runs for calendar view.
 */
export interface CalendarDay {
	/** Date (ISO string, midnight local time) */
	date: string;
	/** Day of week (0-6, Sun-Sat) */
	dayOfWeek: number;
	/** Whether this is today */
	isToday: boolean;
	/** Scheduled runs for this day, sorted by time */
	runs: ScheduledRun[];
	/** Whether any runs have conflicts */
	hasConflicts: boolean;
}

/**
 * Grouped runs for chronological list view.
 */
export interface DayGroup {
	/** Date label (e.g., "Today", "Tomorrow", "Wednesday, Dec 4") */
	label: string;
	/** Date (ISO string, midnight) */
	date: string;
	/** Whether this is today */
	isToday: boolean;
	/** Runs sorted by time */
	runs: ScheduledRun[];
}

/**
 * Complete timeline data passed from server.
 */
export interface TimelineData {
	/** Calendar days (7 days starting from today) */
	calendarDays: CalendarDay[];
	/** Grouped runs for list view */
	dayGroups: DayGroup[];
	/** Total number of scheduled runs in the period */
	totalRuns: number;
	/** Number of conflicts detected */
	conflictCount: number;
	/** Conflict threshold in minutes */
	conflictThresholdMinutes: number;
}

/**
 * Color configuration for sweep types.
 */
export const sweepTypeColors: Record<
	SweepType,
	{
		bg: string;
		text: string;
		border: string;
		bgHover: string;
	}
> = {
	incremental: {
		bg: 'bg-blue-500/15',
		text: 'text-blue-500',
		border: 'border-blue-500/30',
		bgHover: 'hover:bg-blue-500/25'
	},
	full_reconciliation: {
		bg: 'bg-purple-500/15',
		text: 'text-purple-500',
		border: 'border-purple-500/30',
		bgHover: 'hover:bg-purple-500/25'
	}
};

/**
 * Conflict indicator colors.
 */
export const conflictColors = {
	bg: 'bg-amber-500/15',
	text: 'text-amber-500',
	border: 'border-amber-500/30',
	icon: 'text-amber-500'
};

/**
 * Format sweep type for display.
 */
export function formatSweepType(type: SweepType): string {
	return type === 'incremental' ? 'Incremental Sync' : 'Full Reconciliation';
}

/**
 * Format time for display (e.g., "3:00 AM", "12:30 PM").
 */
export function formatTime(isoDate: string): string {
	const date = new Date(isoDate);
	return date.toLocaleTimeString('en-US', {
		hour: 'numeric',
		minute: '2-digit',
		hour12: true
	});
}

/**
 * Get short day name (e.g., "Mon", "Tue").
 */
export function getShortDayName(dayOfWeek: number): string {
	const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
	return days[dayOfWeek] ?? 'Unknown';
}

/**
 * Format date for calendar header (e.g., "Dec 4").
 */
export function formatCalendarDate(isoDate: string): string {
	const date = new Date(isoDate);
	return date.toLocaleDateString('en-US', {
		month: 'short',
		day: 'numeric'
	});
}

/**
 * Get a human-readable description of a cron expression.
 */
export function getCronDescription(cron: string): string {
	if (cron === '*/15 * * * *') return 'Every 15 minutes';
	if (cron === '*/5 * * * *') return 'Every 5 minutes';
	if (cron === '*/30 * * * *') return 'Every 30 minutes';
	if (cron === '0 * * * *') return 'Every hour';
	if (cron === '0 */2 * * *') return 'Every 2 hours';
	if (cron === '0 */4 * * *') return 'Every 4 hours';
	if (cron === '0 */6 * * *') return 'Every 6 hours';
	if (cron === '0 */12 * * *') return 'Every 12 hours';
	if (cron === '0 0 * * *') return 'Daily at midnight';
	if (cron === '0 3 * * *') return 'Daily at 3:00 AM';
	if (cron === '0 4 * * *') return 'Daily at 4:00 AM';

	const dailyMatch = cron.match(/^(\d+) (\d+) \* \* \*$/);
	if (dailyMatch) {
		const [, minute, hour] = dailyMatch;
		const h = parseInt(hour!, 10);
		const m = parseInt(minute!, 10);
		const period = h >= 12 ? 'PM' : 'AM';
		const displayHour = h === 0 ? 12 : h > 12 ? h - 12 : h;
		const displayMin = m.toString().padStart(2, '0');
		return `Daily at ${displayHour}:${displayMin} ${period}`;
	}

	const minuteMatch = cron.match(/^\*\/(\d+) \* \* \* \*$/);
	if (minuteMatch) {
		return `Every ${minuteMatch[1]} minutes`;
	}

	return cron;
}
