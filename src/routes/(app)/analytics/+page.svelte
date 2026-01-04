<script lang="ts">
/**
 * Analytics Dashboard Page
 *
 * Displays:
 * - Time-series charts for key metrics
 * - Connector comparison table
 * - Content analysis (most searched, hardest to find, quality distribution)
 * - CSV export with date range selection
 */

import BarChart3Icon from '@lucide/svelte/icons/bar-chart-3';
import { goto } from '$app/navigation';
import { page } from '$app/stores';
import {
	AnalyticsSummaryCards,
	ConnectorComparison,
	ContentAnalysis,
	DiscoveryChart,
	ExportDialog,
	QueueDepthChart,
	SearchVolumeChart,
	TimePeriodSelector
} from '$lib/components/analytics';
import type { TimePeriod } from '$lib/components/analytics/types';
import type { PageProps } from './$types';

let { data }: PageProps = $props();

/**
 * Handles period change by updating URL.
 */
function onPeriodChange(period: TimePeriod) {
	const params = new URLSearchParams($page.url.searchParams);
	params.set('period', period);
	goto(`/analytics?${params.toString()}`);
}
</script>

<svelte:head>
	<title>Analytics - Comradarr</title>
</svelte:head>

<div class="container mx-auto p-6">
	<!-- Header with period selector and export -->
	<div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
		<div class="flex items-center gap-3">
			<div class="p-2 rounded-lg bg-primary/10">
				<BarChart3Icon class="h-6 w-6 text-primary" />
			</div>
			<div>
				<h1 class="text-3xl font-bold">Analytics</h1>
				<p class="text-muted-foreground mt-1">
					Performance metrics and insights for your library completion
				</p>
			</div>
		</div>
		<div class="flex items-center gap-2">
			<TimePeriodSelector value={data.period as TimePeriod} onchange={onPeriodChange} />
			<ExportDialog />
		</div>
	</div>

	<!-- Summary Cards -->
	<AnalyticsSummaryCards summary={data.summary} class="mb-6" />

	<!-- Time Series Charts (2-column grid on large screens) -->
	<div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
		<DiscoveryChart metrics={data.discoveryMetrics} period={data.period as TimePeriod} />
		<SearchVolumeChart metrics={data.searchMetrics} period={data.period as TimePeriod} />
	</div>

	<!-- Queue Depth (full width) -->
	<QueueDepthChart metrics={data.queueMetrics} period={data.period as TimePeriod} class="mb-6" />

	<!-- Connector Comparison -->
	<ConnectorComparison stats={data.connectorStats} class="mb-6" />

	<!-- Content Analysis (with tabs) -->
	<ContentAnalysis
		mostSearched={data.mostSearched}
		hardestToFind={data.hardestToFind}
		qualityDistribution={data.qualityDistribution}
	/>
</div>
