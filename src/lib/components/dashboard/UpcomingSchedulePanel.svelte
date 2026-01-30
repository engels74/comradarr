<script lang="ts">
import CalendarClockIcon from '@lucide/svelte/icons/calendar-clock';
import CameraIcon from '@lucide/svelte/icons/camera';
import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
import ClockIcon from '@lucide/svelte/icons/clock';
import DatabaseIcon from '@lucide/svelte/icons/database';
import GaugeIcon from '@lucide/svelte/icons/gauge';
import HeartPulseIcon from '@lucide/svelte/icons/heart-pulse';
import PlugIcon from '@lucide/svelte/icons/plug';
import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
import TimerIcon from '@lucide/svelte/icons/timer';
import { Badge } from '$lib/components/ui/badge';
import * as Card from '$lib/components/ui/card';
import type { SerializedScheduledJob } from './types';

let showOtherJobs = $state(false);

interface Props {
	scheduledJobs: SerializedScheduledJob[];
	class?: string;
}

let { scheduledJobs, class: className = '' }: Props = $props();

let now = $state(Date.now());

$effect(() => {
	const interval = setInterval(() => {
		now = Date.now();
	}, 1000);
	return () => clearInterval(interval);
});

function getJobIcon(jobName: string) {
	switch (jobName) {
		case 'incremental-sync-sweep':
			return RefreshCwIcon;
		case 'full-reconciliation':
			return DatabaseIcon;
		case 'queue-processor':
			return GaugeIcon;
		case 'connector-health-check':
		case 'prowlarr-health-check':
			return HeartPulseIcon;
		case 'throttle-window-reset':
			return TimerIcon;
		case 'completion-snapshot':
			return CameraIcon;
		case 'connector-reconnect':
			return PlugIcon;
		default:
			return ClockIcon;
	}
}

function getJobColors(jobName: string) {
	switch (jobName) {
		case 'incremental-sync-sweep':
			return {
				bg: 'bg-blue-500/10',
				text: 'text-blue-600 dark:text-blue-400',
				border: 'border-blue-500/20'
			};
		case 'full-reconciliation':
			return {
				bg: 'bg-purple-500/10',
				text: 'text-purple-600 dark:text-purple-400',
				border: 'border-purple-500/20'
			};
		case 'queue-processor':
			return {
				bg: 'bg-green-500/10',
				text: 'text-green-600 dark:text-green-400',
				border: 'border-green-500/20'
			};
		case 'connector-health-check':
		case 'prowlarr-health-check':
			return {
				bg: 'bg-amber-500/10',
				text: 'text-amber-600 dark:text-amber-400',
				border: 'border-amber-500/20'
			};
		case 'connector-reconnect':
			return {
				bg: 'bg-cyan-500/10',
				text: 'text-cyan-600 dark:text-cyan-400',
				border: 'border-cyan-500/20'
			};
		default:
			return {
				bg: 'bg-gray-500/10',
				text: 'text-gray-600 dark:text-gray-400',
				border: 'border-gray-500/20'
			};
	}
}

function formatRelativeTime(isoTimestamp: string | null, currentTime: number): string {
	if (!isoTimestamp) return 'Not scheduled';

	const target = new Date(isoTimestamp).getTime();
	const diffMs = target - currentTime;

	if (diffMs < 0) return 'Running...';

	const diffSeconds = Math.floor(diffMs / 1000);
	const diffMinutes = Math.floor(diffSeconds / 60);
	const diffHours = Math.floor(diffMinutes / 60);

	if (diffSeconds <= 0) return 'Running...';
	if (diffSeconds < 60) return `in ${diffSeconds}s`;
	if (diffMinutes < 60) return `in ${diffMinutes}m`;
	if (diffHours < 24) {
		const mins = diffMinutes % 60;
		if (mins > 0) return `in ${diffHours}h ${mins}m`;
		return `in ${diffHours}h`;
	}
	const days = Math.floor(diffHours / 24);
	return `in ${days}d`;
}

