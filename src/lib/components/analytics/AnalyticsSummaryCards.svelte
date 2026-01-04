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
	<Card.Root variant="glass" class="p-4 py-5 transition-all duration-300 hover:scale-[1.02]">
		<div class="flex items-center gap-3">
			<div class="p-2.5 rounded-xl bg-[oklch(var(--accent-sonarr)/0.15)]">
				<SearchIcon class="h-5 w-5 text-[oklch(var(--accent-sonarr))]" />
			</div>
			<div>
				<p class="text-2xl font-display font-bold tabular-nums">{summary.totalSearches.toLocaleString()}</p>
				<p class="text-sm text-muted-foreground">Total Searches</p>
			</div>
		</div>
	</Card.Root>

	<!-- Success Rate -->
	<Card.Root variant="glass" class="p-4 py-5 transition-all duration-300 hover:scale-[1.02]">
		<div class="flex items-center gap-3">
			<div class="p-2.5 rounded-xl {getSuccessRateBg(summary.successRate)}">
				<CheckCircle2Icon
					class="h-5 w-5 {summary.successRate >= 80
						? 'text-success'
						: summary.successRate >= 50
							? 'text-warning'
							: 'text-destructive'}"
				/>
			</div>
			<div>
				<p class="text-2xl font-display font-bold tabular-nums">{summary.successRate}%</p>
				<p class="text-sm text-muted-foreground">Success Rate</p>
			</div>
		</div>
	</Card.Root>

	<!-- Gaps Discovered -->
	<Card.Root variant="glass" class="p-4 py-5 transition-all duration-300 hover:scale-[1.02]">
		<div class="flex items-center gap-3">
			<div class="p-2.5 rounded-xl bg-warning/15">
				<AlertCircleIcon class="h-5 w-5 text-warning" />
			</div>
			<div>
				<p class="text-2xl font-display font-bold tabular-nums">{summary.gapsDiscovered.toLocaleString()}</p>
				<p class="text-sm text-muted-foreground">Gaps Discovered</p>
			</div>
		</div>
	</Card.Root>

	<!-- Upgrades Discovered -->
	<Card.Root variant="glass" class="p-4 py-5 transition-all duration-300 hover:scale-[1.02]">
		<div class="flex items-center gap-3">
			<div class="p-2.5 rounded-xl bg-[oklch(var(--accent-whisparr)/0.15)]">
				<ArrowUpCircleIcon class="h-5 w-5 text-[oklch(var(--accent-whisparr))]" />
			</div>
			<div>
				<p class="text-2xl font-display font-bold tabular-nums">{summary.upgradesDiscovered.toLocaleString()}</p>
				<p class="text-sm text-muted-foreground">Upgrades Found</p>
			</div>
		</div>
	</Card.Root>

	<!-- Avg Response Time -->
	<Card.Root variant="glass" class="p-4 py-5 transition-all duration-300 hover:scale-[1.02]">
		<div class="flex items-center gap-3">
			<div class="p-2.5 rounded-xl bg-muted/50">
				<TimerIcon class="h-5 w-5 text-muted-foreground" />
			</div>
			<div>
				<p class="text-2xl font-display font-bold tabular-nums">
					{formatResponseTime(summary.avgResponseTimeMs)}
				</p>
				<p class="text-sm text-muted-foreground">Avg Response</p>
			</div>
		</div>
	</Card.Root>
</div>
