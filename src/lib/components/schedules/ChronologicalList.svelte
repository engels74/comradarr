<script lang="ts">
	/**
	 * Chronological List - sorted list view of upcoming sweeps grouped by day.
	 */
	import { cn } from '$lib/utils.js';
	import { TimelineEvent } from './index';
	import { type DayGroup, type ScheduledRun } from './types';
	import CalendarIcon from '@lucide/svelte/icons/calendar';

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
			<CalendarIcon class="h-12 w-12 mb-4 opacity-50" />
			<p class="text-lg font-medium">No upcoming sweeps</p>
			<p class="text-sm mt-1">Enable some schedules to see them here</p>
		</div>
	{:else}
		{#each dayGroups as group (group.date)}
			<div>
				<!-- Day Header -->
				<div class="flex items-center gap-3 mb-3">
					<h3
						class={cn('text-lg font-semibold', group.isToday ? 'text-primary' : 'text-foreground')}
					>
						{group.label}
					</h3>
					<span class="text-sm text-muted-foreground">
						{group.runs.length} sweep{group.runs.length !== 1 ? 's' : ''}
					</span>
					{#if group.runs.some((r) => r.conflictsWith.length > 0)}
						<span
							class="inline-flex items-center rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400"
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