function isUpcomingSoon(isoTimestamp: string | null, currentTime: number): boolean {
	if (!isoTimestamp) return false;
	const target = new Date(isoTimestamp).getTime();
	const diffMs = target - currentTime;
	return diffMs > 0 && diffMs < 5 * 60 * 1000;
}

function shouldShowSoonBadge(job: SerializedScheduledJob, currentTime: number): boolean {
	if (!isUpcomingSoon(job.nextRun, currentTime)) return false;

	// For queue-processor, only show "Soon" if there's work to do
	if (job.name === 'queue-processor' && job.context) {
		return job.context.totalQueueDepth! > 0 && job.context.healthyConnectorCount! > 0;
	}

	return true;
}

function getQueueProcessorStatus(job: SerializedScheduledJob): string | null {
	if (job.name !== 'queue-processor' || !job.context) return null;

	const { totalQueueDepth, healthyConnectorCount } = job.context;

	if (healthyConnectorCount === 0) {
		return 'No healthy connectors';
	}

	if (totalQueueDepth === 0) {
		return 'Queue empty';
	}

	return `${totalQueueDepth} item${totalQueueDepth === 1 ? '' : 's'} queued`;
}

const sortedJobs = $derived(
	[...scheduledJobs].sort((a, b) => {
		if (a.isRunning && !b.isRunning) return -1;
		if (!a.isRunning && b.isRunning) return 1;

		if (!a.nextRun && !b.nextRun) return 0;
		if (!a.nextRun) return 1;
		if (!b.nextRun) return -1;
		return new Date(a.nextRun).getTime() - new Date(b.nextRun).getTime();
	})
);

const sweepJobs = $derived(
	sortedJobs.filter(
		(job) =>
			job.name === 'incremental-sync-sweep' ||
			job.name === 'full-reconciliation' ||
			job.name === 'queue-processor'
	)
);

const otherJobs = $derived(
	sortedJobs.filter(
		(job) =>
			job.name !== 'incremental-sync-sweep' &&
			job.name !== 'full-reconciliation' &&
			job.name !== 'queue-processor'
	)
);
</script>

