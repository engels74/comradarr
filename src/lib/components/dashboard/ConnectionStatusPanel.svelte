<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import StatusBadge from '$lib/components/shared/StatusBadge.svelte';
	import type { Connector } from '$lib/server/db/schema';
	import type { ConnectorStats } from '$lib/server/db/queries/connectors';

	interface Props {
		connectors: Connector[];
		stats: Record<number, ConnectorStats>;
		class?: string;
	}

	let { connectors, stats, class: className = '' }: Props = $props();

	// Helper to get stats for a connector (with fallback)
	function getStatsForConnector(connectorId: number): ConnectorStats {
		return stats[connectorId] ?? { connectorId, gapsCount: 0, queueDepth: 0 };
	}

	// Compute type badge colors
	function getTypeBadgeClasses(type: string): string {
		switch (type) {
			case 'sonarr':
				return 'bg-blue-500 text-white';
			case 'radarr':
				return 'bg-orange-500 text-white';
			case 'whisparr':
				return 'bg-purple-500 text-white';
			default:
				return 'bg-gray-500 text-white';
		}
	}

	// Format connector type for display
	function formatType(type: string): string {
		return type.charAt(0).toUpperCase() + type.slice(1);
	}
</script>

<div class={className}>
	<h2 class="text-2xl font-semibold mb-4">Connector Status</h2>

	{#if connectors.length === 0}
		<!-- Empty State -->
		<Card.Root class="p-6">
			<div class="text-center text-muted-foreground">
				<p class="text-lg mb-2">No connectors configured</p>
				<p class="text-sm">Add a connector to get started monitoring your media library.</p>
			</div>
		</Card.Root>
	{:else}
		<!-- Grid of Connector Cards -->
		<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
			{#each connectors as connector (connector.id)}
				{@const connectorStats = getStatsForConnector(connector.id)}
				<Card.Root class="p-4 hover:border-primary/50 transition-colors">
					<!-- Header Row: Name and Type Badge -->
					<div class="flex items-start justify-between mb-3">
						<a
							href="/connectors/{connector.id}"
							class="text-lg font-semibold hover:text-primary transition-colors flex-1 truncate"
						>
							{connector.name}
						</a>
						<span
							class="ml-2 px-2 py-1 rounded text-xs font-medium whitespace-nowrap {getTypeBadgeClasses(
								connector.type
							)}"
						>
							{formatType(connector.type)}
						</span>
					</div>

					<!-- Status Row -->
					<div class="mb-3">
						<StatusBadge status={connector.healthStatus} />
					</div>

					<!-- Sync Info -->
					<div class="text-sm text-muted-foreground mb-3">
						{#if connector.lastSync}
							<p>
								Last sync: <span class="font-medium"
									>{new Date(connector.lastSync).toLocaleString()}</span
								>
							</p>
						{:else}
							<p class="italic">Never synced</p>
						{/if}
					</div>

					<!-- Quick Statistics -->
					<div class="flex items-center gap-4 text-sm">
						<div class="flex items-center gap-1">
							<span class="text-muted-foreground">Gaps:</span>
							<span class="font-semibold">{connectorStats.gapsCount}</span>
						</div>
						<div class="flex items-center gap-1">
							<span class="text-muted-foreground">Queued:</span>
							<span class="font-semibold">{connectorStats.queueDepth}</span>
						</div>
					</div>
				</Card.Root>
			{/each}
		</div>
	{/if}
</div>
