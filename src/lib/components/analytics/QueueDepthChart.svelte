<script lang="ts">
import ListTodoIcon from '@lucide/svelte/icons/list-todo';
import * as Card from '$lib/components/ui/card';
import TimeSeriesChart from './TimeSeriesChart.svelte';
import type { SerializedQueueMetrics, TimePeriod } from './types';

interface Props {
	metrics: SerializedQueueMetrics[];
	period?: TimePeriod;
	class?: string;
}

let { metrics, period = '7d', class: className = '' }: Props = $props();

// Color palette for connector types
const connectorColors: Record<string, string> = {
	sonarr: 'rgb(59, 130, 246)', // blue-500
	radarr: 'rgb(249, 115, 22)', // orange-500
	whisparr: 'rgb(168, 85, 247)' // purple-500
};

// Generate datasets from metrics
const datasets = $derived(() => {
	const result: {
		label: string;
		data: { timestamp: string; value: number }[];
		borderColor: string;
		backgroundColor?: string;
		fill?: boolean;
		borderDash?: number[];
	}[] = [];

	for (const connector of metrics) {
		const color = connectorColors[connector.connectorType] ?? 'rgb(107, 114, 128)';

		// Average queue depth (filled area)
		result.push({
			label: `${connector.connectorName} - Avg`,
			data: connector.avgQueueDepth,
			borderColor: color,
			backgroundColor: `${color}30`,
			fill: true
		});

		// Peak queue depth (dashed line)
		result.push({
			label: `${connector.connectorName} - Peak`,
			data: connector.peakQueueDepth,
			borderColor: color,
			borderDash: [5, 5]
		});
	}

	return result;
});

const hasData = $derived(metrics.length > 0 && metrics.some((m) => m.avgQueueDepth.length > 0));
</script>

<Card.Root class={className}>
	<Card.Header class="pb-2">
		<Card.Title class="text-lg">Queue Depth</Card.Title>
		<Card.Description>Average and peak queue depth over time</Card.Description>
	</Card.Header>
	<Card.Content>
		{#if hasData}
			<TimeSeriesChart datasets={datasets()} yAxisLabel="Items in Queue" {period} height={280} />
		{:else}
			<div class="flex flex-col items-center justify-center py-12 text-muted-foreground">
				<ListTodoIcon class="h-8 w-8 mb-2 opacity-50" />
				<p>No queue data available</p>
				<p class="text-sm mt-1">Data will appear after queue processing starts</p>
			</div>
		{/if}
	</Card.Content>
</Card.Root>
