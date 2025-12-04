<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';
	import ArrowUpCircleIcon from '@lucide/svelte/icons/arrow-up-circle';
	import ListTodoIcon from '@lucide/svelte/icons/list-todo';
	import CheckCircle2Icon from '@lucide/svelte/icons/check-circle-2';
	import TargetIcon from '@lucide/svelte/icons/target';
	import type { ContentStatusCounts } from '$lib/server/db/queries/content';
	import type { TodaySearchStats } from '$lib/server/db/queries/queue';

	interface Props {
		contentStats: ContentStatusCounts;
		todayStats: TodaySearchStats;
		class?: string;
	}

	let { contentStats, todayStats, class: className = '' }: Props = $props();

	// Determine success rate styling based on percentage
	const successRateBgColor = $derived(() => {
		if (todayStats.completedToday === 0) return 'bg-gray-500/10';
		if (todayStats.successRate >= 70) return 'bg-green-500/10';
		if (todayStats.successRate >= 40) return 'bg-amber-500/10';
		return 'bg-red-500/10';
	});

	const successRateTextColor = $derived(() => {
		if (todayStats.completedToday === 0) return 'text-gray-600 dark:text-gray-400';
		if (todayStats.successRate >= 70) return 'text-green-600 dark:text-green-400';
		if (todayStats.successRate >= 40) return 'text-amber-600 dark:text-amber-400';
		return 'text-red-600 dark:text-red-400';
	});
</script>

<div class={className}>
	<h2 class="text-2xl font-semibold mb-4">Statistics</h2>

	<div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
		<!-- Total Gaps -->
		<Card.Root class="p-4">
			<div class="flex items-center gap-3">
				<div class="p-2 rounded-lg bg-red-500/10">
					<AlertCircleIcon class="h-5 w-5 text-red-600 dark:text-red-400" />
				</div>
				<div>
					<p class="text-2xl font-bold">{contentStats.missing}</p>
					<p class="text-sm text-muted-foreground">Total Gaps</p>
				</div>
			</div>
		</Card.Root>

		<!-- Upgrade Candidates -->
		<Card.Root class="p-4">
			<div class="flex items-center gap-3">
				<div class="p-2 rounded-lg bg-amber-500/10">
					<ArrowUpCircleIcon class="h-5 w-5 text-amber-600 dark:text-amber-400" />
				</div>
				<div>
					<p class="text-2xl font-bold">{contentStats.upgrade}</p>
					<p class="text-sm text-muted-foreground">Upgrades</p>
				</div>
			</div>
		</Card.Root>

		<!-- Queue Items -->
		<Card.Root class="p-4">
			<div class="flex items-center gap-3">
				<div class="p-2 rounded-lg bg-blue-500/10">
					<ListTodoIcon class="h-5 w-5 text-blue-600 dark:text-blue-400" />
				</div>
				<div>
					<p class="text-2xl font-bold">{contentStats.queued}</p>
					<p class="text-sm text-muted-foreground">In Queue</p>
				</div>
			</div>
		</Card.Root>

		<!-- Completed Today -->
		<Card.Root class="p-4">
			<div class="flex items-center gap-3">
				<div class="p-2 rounded-lg bg-green-500/10">
					<CheckCircle2Icon class="h-5 w-5 text-green-600 dark:text-green-400" />
				</div>
				<div>
					<p class="text-2xl font-bold">{todayStats.completedToday}</p>
					<p class="text-sm text-muted-foreground">Today</p>
				</div>
			</div>
		</Card.Root>

		<!-- Success Rate -->
		<Card.Root class="p-4">
			<div class="flex items-center gap-3">
				<div class="p-2 rounded-lg {successRateBgColor()}">
					<TargetIcon class="h-5 w-5 {successRateTextColor()}" />
				</div>
				<div>
					<p class="text-2xl font-bold">{todayStats.successRate}%</p>
					<p class="text-sm text-muted-foreground">Success</p>
				</div>
			</div>
		</Card.Root>
	</div>
</div>
