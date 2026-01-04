<script lang="ts">
import ServerIcon from '@lucide/svelte/icons/server';
import { Badge } from '$lib/components/ui/badge';
import * as Card from '$lib/components/ui/card';
import * as Table from '$lib/components/ui/table';
import type { SerializedConnectorStats } from './types';

interface Props {
	stats: SerializedConnectorStats[];
	class?: string;
}

let { stats, class: className = '' }: Props = $props();

// Connector type colors using OKLCH accent colors
const connectorTypeColors: Record<string, string> = {
	sonarr: 'bg-[oklch(var(--accent-sonarr)/0.15)] text-[oklch(var(--accent-sonarr))]',
	radarr: 'bg-[oklch(var(--accent-radarr)/0.15)] text-[oklch(var(--accent-radarr))]',
	whisparr: 'bg-[oklch(var(--accent-whisparr)/0.15)] text-[oklch(var(--accent-whisparr))]'
};

/**
 * Gets success rate color class based on percentage.
 */
function getSuccessRateColor(rate: number): string {
	if (rate >= 80) return 'text-green-600 dark:text-green-400';
	if (rate >= 50) return 'text-yellow-600 dark:text-yellow-400';
	return 'text-red-600 dark:text-red-400';
}

/**
 * Formats response time for display.
 */
function formatResponseTime(ms: number | null): string {
	if (ms === null) return '-';
	if (ms < 1000) return `${ms}ms`;
	return `${(ms / 1000).toFixed(1)}s`;
}

const hasData = $derived(stats.length > 0);
</script>

<Card.Root variant="glass" class={className}>
	<Card.Header class="pb-2">
		<Card.Title class="text-lg font-display">Connector Comparison</Card.Title>
		<Card.Description>Performance metrics across all connectors</Card.Description>
	</Card.Header>
	<Card.Content>
		{#if hasData}
			<div class="rounded-xl border border-glass-border/30 overflow-hidden">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>Connector</Table.Head>
							<Table.Head class="text-right">Searches</Table.Head>
							<Table.Head class="text-right">Success Rate</Table.Head>
							<Table.Head class="text-right">Avg Response</Table.Head>
							<Table.Head class="text-right">Errors</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each stats as connector (connector.connectorId)}
							<Table.Row>
								<Table.Cell class="font-medium">
									<div class="flex items-center gap-2">
										<span>{connector.connectorName}</span>
										<Badge
											variant="outline"
											class={connectorTypeColors[connector.connectorType] ?? ''}
										>
											{connector.connectorType}
										</Badge>
									</div>
								</Table.Cell>
								<Table.Cell class="text-right tabular-nums">
									{connector.totalSearches.toLocaleString()}
								</Table.Cell>
								<Table.Cell class="text-right tabular-nums">
									<span class={getSuccessRateColor(connector.successRate)}>
										{connector.successRate}%
									</span>
								</Table.Cell>
								<Table.Cell class="text-right tabular-nums">
									{formatResponseTime(connector.avgResponseTimeMs)}
								</Table.Cell>
								<Table.Cell class="text-right tabular-nums">
									{#if connector.errorCount > 0}
										<span class="text-red-600 dark:text-red-400">
											{connector.errorCount}
										</span>
									{:else}
										<span class="text-muted-foreground">0</span>
									{/if}
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</div>
		{:else}
			<div class="flex flex-col items-center justify-center py-12 text-muted-foreground">
				<div class="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-glass/50 mb-3">
					<ServerIcon class="h-6 w-6 opacity-50" />
				</div>
				<p class="font-medium">No connector data available</p>
				<p class="text-sm mt-1 opacity-75">Add connectors to see comparison metrics</p>
			</div>
		{/if}
	</Card.Content>
</Card.Root>
