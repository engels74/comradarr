<script lang="ts">
import { goto } from '$app/navigation';
import { page } from '$app/stores';
import { cn } from '$lib/utils.js';

interface StatusCounts {
	pending: number;
	queued: number;
	searching: number;
	cooldown: number;
	exhausted: number;
}

interface Props {
	statusCounts: StatusCounts;
	class?: string;
	style?: string;
}

let { statusCounts, class: className = '', style = '' }: Props = $props();

const total = $derived(
	statusCounts.pending +
		statusCounts.queued +
		statusCounts.searching +
		statusCounts.cooldown +
		statusCounts.exhausted
);

const activeCount = $derived(statusCounts.queued + statusCounts.searching);
const progressPercent = $derived(total > 0 ? (statusCounts.exhausted / total) * 100 : 0);

interface StateItem {
	key: keyof StatusCounts;
	label: string;
	count: number;
	color: string;
	hoverColor: string;
}

const states: StateItem[] = $derived([
	{
		key: 'searching',
		label: 'searching',
		count: statusCounts.searching,
		color: 'text-yellow-600 dark:text-yellow-400',
		hoverColor: 'hover:bg-yellow-500/10'
	},
	{
		key: 'queued',
		label: 'waiting',
		count: statusCounts.queued,
		color: 'text-blue-600 dark:text-blue-400',
		hoverColor: 'hover:bg-blue-500/10'
	},
	{
		key: 'cooldown',
		label: 'cooldown',
		count: statusCounts.cooldown,
		color: 'text-orange-600 dark:text-orange-400',
		hoverColor: 'hover:bg-orange-500/10'
	},
	{
		key: 'pending',
		label: 'scheduled',
		count: statusCounts.pending,
		color: 'text-gray-600 dark:text-gray-400',
		hoverColor: 'hover:bg-gray-500/10'
	},
	{
		key: 'exhausted',
		label: 'no results',
		count: statusCounts.exhausted,
		color: 'text-red-600 dark:text-red-400',
		hoverColor: 'hover:bg-red-500/10'
	}
]);

const visibleStates = $derived(states.filter((s) => s.count > 0));

function filterByState(state: keyof StatusCounts) {
	const params = new URLSearchParams($page.url.searchParams);
	params.set('state', state);
	params.delete('page');
	goto(`/queue?${params.toString()}`);
}
</script>

{#if total > 0}
	<div class={cn('glass-panel p-4', className)} {style}>
		<div class="flex flex-col sm:flex-row sm:items-center gap-4">
			<div class="flex-1">
				<div class="flex items-center justify-between text-sm mb-2">
					<span class="text-muted-foreground">Queue Progress</span>
					<span class="font-mono text-xs">
						{activeCount.toLocaleString()} active / {total.toLocaleString()} total
					</span>
				</div>
				<div class="h-2 bg-muted rounded-full overflow-hidden">
					<div
						class="h-full bg-primary transition-all duration-300"
						style="width: {progressPercent}%"
					></div>
				</div>
			</div>

			<div class="flex flex-wrap items-center gap-1 sm:gap-0.5">
				{#each visibleStates as state, i (state.key)}
					{#if i > 0}
						<span class="text-muted-foreground/50 mx-1 hidden sm:inline">|</span>
					{/if}
					<button
						type="button"
						class={cn(
							'inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-sm transition-colors',
							state.hoverColor
						)}
						onclick={() => filterByState(state.key)}
					>
						<span class={cn('font-medium tabular-nums', state.color)}>
							{state.count}
						</span>
						<span class="text-muted-foreground">{state.label}</span>
					</button>
				{/each}
			</div>
		</div>
	</div>
{/if}
