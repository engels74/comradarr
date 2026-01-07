<script lang="ts">
import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';
import * as Card from '$lib/components/ui/card';
import TimeSeriesChart from './TimeSeriesChart.svelte';
import type { SerializedDiscoveryMetrics, TimePeriod } from './types';

interface Props {
	metrics: SerializedDiscoveryMetrics[];
	period?: TimePeriod;
	class?: string;
}

let { metrics, period = '7d', class: className = '' }: Props = $props();

const connectorColors: Record<string, string> = {
	sonarr: 'rgb(59, 130, 246)',
	radarr: 'rgb(249, 115, 22)',
	whisparr: 'rgb(168, 85, 247)'
};

const datasets = $derived(() => {
	const result: {
		label: string;
		data: { timestamp: string; value: number }[];
		borderColor: string;
		borderDash?: number[];
	}[] = [];

	for (const connector of metrics) {
		const color = connectorColors[connector.connectorType] ?? 'rgb(107, 114, 128)';

		result.push({
			label: `${connector.connectorName} - Gaps`,
			data: connector.gapsDiscovered,
			borderColor: color
		});

		result.push({
			label: `${connector.connectorName} - Upgrades`,
			data: connector.upgradesDiscovered,
			borderColor: color,
			borderDash: [5, 5]
		});
	}

	return result;
});

const hasData = $derived(metrics.length > 0 && metrics.some((m) => m.gapsDiscovered.length > 0));
</script>

<Card.Root variant="glass" class={className}>
	<Card.Header class="pb-2">
		<Card.Title class="text-lg font-display">Discovery Rate</Card.Title>
		<Card.Description>Gaps and upgrade candidates discovered over time</Card.Description>
	</Card.Header>
	<Card.Content>
		{#if hasData}
			<TimeSeriesChart datasets={datasets()} yAxisLabel="Items Discovered" {period} height={280} />
		{:else}
			<div class="flex flex-col items-center justify-center py-12 text-muted-foreground">
				<div class="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-glass/50 mb-3">
					<AlertCircleIcon class="h-6 w-6 opacity-50" />
				</div>
				<p class="font-medium">No discovery data available</p>
				<p class="text-sm mt-1 opacity-75">Data will appear after discovery runs</p>
			</div>
		{/if}
	</Card.Content>
</Card.Root>