<Card.Root variant="glass" class={className}>
	<Card.Header>
		<Card.Title class="text-lg flex items-center gap-2">
			<CalendarClockIcon class="h-5 w-5 text-primary" />
			Upcoming Schedules
		</Card.Title>
		<Card.Description>Background jobs and their next scheduled runs</Card.Description>
	</Card.Header>
	<Card.Content>
		{#if scheduledJobs.length === 0}
			<!-- Empty state -->
			<div class="text-center py-12 text-muted-foreground">
				<div class="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-glass/50 mb-4">
					<CalendarClockIcon class="h-8 w-8 opacity-50" />
				</div>
				<p class="font-medium">Scheduler not initialized</p>
				<p class="text-sm mt-1 opacity-75">Jobs will appear once the scheduler starts</p>
			</div>
		{:else}
			<!-- Primary Sweep Jobs -->
			<div class="space-y-3 mb-6">
				{#each sweepJobs as job (job.name)}
					{@const colors = getJobColors(job.name)}
					{@const Icon = getJobIcon(job.name)}
					<div class="p-4 rounded-xl border border-glass-border/30 bg-glass/30 backdrop-blur-sm transition-all duration-200 hover:bg-glass/50 {colors.border}">
						<div class="flex items-start gap-4">
							<div class="p-2.5 rounded-xl {colors.bg} shrink-0">
								{#if job.isRunning}
									<Icon class="h-5 w-5 {colors.text} animate-spin" />
								{:else}
									<Icon class="h-5 w-5 {colors.text}" />
								{/if}
							</div>
							<div class="flex-1 min-w-0">
								<div class="flex items-center gap-2 flex-wrap mb-1">
									<p class="font-medium">{job.displayName}</p>
									{#if job.isRunning}
										<Badge
											variant="outline"
											class="bg-blue-500/20 text-blue-600 dark:text-blue-400 animate-pulse text-xs"
										>
											Running
										</Badge>
									{:else if shouldShowSoonBadge(job, now)}
										<Badge
											variant="outline"
											class="bg-amber-500/20 text-amber-600 dark:text-amber-400 text-xs"
										>
											Soon
										</Badge>
									{/if}
								</div>
								<p class="text-sm text-muted-foreground">{job.description}</p>
								{#if getQueueProcessorStatus(job)}
									<p class="text-xs text-muted-foreground/75 mt-0.5">{getQueueProcessorStatus(job)}</p>
								{/if}
							</div>
							<div class="text-right shrink-0">
								<p class="text-sm font-semibold {job.isRunning ? 'text-blue-600 dark:text-blue-400' : 'text-foreground'}">
									{job.isRunning ? 'Running now' : formatRelativeTime(job.nextRun, now)}
								</p>
							</div>
						</div>
					</div>
				{/each}
			</div>

			<!-- Secondary Jobs - Collapsible status strip -->
			{#if otherJobs.length > 0}
				<div class="pt-4 border-t border-glass-border/20">
					<!-- Collapsible header -->
					<button
						type="button"
						onclick={() => showOtherJobs = !showOtherJobs}
						class="w-full flex items-center justify-between group cursor-pointer"
						aria-expanded={showOtherJobs}
						aria-controls="other-jobs-content"
					>
						<span class="text-xs font-medium text-muted-foreground uppercase tracking-wider">
							{otherJobs.length} Background Tasks
						</span>
						<span class="flex items-center gap-2 text-xs text-muted-foreground group-hover:text-foreground transition-colors">
							<span class="opacity-75">{showOtherJobs ? 'Hide' : 'Show'}</span>
							<ChevronDownIcon
								class="h-4 w-4 transition-transform duration-200 {showOtherJobs ? 'rotate-180' : ''}"
							/>
						</span>
					</button>

					<!-- Expandable content -->
					{#if showOtherJobs}
						<div id="other-jobs-content" class="mt-4 grid grid-cols-2 gap-2">
							{#each otherJobs as job (job.name)}
								{@const colors = getJobColors(job.name)}
								{@const Icon = getJobIcon(job.name)}
								<div
									class="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-glass/30 border border-glass-border/20 transition-all duration-200 hover:bg-glass/50 hover:border-glass-border/40"
									title={job.description}
								>
									<div class="p-1.5 rounded-lg {colors.bg} shrink-0">
										{#if job.isRunning}
											<Icon class="h-3.5 w-3.5 {colors.text} animate-spin" />
										{:else}
											<Icon class="h-3.5 w-3.5 {colors.text}" />
										{/if}
									</div>
									<div class="flex-1 min-w-0">
										<span class="text-sm font-medium truncate block">{job.displayName}</span>
									</div>
									<span class="text-xs text-muted-foreground whitespace-nowrap shrink-0">
										{job.isRunning ? 'Running...' : formatRelativeTime(job.nextRun, now)}
									</span>
								</div>
							{/each}
						</div>
					{:else}
						<!-- Collapsed preview: show running jobs or next few jobs as subtle indicators -->
						<div class="mt-3 flex items-center gap-1.5">
							{#each otherJobs.slice(0, 6) as job (job.name)}
								{@const colors = getJobColors(job.name)}
								{@const Icon = getJobIcon(job.name)}
								<div
									class="p-1.5 rounded-full {colors.bg} transition-all duration-200 hover:scale-110"
									title={`${job.displayName}: ${job.isRunning ? 'Running' : formatRelativeTime(job.nextRun, now)}`}
								>
									{#if job.isRunning}
										<Icon class="h-3 w-3 {colors.text} animate-spin" />
									{:else}
										<Icon class="h-3 w-3 {colors.text} opacity-60" />
									{/if}
								</div>
							{/each}
							{#if otherJobs.length > 6}
								<span class="text-xs text-muted-foreground ml-1">+{otherJobs.length - 6}</span>
							{/if}
						</div>
					{/if}
				</div>
			{/if}
		{/if}
	</Card.Content>
</Card.Root>
