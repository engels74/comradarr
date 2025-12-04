<script lang="ts">
	/**
	 * Weekly Calendar - 7-day grid view of scheduled sweeps.
	 * Requirements: 19.4 - Display calendar view of upcoming sweeps
	 */
	import { cn } from '$lib/utils.js';
	import { TimelineEvent } from './index';
	import {
		type CalendarDay,
		type ScheduledRun,
		getShortDayName,
		formatCalendarDate
	} from './types';
	import CalendarIcon from '@lucide/svelte/icons/calendar';

	interface Props {
		/** Calendar days data from server */
		calendarDays: CalendarDay[];
		/** All runs for conflict name lookup */
		allRuns: ScheduledRun[];
		/** Additional CSS classes */
		class?: string;
	}

	let { calendarDays, allRuns, class: className = '' }: Props = $props();
</script>

<div class={cn('', className)}>
	<!-- Calendar Grid -->
	<div class="grid grid-cols-7 gap-2">
		{#each calendarDays as day (day.date)}
			<div
				class={cn(
					'min-h-48 rounded-lg border p-2 flex flex-col',
					day.isToday ? 'border-primary bg-primary/5' : 'border-border bg-card',
					day.hasConflicts ? 'ring-2 ring-amber-500/20' : ''
				)}
			>
				<!-- Day Header -->
				<div class="flex items-center justify-between mb-2 pb-2 border-b border-border/50">
					<div class="flex items-center gap-1.5">
						<span
							class={cn(
								'text-sm font-medium',
								day.isToday ? 'text-primary' : 'text-muted-foreground'
							)}
						>
							{getShortDayName(day.dayOfWeek)}
						</span>
						{#if day.isToday}
							<span
								class="inline-flex items-center rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground"
							>
								Today
							</span>
						{/if}
					</div>
					<span class="text-xs text-muted-foreground">{formatCalendarDate(day.date)}</span>
				</div>

				<!-- Events -->
				<div class="flex-1 space-y-1.5 overflow-y-auto">
					{#if day.runs.length === 0}
						<div class="flex flex-col items-center justify-center h-full text-muted-foreground/50">
							<CalendarIcon class="h-6 w-6 mb-1" />
							<span class="text-xs">No sweeps</span>
						</div>
					{:else}
						{#each day.runs as run (run.id)}
							<TimelineEvent {run} {allRuns} variant="compact" showTime={true} />
						{/each}
					{/if}
				</div>

				<!-- Day Footer with count -->
				{#if day.runs.length > 0}
					<div class="mt-2 pt-2 border-t border-border/50 text-xs text-muted-foreground">
						{day.runs.length} sweep{day.runs.length !== 1 ? 's' : ''}
					</div>
				{/if}
			</div>
		{/each}
	</div>
</div>
