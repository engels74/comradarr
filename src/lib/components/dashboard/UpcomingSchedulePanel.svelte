<script lang="ts">
	/**
	 * Upcoming Schedule Panel - displays next scheduled sweeps and current sweep progress.
	 * Requirements: 15.5
	 */
	import * as Card from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import CalendarClockIcon from '@lucide/svelte/icons/calendar-clock';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import DatabaseIcon from '@lucide/svelte/icons/database';
	import GaugeIcon from '@lucide/svelte/icons/gauge';
	import HeartPulseIcon from '@lucide/svelte/icons/heart-pulse';
	import TimerIcon from '@lucide/svelte/icons/timer';
	import CameraIcon from '@lucide/svelte/icons/camera';
	import type { SerializedScheduledJob } from './types';

	interface Props {
		scheduledJobs: SerializedScheduledJob[];
		class?: string;
	}

	let { scheduledJobs, class: className = '' }: Props = $props();

	/**
	 * Get an appropriate icon for each job type.
	 */
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
			default:
				return ClockIcon;
		}
	}

	/**
	 * Get color classes based on job type.
	 * Sweep jobs get more prominent colors.
	 */
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
			default:
				return {
					bg: 'bg-gray-500/10',
					text: 'text-gray-600 dark:text-gray-400',
					border: 'border-gray-500/20'
				};
		}
	}

	/**
	 * Format relative time from ISO timestamp.
	 * Returns strings like "in 8 minutes", "in 2 hours", etc.
	 */
	function formatRelativeTime(isoTimestamp: string | null): string {
		if (!isoTimestamp) return 'Not scheduled';

		const now = Date.now();
		const target = new Date(isoTimestamp).getTime();
		const diffMs = target - now;

		if (diffMs < 0) return 'Running...';

		const diffSeconds = Math.floor(diffMs / 1000);
		const diffMinutes = Math.floor(diffSeconds / 60);
		const diffHours = Math.floor(diffMinutes / 60);

		if (diffMinutes < 1) return 'in < 1 min';
		if (diffMinutes < 60) return `in ${diffMinutes} min`;
		if (diffHours < 24) {
			const mins = diffMinutes % 60;
			if (mins > 0) return `in ${diffHours}h ${mins}m`;
			return `in ${diffHours}h`;
		}
		const days = Math.floor(diffHours / 24);
		return `in ${days}d`;
	}

	/**
	 * Check if job runs soon (within 5 minutes).
	 */
	function isUpcomingSoon(isoTimestamp: string | null): boolean {
		if (!isoTimestamp) return false;
		const now = Date.now();
		const target = new Date(isoTimestamp).getTime();
		const diffMs = target - now;
		return diffMs > 0 && diffMs < 5 * 60 * 1000; // 5 minutes
	}

	// Sort jobs: running first, then by next run time
	const sortedJobs = $derived(
		[...scheduledJobs].sort((a, b) => {
			// Running jobs first
			if (a.isRunning && !b.isRunning) return -1;
			if (!a.isRunning && b.isRunning) return 1;

			// Then by next run time
			if (!a.nextRun && !b.nextRun) return 0;
			if (!a.nextRun) return 1;
			if (!b.nextRun) return -1;
			return new Date(a.nextRun).getTime() - new Date(b.nextRun).getTime();
		})
	);

	// Filter to show only sweep-related jobs prominently
	const sweepJobs = $derived(
		sortedJobs.filter(
			(job) =>
				job.name === 'incremental-sync-sweep' ||
				job.name === 'full-reconciliation' ||
				job.name === 'queue-processor'
		)
	);

	// Other background jobs
	const otherJobs = $derived(
		sortedJobs.filter(
			(job) =>
				job.name !== 'incremental-sync-sweep' &&
				job.name !== 'full-reconciliation' &&
				job.name !== 'queue-processor'
		)
	);
</script>

<div class={className}>
	<h2 class="text-2xl font-semibold mb-4 flex items-center gap-2">
		<CalendarClockIcon class="h-6 w-6" />
		Upcoming Schedules
	</h2>

	{#if scheduledJobs.length === 0}
		<!-- Empty state -->
		<Card.Root class="p-8">
			<div class="text-center text-muted-foreground">
				<CalendarClockIcon class="h-8 w-8 mx-auto mb-2 opacity-50" />
				<p>Scheduler not initialized</p>
				<p class="text-sm mt-1">Jobs will appear once the scheduler starts</p>
			</div>
		</Card.Root>
	{:else}
		<!-- Sweep Jobs (Primary) -->
		<div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
			{#each sweepJobs as job (job.name)}
				{@const colors = getJobColors(job.name)}
				{@const Icon = getJobIcon(job.name)}
				<Card.Root class="p-4 border {colors.border} transition-colors hover:border-primary/50">
					<div class="flex items-start gap-3">
						<div class="p-2 rounded-lg {colors.bg}">
							{#if job.isRunning}
								<Icon class="h-5 w-5 {colors.text} animate-spin" />
							{:else}
								<Icon class="h-5 w-5 {colors.text}" />
							{/if}
						</div>
						<div class="flex-1 min-w-0">
							<div class="flex items-center gap-2 flex-wrap">
								<p class="font-medium truncate">{job.displayName}</p>
								{#if job.isRunning}
									<Badge variant="outline" class="bg-blue-500/20 text-blue-600 dark:text-blue-400 animate-pulse">
										Running
									</Badge>
								{:else if isUpcomingSoon(job.nextRun)}
									<Badge variant="outline" class="bg-amber-500/20 text-amber-600 dark:text-amber-400">
										Soon
									</Badge>
								{/if}
							</div>
							<p class="text-sm text-muted-foreground mt-1">{job.description}</p>
							<p class="text-sm font-medium mt-2 {job.isRunning ? 'text-blue-600 dark:text-blue-400' : ''}">
								{job.isRunning ? 'Running now' : formatRelativeTime(job.nextRun)}
							</p>
						</div>
					</div>
				</Card.Root>
			{/each}
		</div>

		<!-- Other Jobs (Secondary) -->
		{#if otherJobs.length > 0}
			<div class="grid grid-cols-2 md:grid-cols-4 gap-3">
				{#each otherJobs as job (job.name)}
					{@const colors = getJobColors(job.name)}
					{@const Icon = getJobIcon(job.name)}
					<Card.Root class="p-3 border {colors.border}">
						<div class="flex items-center gap-2">
							<div class="p-1.5 rounded {colors.bg}">
								{#if job.isRunning}
									<Icon class="h-4 w-4 {colors.text} animate-spin" />
								{:else}
									<Icon class="h-4 w-4 {colors.text}" />
								{/if}
							</div>
							<div class="flex-1 min-w-0">
								<p class="text-sm font-medium truncate">{job.displayName}</p>
								<p class="text-xs text-muted-foreground">
									{job.isRunning ? 'Running' : formatRelativeTime(job.nextRun)}
								</p>
							</div>
						</div>
					</Card.Root>
				{/each}
			</div>
		{/if}
	{/if}
</div>
