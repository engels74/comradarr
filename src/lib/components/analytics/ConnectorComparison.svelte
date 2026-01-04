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

// Connector type colors
const connectorTypeColors: Record<string, string> = {
	sonarr: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
	radarr: 'bg-orange-500/10 text-orange-700 dark:text-orange-400',
	whisparr: 'bg-purple-500/10 text-purple-700 dark:text-purple-400'
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

<Card.Root class={className}>
	<Card.Header class="pb-2">
		<Card.Title class="text-lg">Connector Comparison</Card.Title>
		<Card.Description>Performance metrics across all connectors</Card.Description>
	</Card.Header>
	<Card.Content>
		{#if hasData}
			<div class="rounded-md border">
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
				<ServerIcon class="h-8 w-8 mb-2 opacity-50" />
				<p>No connector data available</p>
				<p class="text-sm mt-1">Add connectors to see comparison metrics</p>
			</div>
		{/if}
	</Card.Content>
</Card.Root>
