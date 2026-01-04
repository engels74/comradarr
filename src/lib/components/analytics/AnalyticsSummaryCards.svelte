<script lang="ts">
import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';
import ArrowUpCircleIcon from '@lucide/svelte/icons/arrow-up-circle';
import CheckCircle2Icon from '@lucide/svelte/icons/check-circle-2';
import SearchIcon from '@lucide/svelte/icons/search';
import TimerIcon from '@lucide/svelte/icons/timer';
import * as Card from '$lib/components/ui/card';
import type { AnalyticsSummary } from './types';

interface Props {
	summary: AnalyticsSummary;
	class?: string;
}

let { summary, class: className = '' }: Props = $props();

/**
 * Gets success rate background color class.
 */
function getSuccessRateBg(rate: number): string {
	if (rate >= 80) return 'bg-green-500/10';
	if (rate >= 50) return 'bg-yellow-500/10';
	return 'bg-red-500/10';
}

/**
 * Formats response time for display.
 */
function formatResponseTime(ms: number | null): string {
	if (ms === null) return '-';
	if (ms < 1000) return `${ms}ms`;
	return `${(ms / 1000).toFixed(1)}s`;
}
</script>

<div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 {className}">
	<!-- Total Searches -->
	<Card.Root class="p-4">
		<div class="flex items-center gap-3">
			<div class="p-2 rounded-lg bg-blue-500/10">
				<SearchIcon class="h-5 w-5 text-blue-600 dark:text-blue-400" />
			</div>
			<div>
				<p class="text-2xl font-bold tabular-nums">{summary.totalSearches.toLocaleString()}</p>
				<p class="text-sm text-muted-foreground">Total Searches</p>
			</div>
		</div>
	</Card.Root>

	<!-- Success Rate -->
	<Card.Root class="p-4">
		<div class="flex items-center gap-3">
			<div class="p-2 rounded-lg {getSuccessRateBg(summary.successRate)}">
				<CheckCircle2Icon
					class="h-5 w-5 {summary.successRate >= 80
						? 'text-green-600 dark:text-green-400'
						: summary.successRate >= 50
							? 'text-yellow-600 dark:text-yellow-400'
							: 'text-red-600 dark:text-red-400'}"
				/>
			</div>
			<div>
				<p class="text-2xl font-bold tabular-nums">{summary.successRate}%</p>
				<p class="text-sm text-muted-foreground">Success Rate</p>
			</div>
		</div>
	</Card.Root>

	<!-- Gaps Discovered -->
	<Card.Root class="p-4">
		<div class="flex items-center gap-3">
			<div class="p-2 rounded-lg bg-amber-500/10">
				<AlertCircleIcon class="h-5 w-5 text-amber-600 dark:text-amber-400" />
			</div>
			<div>
				<p class="text-2xl font-bold tabular-nums">{summary.gapsDiscovered.toLocaleString()}</p>
				<p class="text-sm text-muted-foreground">Gaps Discovered</p>
			</div>
		</div>
	</Card.Root>

	<!-- Upgrades Discovered -->
	<Card.Root class="p-4">
		<div class="flex items-center gap-3">
			<div class="p-2 rounded-lg bg-purple-500/10">
				<ArrowUpCircleIcon class="h-5 w-5 text-purple-600 dark:text-purple-400" />
			</div>
			<div>
				<p class="text-2xl font-bold tabular-nums">{summary.upgradesDiscovered.toLocaleString()}</p>
				<p class="text-sm text-muted-foreground">Upgrades Found</p>
			</div>
		</div>
	</Card.Root>

	<!-- Avg Response Time -->
	<Card.Root class="p-4">
		<div class="flex items-center gap-3">
			<div class="p-2 rounded-lg bg-gray-500/10">
				<TimerIcon class="h-5 w-5 text-gray-600 dark:text-gray-400" />
			</div>
			<div>
				<p class="text-2xl font-bold tabular-nums">
					{formatResponseTime(summary.avgResponseTimeMs)}
				</p>
				<p class="text-sm text-muted-foreground">Avg Response</p>
			</div>
		</div>
	</Card.Root>
</div>
