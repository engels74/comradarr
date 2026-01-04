<script lang="ts">
/**
 * Schedule Timeline - main container with calendar and list views.
 */

import AlertTriangleIcon from '@lucide/svelte/icons/alert-triangle';
import CalendarDaysIcon from '@lucide/svelte/icons/calendar-days';
import ListIcon from '@lucide/svelte/icons/list';
import * as Tabs from '$lib/components/ui/tabs';
import { cn } from '$lib/utils.js';
import { ChronologicalList, WeeklyCalendar } from './index';
import { type ScheduledRun, type TimelineData } from './types';

interface Props {
	/** Timeline data from server */
	timeline: TimelineData;
	/** Additional CSS classes */
	class?: string;
}

let { timeline, class: className = '' }: Props = $props();

// Flatten all runs for conflict lookup
const allRuns = $derived<ScheduledRun[]>(timeline.calendarDays.flatMap((day) => day.runs));

const hasConflicts = $derived(timeline.conflictCount > 0);
</script>

<div class={cn('', className)}>
	<!-- Header -->
	<div class="flex items-center justify-between mb-4">
		<div>
			<h2 class="text-xl font-semibold flex items-center gap-2">
				<CalendarDaysIcon class="h-5 w-5" />
				Upcoming Sweeps
			</h2>
			<p class="text-sm text-muted-foreground mt-1">
				7-day view of scheduled sweeps across all connectors
			</p>
		</div>

		<!-- Summary Stats -->
		<div class="flex items-center gap-4 text-sm">
			<div class="flex items-center gap-1.5">
				<span class="text-muted-foreground">Total:</span>
				<span class="font-medium">{timeline.totalRuns} sweeps</span>
			</div>
			{#if hasConflicts}
				<div
					class="flex items-center gap-1.5 px-2 py-1 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400"
				>
					<AlertTriangleIcon class="h-4 w-4" />
					<span class="font-medium"
						>{timeline.conflictCount} conflict{timeline.conflictCount !== 1 ? 's' : ''}</span
					>
				</div>
			{/if}
		</div>
	</div>

	<!-- Tabs -->
	<Tabs.Root value="calendar" class="w-full">
		<Tabs.List class="grid w-full max-w-md grid-cols-2 mb-4">
			<Tabs.Trigger value="calendar" class="flex items-center gap-2">
				<CalendarDaysIcon class="h-4 w-4" />
				Calendar
			</Tabs.Trigger>
			<Tabs.Trigger value="list" class="flex items-center gap-2">
				<ListIcon class="h-4 w-4" />
				Timeline List
			</Tabs.Trigger>
		</Tabs.List>

		<Tabs.Content value="calendar">
			<WeeklyCalendar calendarDays={timeline.calendarDays} {allRuns} />
		</Tabs.Content>

		<Tabs.Content value="list">
			<ChronologicalList dayGroups={timeline.dayGroups} {allRuns} />
		</Tabs.Content>
	</Tabs.Root>

	<!-- Footer note about conflicts -->
	{#if hasConflicts}
		<div
			class="mt-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-sm text-amber-700 dark:text-amber-300"
		>
			<div class="flex items-start gap-2">
				<AlertTriangleIcon class="h-4 w-4 mt-0.5 flex-shrink-0" />
				<div>
					<p class="font-medium">Scheduling conflicts detected</p>
					<p class="text-amber-600 dark:text-amber-400 mt-0.5">
						{timeline.conflictCount} sweep{timeline.conflictCount !== 1 ? 's are' : ' is'} scheduled within
						{timeline.conflictThresholdMinutes} minutes of each other. Consider adjusting your schedules
						to avoid potential indexer overload.
					</p>
				</div>
			</div>
		</div>
	{/if}
</div>
