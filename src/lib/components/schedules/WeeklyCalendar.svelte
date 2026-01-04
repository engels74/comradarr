<script lang="ts">
/**
 * Weekly Calendar - 7-day grid view of scheduled sweeps.
 */

import CalendarIcon from '@lucide/svelte/icons/calendar';
import { cn } from '$lib/utils.js';
import { TimelineEvent } from './index';
import { type CalendarDay, formatCalendarDate, getShortDayName, type ScheduledRun } from './types';

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
	<div class="grid grid-cols-7 gap-3">
		{#each calendarDays as day, i (day.date)}
			<div
				class={cn(
					'min-h-48 rounded-xl border p-3 flex flex-col backdrop-blur-sm transition-all duration-200 animate-float-up',
					day.isToday
						? 'border-primary/50 bg-primary/10 shadow-[0_0_20px_oklch(var(--primary)/0.15)]'
						: 'border-glass-border/30 bg-glass/40 hover:bg-glass/60',
					day.hasConflicts ? 'ring-2 ring-amber-500/30' : ''
				)}
				style="animation-delay: {i * 30}ms;"
			>
				<!-- Day Header -->
				<div class="flex items-center justify-between mb-3 pb-2 border-b border-glass-border/20">
					<div class="flex items-center gap-1.5">
						<span
							class={cn(
								'text-sm font-semibold',
								day.isToday ? 'text-primary' : 'text-muted-foreground'
							)}
						>
							{getShortDayName(day.dayOfWeek)}
						</span>
						{#if day.isToday}
							<span
								class="inline-flex items-center rounded-full bg-primary/20 border border-primary/40 px-2 py-0.5 text-[10px] font-medium text-primary"
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
						<div class="flex flex-col items-center justify-center h-full text-muted-foreground/40">
							<CalendarIcon class="h-5 w-5 mb-1" />
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
					<div class="mt-2 pt-2 border-t border-glass-border/20 text-xs text-muted-foreground">
						{day.runs.length} sweep{day.runs.length !== 1 ? 's' : ''}
					</div>
				{/if}
			</div>
		{/each}
	</div>
</div>
