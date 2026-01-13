<script lang="ts">
import LibraryBigIcon from '@lucide/svelte/icons/library-big';
import MinusIcon from '@lucide/svelte/icons/minus';
import TrendingDownIcon from '@lucide/svelte/icons/trending-down';
import TrendingUpIcon from '@lucide/svelte/icons/trending-up';
import { Badge } from '$lib/components/ui/badge';
import * as Card from '$lib/components/ui/card';
import type { SerializedCompletionDataPoint, SerializedConnectorCompletion } from './types';

interface Props {
	completionData: SerializedConnectorCompletion[];
	class?: string;
}

let { completionData, class: className = '' }: Props = $props();

const typeColors: Record<string, { bg: string; text: string; border: string }> = {
	sonarr: {
		bg: 'bg-blue-500',
		text: 'text-blue-600 dark:text-blue-400',
		border: 'border-blue-500/20'
	},
	radarr: {
		bg: 'bg-orange-500',
		text: 'text-orange-600 dark:text-orange-400',
		border: 'border-orange-500/20'
	},
	whisparr: {
		bg: 'bg-purple-500',
		text: 'text-purple-600 dark:text-purple-400',
		border: 'border-purple-500/20'
	}
};

function getCompletionColor(percentage: number): string {
	if (percentage >= 90) return 'text-green-600 dark:text-green-400';
	if (percentage >= 70) return 'text-yellow-600 dark:text-yellow-400';
	if (percentage >= 50) return 'text-orange-600 dark:text-orange-400';
	return 'text-red-600 dark:text-red-400';
}

function getProgressBarColor(percentage: number): string {
	if (percentage >= 90) return 'bg-green-500';
	if (percentage >= 70) return 'bg-yellow-500';
	if (percentage >= 50) return 'bg-orange-500';
	return 'bg-red-500';
}

function generateSparklinePath(
	data: SerializedCompletionDataPoint[],
	width: number,
	height: number
): string {
	if (data.length < 2) return '';

	const padding = 2;
	const chartWidth = width - padding * 2;
	const chartHeight = height - padding * 2;

	const values = data.map((d) => d.completionPercentage);
	const min = Math.min(...values);
	const max = Math.max(...values);
	const range = max - min || 1;

	const points = data.map((d, i) => {
		const x = padding + (i / (data.length - 1)) * chartWidth;
		const y = padding + chartHeight - ((d.completionPercentage - min) / range) * chartHeight;
		return `${x},${y}`;
	});

	return `M ${points.join(' L ')}`;
}

function getTrendInfo(delta: number): {
	icon: typeof TrendingUpIcon;
	color: string;
	label: string;
} {
	if (delta > 0.5) {
		return { icon: TrendingUpIcon, color: 'text-green-500', label: `+${delta.toFixed(1)}%` };
	}
	if (delta < -0.5) {
		return { icon: TrendingDownIcon, color: 'text-red-500', label: `${delta.toFixed(1)}%` };
	}
	return { icon: MinusIcon, color: 'text-muted-foreground', label: 'No change' };
}

function formatType(type: string): string {
	return type.charAt(0).toUpperCase() + type.slice(1);
}

function getTypeColors(type: string): { bg: string; text: string; border: string } {
	return typeColors[type] ?? typeColors.sonarr!;
}
</script>

<Card.Root variant="glass" class={className}>
	<Card.Header>
		<Card.Title class="text-lg flex items-center gap-2">
			<LibraryBigIcon class="h-5 w-5 text-primary" />
			Library Completion
		</Card.Title>
		<Card.Description>Monitored content completion status per connector</Card.Description>
	</Card.Header>
	<Card.Content>
		{#if completionData.length === 0}
			<!-- Empty State -->
			<div class="text-center py-12 text-muted-foreground">
				<div class="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-glass/50 mb-4">
					<LibraryBigIcon class="h-8 w-8 opacity-50" />
				</div>
				<p class="font-medium">No connectors configured</p>
				<p class="text-sm mt-1 opacity-75">Add a connector to see library completion stats.</p>
			</div>
		{:else}
			<div class="space-y-4">
				{#each completionData as data (data.connectorId)}
					{@const colors = getTypeColors(data.connectorType)}
					{@const trendInfo = getTrendInfo(data.trendDelta)}

					<div class="p-4 rounded-xl border border-glass-border/30 bg-glass/30 backdrop-blur-sm transition-all duration-200 hover:bg-glass/50">
						<!-- Header: Connector name and type badge -->
						<div class="flex items-center justify-between mb-3">
							<div class="flex items-center gap-2">
								<span class="font-medium">{data.connectorName}</span>
								<Badge variant="outline" class="{colors.text} text-xs">
									{formatType(data.connectorType)}
								</Badge>
							</div>
							<span class="text-2xl font-display font-bold {getCompletionColor(data.completionPercentage)}">
								{data.completionPercentage.toFixed(1)}%
							</span>
						</div>

						<!-- Progress bar -->
						<div class="h-2 bg-muted/30 rounded-full overflow-hidden mb-3">
							<div
								class="h-full rounded-full transition-all duration-500 {getProgressBarColor(
									data.completionPercentage
								)}"
								style="width: {Math.min(data.completionPercentage, 100)}%"
							></div>
						</div>

						<!-- Stats row -->
						<div class="flex items-center justify-between text-sm">
							<div class="text-muted-foreground">
								<span class="font-medium text-foreground"
									>{data.totalDownloaded.toLocaleString()}</span
								>
								{' / '}
								<span>{data.totalMonitored.toLocaleString()}</span>
								{' monitored items'}
							</div>

							<!-- Sparkline and trend -->
							{#if data.trend.length >= 2}
								<div class="flex items-center gap-2">
									<!-- SVG Sparkline -->
									<svg width="60" height="20" class="text-muted-foreground">
										<path
											d={generateSparklinePath(data.trend, 60, 20)}
											fill="none"
											stroke="currentColor"
											stroke-width="1.5"
											stroke-linecap="round"
											stroke-linejoin="round"
											class={data.trendDelta >= 0 ? 'stroke-success' : 'stroke-destructive'}
										/>
									</svg>
									<!-- Trend indicator -->
									<div class="flex items-center gap-1 {trendInfo.color}">
										<trendInfo.icon class="h-4 w-4" />
										<span class="text-xs font-medium">{trendInfo.label}</span>
									</div>
								</div>
							{/if}
						</div>

						<!-- Breakdown (episodes vs movies if applicable) -->
						{#if data.episodesMonitored > 0 && data.moviesMonitored > 0}
							<div
								class="mt-2 pt-2 border-t border-glass-border/20 flex gap-4 text-xs text-muted-foreground"
							>
								<span> Episodes: {data.episodesDownloaded}/{data.episodesMonitored} </span>
								<span> Movies: {data.moviesDownloaded}/{data.moviesMonitored} </span>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</Card.Content>
</Card.Root>
