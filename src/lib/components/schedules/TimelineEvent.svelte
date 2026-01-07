<script lang="ts">
import { cn } from '$lib/utils.js';
import { ConflictIndicator } from './index';
import { formatSweepType, formatTime, type ScheduledRun, sweepTypeColors } from './types';

interface Props {
	run: ScheduledRun;
	allRuns?: ScheduledRun[];
	variant?: 'compact' | 'full';
	showTime?: boolean;
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
			'rounded-lg border p-2 text-xs transition-all duration-200 backdrop-blur-sm',
			colors.bg,
			colors.border,
			colors.bgHover,
			className
		)}
	>
		<div class="flex items-center gap-1 flex-wrap">
			{#if showTime}
				<span class="font-semibold {colors.text}">{formatTime(run.runAt)}</span>
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
			'flex items-center gap-4 rounded-xl border p-4 transition-all duration-200 backdrop-blur-sm',
			colors.bg,
			colors.border,
			colors.bgHover,
			className
		)}
	>
		<!-- Time -->
		{#if showTime}
			<div class="flex-shrink-0 w-20 text-right">
				<span class="font-semibold {colors.text}">{formatTime(run.runAt)}</span>
			</div>
		{/if}

		<!-- Content -->
		<div class="flex-1 min-w-0">
			<div class="flex items-center gap-2 flex-wrap">
				<span class="font-display font-medium truncate">{run.scheduleName}</span>
				<span
					class="inline-flex items-center rounded-lg border px-2 py-0.5 text-xs font-medium {colors.bg} {colors.text} {colors.border}"
				>
					{formatSweepType(run.sweepType)}
				</span>
				{#if hasConflicts}
					<ConflictIndicator conflictCount={run.conflictsWith.length} {conflictNames} />
				{/if}
			</div>
			<div class="text-sm text-muted-foreground mt-1">
				{connectorLabel}
			</div>
		</div>

		<!-- Link to schedule -->
		<a
			href="/schedules/{run.scheduleId}"
			class="flex-shrink-0 text-sm px-3 py-1.5 rounded-lg bg-glass/50 border border-glass-border/20 text-muted-foreground hover:text-primary hover:bg-glass/70 hover:border-primary/30 transition-all duration-200"
		>
			Details
		</a>
	</div>
{/if}
