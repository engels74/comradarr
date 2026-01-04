<script lang="ts">
/**
 * Timeline Event - reusable event block for calendar and list views.
 */
import { cn } from '$lib/utils.js';
import { ConflictIndicator } from './index';
import { formatSweepType, formatTime, type ScheduledRun, sweepTypeColors } from './types';

interface Props {
	/** The scheduled run to display */
	run: ScheduledRun;
	/** All runs (for looking up conflict names) */
	allRuns?: ScheduledRun[];
	/** Display variant */
	variant?: 'compact' | 'full';
	/** Show time */
	showTime?: boolean;
	/** Additional CSS classes */
	class?: string;
}

let {
	run,
	allRuns = [],
	variant = 'compact',
	showTime = true,
	class: className = ''
}: Props = $props();

const colors = $derived(sweepTypeColors[run.sweepType]);
const hasConflicts = $derived(run.conflictsWith.length > 0);

// Get names of conflicting schedules
const conflictNames = $derived(
	run.conflictsWith
		.map((id) => {
			const conflictRun = allRuns.find((r) => r.id === id);
			return conflictRun?.scheduleName;
		})
		.filter((name): name is string => name !== undefined)
);

const connectorLabel = $derived(run.connector?.name ?? 'All Connectors');
</script>

{#if variant === 'compact'}
	<!-- Compact variant for calendar view -->
	<div
		class={cn(
			'rounded-md border p-1.5 text-xs transition-colors',
			colors.bg,
			colors.border,
			colors.bgHover,
			className
		)}
	>
		<div class="flex items-center gap-1 flex-wrap">
			{#if showTime}
				<span class="font-medium {colors.text}">{formatTime(run.runAt)}</span>
			{/if}
			{#if hasConflicts}
				<ConflictIndicator conflictCount={run.conflictsWith.length} {conflictNames} />
			{/if}
		</div>
		<div class="truncate text-muted-foreground mt-0.5" title={run.scheduleName}>
			{run.scheduleName}
		</div>
		<div class="truncate text-muted-foreground/70 text-[10px]" title={connectorLabel}>
			{connectorLabel}
		</div>
	</div>
{:else}
	<!-- Full variant for list view -->
	<div
		class={cn(
			'flex items-center gap-3 rounded-lg border p-3 transition-colors',
			colors.bg,
			colors.border,
			colors.bgHover,
			className
		)}
	>
		<!-- Time -->
		{#if showTime}
			<div class="flex-shrink-0 w-20 text-right">
				<span class="font-medium {colors.text}">{formatTime(run.runAt)}</span>
			</div>
		{/if}

		<!-- Content -->
		<div class="flex-1 min-w-0">
			<div class="flex items-center gap-2 flex-wrap">
				<span class="font-medium truncate">{run.scheduleName}</span>
				<span
					class="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium {colors.bg} {colors.text}"
				>
					{formatSweepType(run.sweepType)}
				</span>
				{#if hasConflicts}
					<ConflictIndicator conflictCount={run.conflictsWith.length} {conflictNames} />
				{/if}
			</div>
			<div class="text-sm text-muted-foreground mt-0.5">
				{connectorLabel}
			</div>
		</div>

		<!-- Link to schedule -->
		<a
			href="/schedules/{run.scheduleId}"
			class="flex-shrink-0 text-sm text-muted-foreground hover:text-primary transition-colors"
		>
			Details
		</a>
	</div>
{/if}
