<script lang="ts">
import PlugIcon from '@lucide/svelte/icons/plug';
import StatusBadge from '$lib/components/shared/StatusBadge.svelte';
import * as Card from '$lib/components/ui/card';
import type { ConnectorStats } from '$lib/server/db/queries/connectors';
import type { Connector } from '$lib/server/db/schema';

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

// Compute type badge and glow classes
function getTypeStyles(type: string): { badge: string; glow: string; accent: string } {
	switch (type) {
		case 'sonarr':
			return {
				badge:
					'bg-[oklch(var(--accent-sonarr)/0.15)] text-[oklch(var(--accent-sonarr))] border border-[oklch(var(--accent-sonarr)/0.3)]',
				glow: 'hover:shadow-[0_0_20px_oklch(var(--accent-sonarr)/0.2)]',
				accent: 'oklch(var(--accent-sonarr))'
			};
		case 'radarr':
			return {
				badge:
					'bg-[oklch(var(--accent-radarr)/0.15)] text-[oklch(var(--accent-radarr))] border border-[oklch(var(--accent-radarr)/0.3)]',
				glow: 'hover:shadow-[0_0_20px_oklch(var(--accent-radarr)/0.2)]',
				accent: 'oklch(var(--accent-radarr))'
			};
		case 'whisparr':
			return {
				badge:
					'bg-[oklch(var(--accent-whisparr)/0.15)] text-[oklch(var(--accent-whisparr))] border border-[oklch(var(--accent-whisparr)/0.3)]',
				glow: 'hover:shadow-[0_0_20px_oklch(var(--accent-whisparr)/0.2)]',
				accent: 'oklch(var(--accent-whisparr))'
			};
		default:
			return {
				badge: 'bg-muted text-muted-foreground border border-border',
				glow: '',
				accent: 'oklch(var(--muted-foreground))'
			};
	}
}

// Format connector type for display
function formatType(type: string): string {
	return type.charAt(0).toUpperCase() + type.slice(1);
}
</script>

<div class={className}>
	<h2 class="font-display text-xl font-semibold mb-4 tracking-tight">Connector Status</h2>

	{#if connectors.length === 0}
		<!-- Empty State -->
		<Card.Root variant="glass" class="p-8">
			<div class="text-center text-muted-foreground">
				<div class="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-glass/50 mb-4">
					<PlugIcon class="h-8 w-8 opacity-50" />
				</div>
				<p class="font-medium text-lg mb-2">No connectors configured</p>
				<p class="text-sm opacity-75">Add a connector to get started monitoring your media library.</p>
			</div>
		</Card.Root>
	{:else}
		<!-- Grid of Connector Cards -->
		<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
			{#each connectors as connector (connector.id)}
				{@const connectorStats = getStatsForConnector(connector.id)}
				{@const typeStyles = getTypeStyles(connector.type)}
				<Card.Root variant="glass" class="p-5 transition-all duration-300 {typeStyles.glow}">
					<!-- Header Row: Name and Type Badge -->
					<div class="flex items-start justify-between mb-3">
						<a
							href="/connectors/{connector.id}"
							class="text-lg font-display font-semibold hover:text-primary transition-colors flex-1 truncate"
						>
							{connector.name}
						</a>
						<span
							class="ml-2 px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap {typeStyles.badge}"
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
								Last sync: <span class="font-medium text-foreground/80"
									>{new Date(connector.lastSync).toLocaleString()}</span
								>
							</p>
						{:else}
							<p class="italic opacity-75">Never synced</p>
						{/if}
					</div>

					<!-- Quick Statistics -->
					<div class="flex items-center gap-4 text-sm pt-3 border-t border-glass-border/20">
						<div class="flex items-center gap-1.5">
							<span class="text-muted-foreground">Gaps:</span>
							<span class="font-semibold text-foreground">{connectorStats.gapsCount}</span>
						</div>
						<div class="flex items-center gap-1.5">
							<span class="text-muted-foreground">Queued:</span>
							<span class="font-semibold text-foreground">{connectorStats.queueDepth}</span>
						</div>
					</div>
				</Card.Root>
			{/each}
		</div>
	{/if}
</div>
