<script lang="ts">
import SearchIcon from '@lucide/svelte/icons/search';
import * as Card from '$lib/components/ui/card';
import TimeSeriesChart from './TimeSeriesChart.svelte';
import type { SerializedSearchMetrics, TimePeriod } from './types';

interface Props {
	metrics: SerializedSearchMetrics[];
	period?: TimePeriod;
	class?: string;
}

let { metrics, period = '7d', class: className = '' }: Props = $props();

// Status colors
const statusColors = {
	dispatched: 'rgb(59, 130, 246)', // blue-500
	successful: 'rgb(34, 197, 94)', // green-500
	failed: 'rgb(239, 68, 68)', // red-500
	noResults: 'rgb(245, 158, 11)' // amber-500
};

// Aggregate metrics across all connectors for total view
const aggregatedDatasets = $derived(() => {
	if (metrics.length === 0) return [];

	// Find all unique timestamps across all connectors
	const timestampMap = new Map<
		string,
		{ dispatched: number; successful: number; failed: number; noResults: number }
	>();

	for (const connector of metrics) {
		for (const point of connector.searchesDispatched) {
			if (!timestampMap.has(point.timestamp)) {
				timestampMap.set(point.timestamp, {
					dispatched: 0,
					successful: 0,
					failed: 0,
					noResults: 0
				});
			}
			timestampMap.get(point.timestamp)!.dispatched += point.value;
		}
		for (const point of connector.searchesSuccessful) {
			if (!timestampMap.has(point.timestamp)) {
				timestampMap.set(point.timestamp, {
					dispatched: 0,
					successful: 0,
					failed: 0,
					noResults: 0
				});
			}
			timestampMap.get(point.timestamp)!.successful += point.value;
		}
		for (const point of connector.searchesFailed) {
			if (!timestampMap.has(point.timestamp)) {
				timestampMap.set(point.timestamp, {
					dispatched: 0,
					successful: 0,
					failed: 0,
					noResults: 0
				});
			}
			timestampMap.get(point.timestamp)!.failed += point.value;
		}
		for (const point of connector.searchesNoResults) {
			if (!timestampMap.has(point.timestamp)) {
				timestampMap.set(point.timestamp, {
					dispatched: 0,
					successful: 0,
					failed: 0,
					noResults: 0
				});
			}
			timestampMap.get(point.timestamp)!.noResults += point.value;
		}
	}

	// Sort by timestamp and create datasets
	const sortedEntries = Array.from(timestampMap.entries()).sort(
		([a], [b]) => new Date(a).getTime() - new Date(b).getTime()
	);

	return [
		{
			label: 'Dispatched',
			data: sortedEntries.map(([timestamp, values]) => ({ timestamp, value: values.dispatched })),
			borderColor: statusColors.dispatched
		},
		{
			label: 'Successful',
			data: sortedEntries.map(([timestamp, values]) => ({ timestamp, value: values.successful })),
			borderColor: statusColors.successful
		},
		{
			label: 'Failed',
			data: sortedEntries.map(([timestamp, values]) => ({ timestamp, value: values.failed })),
			borderColor: statusColors.failed
		},
		{
			label: 'No Results',
			data: sortedEntries.map(([timestamp, values]) => ({ timestamp, value: values.noResults })),
			borderColor: statusColors.noResults
		}
	];
});

const hasData = $derived(
	metrics.length > 0 && metrics.some((m) => m.searchesDispatched.length > 0)
);
</script>

<Card.Root class={className}>
	<Card.Header class="pb-2">
		<Card.Title class="text-lg">Search Volume</Card.Title>
		<Card.Description>Search requests dispatched and their outcomes</Card.Description>
	</Card.Header>
	<Card.Content>
		{#if hasData}
			<TimeSeriesChart
				datasets={aggregatedDatasets()}
				yAxisLabel="Searches"
				{period}
				height={280}
			/>
		{:else}
			<div class="flex flex-col items-center justify-center py-12 text-muted-foreground">
				<SearchIcon class="h-8 w-8 mb-2 opacity-50" />
				<p>No search data available</p>
				<p class="text-sm mt-1">Data will appear after searches are dispatched</p>
			</div>
		{/if}
	</Card.Content>
</Card.Root>
