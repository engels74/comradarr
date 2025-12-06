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
		bg: 'bg-blue-500/10',
		text: 'text-blue-600 dark:text-blue-400',
		border: 'border-blue-500/30',
		bgHover: 'hover:bg-blue-500/20'
	},
	full_reconciliation: {
		bg: 'bg-purple-500/10',
		text: 'text-purple-600 dark:text-purple-400',
		border: 'border-purple-500/30',
		bgHover: 'hover:bg-purple-500/20'
	}
};

/**
 * Conflict indicator colors.
 */
export const conflictColors = {
	bg: 'bg-amber-500/10',
	text: 'text-amber-600 dark:text-amber-400',
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
 * Format relative time (e.g., "in 5 min", "in 2 hours").
 */
export function formatRelativeTime(isoDate: string): string {
	const now = Date.now();
	const target = new Date(isoDate).getTime();
	const diffMs = target - now;

	if (diffMs < 0) return 'now';

	const diffMins = Math.floor(diffMs / 60000);
	if (diffMins < 1) return 'now';
	if (diffMins < 60) return `in ${diffMins} min`;

	const diffHours = Math.floor(diffMins / 60);
	if (diffHours < 24) return `in ${diffHours}h`;

	const diffDays = Math.floor(diffHours / 24);
	return `in ${diffDays}d`;
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
