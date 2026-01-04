<script lang="ts">
/**
 * Chronological List - sorted list view of upcoming sweeps grouped by day.
 */

import CalendarIcon from '@lucide/svelte/icons/calendar';
import { cn } from '$lib/utils.js';
import { TimelineEvent } from './index';
import { type DayGroup, type ScheduledRun } from './types';

interface Props {
	/** Day groups with runs */
	dayGroups: DayGroup[];
	/** All runs for conflict name lookup */
	allRuns: ScheduledRun[];
	/** Additional CSS classes */
	class?: string;
}

let { dayGroups, allRuns, class: className = '' }: Props = $props();
</script>

<div class={cn('space-y-6', className)}>
	{#if dayGroups.length === 0}
		<!-- Empty state -->
		<div class="flex flex-col items-center justify-center py-12 text-muted-foreground">
			<div class="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-muted/50 mb-4">
				<CalendarIcon class="h-6 w-6 opacity-50" />
			</div>
			<p class="text-lg font-display font-medium">No upcoming sweeps</p>
			<p class="text-sm mt-1">Enable some schedules to see them here</p>
		</div>
	{:else}
		{#each dayGroups as group, i (group.date)}
			<div class="animate-float-up" style="animation-delay: {i * 50}ms;">
				<!-- Day Header -->
				<div class="flex items-center gap-3 mb-3">
					<h3
						class={cn('text-lg font-display font-semibold', group.isToday ? 'text-primary' : 'text-foreground')}
					>
						{group.label}
					</h3>
					<span class="text-sm px-2.5 py-1 rounded-lg bg-glass/50 border border-glass-border/20 text-muted-foreground">
						{group.runs.length} sweep{group.runs.length !== 1 ? 's' : ''}
					</span>
					{#if group.runs.some((r) => r.conflictsWith.length > 0)}
						<span
							class="inline-flex items-center rounded-lg bg-amber-500/15 border border-amber-500/30 px-2.5 py-1 text-xs font-medium text-amber-500"
						>
							Has conflicts
						</span>
					{/if}
				</div>

				<!-- Runs list -->
				<div class="space-y-2">
					{#each group.runs as run (run.id)}
						<TimelineEvent {run} {allRuns} variant="full" showTime={true} />
					{/each}
				</div>
			</div>
		{/each}
	{/if}
</div>
