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

interface PipelineSegment {
	key: keyof StatusCounts;
	label: string;
	count: number;
	percent: number;
	bgColor: string;
	borderColor: string;
	dotColor: string;
	textColor: string;
	pulsing: boolean;
}

const segments: PipelineSegment[] = $derived.by(() => {
	if (total === 0) return [];

	const segmentConfigs = [
		{
			key: 'pending' as const,
			label: 'scheduled',
			count: statusCounts.pending,
			bgColor: 'bg-muted/30',
			borderColor: 'border-l-muted-foreground',
			dotColor: 'bg-muted-foreground',
			textColor: 'text-muted-foreground',
			pulsing: false
		},
		{
			key: 'queued' as const,
			label: 'waiting',
			count: statusCounts.queued,
			bgColor: 'bg-primary/20',
			borderColor: 'border-l-primary',
			dotColor: 'bg-primary',
			textColor: 'text-primary',
			pulsing: false
		},
		{
			key: 'searching' as const,
			label: 'searching',
			count: statusCounts.searching,
			bgColor: 'bg-yellow-500/20',
			borderColor: 'border-l-yellow-500',
			dotColor: 'bg-yellow-500',
			textColor: 'text-yellow-600 dark:text-yellow-400',
			pulsing: true
		},
		{
			key: 'cooldown' as const,
			label: 'retry',
			count: statusCounts.cooldown,
			bgColor: 'bg-orange-500/20',
			borderColor: 'border-l-orange-500',
			dotColor: 'bg-orange-500',
			textColor: 'text-orange-600 dark:text-orange-400',
			pulsing: false
		},
		{
			key: 'exhausted' as const,
			label: 'no results',
			count: statusCounts.exhausted,
			bgColor: 'bg-destructive/20',
			borderColor: 'border-l-destructive',
			dotColor: 'bg-destructive',
			textColor: 'text-destructive',
			pulsing: false
		}
	];

	return segmentConfigs
		.filter((s) => s.count > 0)
		.map((s) => ({
			...s,
			percent: Math.max((s.count / total) * 100, 2)
		}));
});

const visibleStates = $derived(segments.filter((s) => s.count > 0));

const currentFilter = $derived($page.url.searchParams.get('state') ?? 'all');

function filterByState(state: keyof StatusCounts | 'all') {
	const params = new URLSearchParams($page.url.searchParams);
	if (state === 'all') {
		params.delete('state');
	} else {
		params.set('state', state);
	}
	params.delete('page');
	goto(`/queue?${params.toString()}`);
}
</script>

{#if total > 0}
	<div class={cn('glass-panel p-4', className)} {style}>
		<div class="flex items-center justify-between mb-3">
			<h3 class="text-sm font-medium text-muted-foreground">Queue Pipeline</h3>
			<span class="text-sm font-mono tabular-nums">{total.toLocaleString()} total</span>
		</div>

		<!-- Segmented bar -->
		<div class="h-3 rounded-full overflow-hidden flex bg-muted/20">
			{#each segments as segment, i (segment.key)}
				<button
					type="button"
					class={cn(
						'h-full transition-all duration-300 relative group border-l-2',
						segment.bgColor,
						segment.borderColor,
						segment.pulsing && 'animate-pulse',
						currentFilter === segment.key && 'ring-1 ring-inset ring-foreground/20',
						i === 0 && 'rounded-l-full border-l-0',
						i === segments.length - 1 && 'rounded-r-full'
					)}
					style="width: {segment.percent}%"
					onclick={() => filterByState(segment.key)}
					title="{segment.count} {segment.label}"
				>
					<!-- Hover overlay -->
					<div
						class={cn(
							'absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-150',
							segment.bgColor.replace('/20', '/40').replace('/30', '/50')
						)}
					></div>
				</button>
			{/each}
		</div>

		<!-- Legend -->
		<div class="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3">
			{#each visibleStates as state (state.key)}
				<button
					type="button"
					class={cn(
						'inline-flex items-center gap-1.5 text-sm transition-colors rounded-md px-1.5 py-0.5 -mx-1.5',
						'hover:bg-muted/50',
						currentFilter === state.key && 'bg-muted/50 underline underline-offset-4'
					)}
					onclick={() => filterByState(currentFilter === state.key ? 'all' : state.key)}
				>
					<span
						class={cn('h-2 w-2 rounded-full flex-shrink-0', state.dotColor, state.pulsing && 'animate-pulse')}
					></span>
					<span class={cn('font-medium tabular-nums', state.textColor)}>
						{state.count}
					</span>
					<span class="text-muted-foreground">{state.label}</span>
				</button>
			{/each}
		</div>
	</div>
{/if}
