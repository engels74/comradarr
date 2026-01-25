<script lang="ts">
import { enhance } from '$app/forms';
import { StatusBadge } from '$lib/components/shared';
import { Button } from '$lib/components/ui/button';
import * as Card from '$lib/components/ui/card';
import { toastStore } from '$lib/components/ui/toast';
import type { ConnectorStats } from '$lib/server/db/queries/connectors';
import type { Connector } from '$lib/server/db/schema';
import { cn } from '$lib/utils.js';

interface Props {
	connector: Connector;
	stats: ConnectorStats;
	class?: string;
}

let { connector, stats, class: className }: Props = $props();

let isReconnecting = $state(false);

const isOfflineOrUnhealthy = $derived(
	connector.healthStatus === 'offline' || connector.healthStatus === 'unhealthy'
);

/**
 * Connector type styles with OKLCH accent colors
 */
const typeStyles: Record<string, { badge: string; glow: string }> = {
	sonarr: {
		badge:
			'bg-[oklch(var(--accent-sonarr)/0.15)] text-[oklch(var(--accent-sonarr))] border border-[oklch(var(--accent-sonarr)/0.3)]',
		glow: 'hover:shadow-[0_0_20px_oklch(var(--accent-sonarr)/0.2)]'
	},
	radarr: {
		badge:
			'bg-[oklch(var(--accent-radarr)/0.15)] text-[oklch(var(--accent-radarr))] border border-[oklch(var(--accent-radarr)/0.3)]',
		glow: 'hover:shadow-[0_0_20px_oklch(var(--accent-radarr)/0.2)]'
	},
	whisparr: {
		badge:
			'bg-[oklch(var(--accent-whisparr)/0.15)] text-[oklch(var(--accent-whisparr))] border border-[oklch(var(--accent-whisparr)/0.3)]',
		glow: 'hover:shadow-[0_0_20px_oklch(var(--accent-whisparr)/0.2)]'
	}
};

const currentStyles = $derived(
	typeStyles[connector.type] ?? {
		badge: 'bg-muted text-muted-foreground border border-border',
		glow: ''
	}
);

/**
 * Format connector type with capitalized first letter
 */
const formattedType = $derived(connector.type.charAt(0).toUpperCase() + connector.type.slice(1));

/**
 * Truncate URL for display
 */
const truncatedUrl = $derived(() => {
	const maxLength = 35;
	if (connector.url.length <= maxLength) return connector.url;
	return `${connector.url.substring(0, maxLength)}...`;
});
</script>

<Card.Root variant="glass" class={cn('relative transition-all duration-300', currentStyles.glow, className)}>
	<Card.Header class="pb-3">
		<div class="flex items-start justify-between gap-2">
			<div class="space-y-2">
				<Card.Title class="text-lg font-display font-semibold">
					<a
						href="/connectors/{connector.id}"
						class="hover:text-primary transition-colors"
					>
						{connector.name}
					</a>
				</Card.Title>
				<div class="flex items-center gap-2">
					<span
						class={cn(
							'inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-medium',
							currentStyles.badge
						)}
					>
						{formattedType}
					</span>
					<StatusBadge status={connector.healthStatus} />
				</div>
			</div>
			<!-- Enable/Disable Toggle -->
			<form method="POST" action="?/toggle" use:enhance>
				<input type="hidden" name="id" value={connector.id} />
				<input type="hidden" name="enabled" value={!connector.enabled} />
				<Button
					type="submit"
					variant="glass"
					size="sm"
					class={cn(
						'text-xs',
						connector.enabled
							? 'text-success border-success/30'
							: 'text-muted-foreground'
					)}
				>
					{connector.enabled ? 'Enabled' : 'Disabled'}
				</Button>
			</form>
		</div>
	</Card.Header>
	<Card.Content class="space-y-3">
		<!-- URL -->
		<div class="text-sm text-muted-foreground truncate" title={connector.url}>
			{truncatedUrl()}
		</div>

		<!-- Quick Stats -->
		<div class="flex items-center gap-4 text-sm pt-2 border-t border-glass-border/20">
			<div class="flex items-center gap-1.5">
				<span class="font-semibold text-foreground">{stats.gapsCount}</span>
				<span class="text-muted-foreground">gaps</span>
			</div>
			<div class="flex items-center gap-1.5">
				<span class="font-semibold text-foreground">{stats.queueDepth}</span>
				<span class="text-muted-foreground">queued</span>
			</div>
		</div>

		<!-- Last Sync -->
		{#if connector.lastSync}
			<div class="text-xs text-muted-foreground">
				Last sync: <span class="text-foreground/80">{new Date(connector.lastSync).toLocaleString()}</span>
			</div>
		{:else}
			<div class="text-xs text-muted-foreground italic opacity-75">Never synced</div>
		{/if}

		<!-- Reconnect Button for offline/unhealthy connectors -->
		{#if isOfflineOrUnhealthy}
			<div class="pt-2 border-t border-glass-border/20">
				<form
					method="POST"
					action="?/reconnect"
					use:enhance={() => {
						isReconnecting = true;
						return async ({ result, update }) => {
							await update();
							isReconnecting = false;

							if (result.type === 'success' && result.data?.success) {
								toastStore.success(result.data.message as string);
							} else if (result.type === 'success' && result.data?.error) {
								toastStore.error(result.data.error as string);
							}
						};
					}}
				>
					<input type="hidden" name="id" value={connector.id} />
					<Button
						type="submit"
						variant="outline"
						size="sm"
						class="w-full text-xs"
						disabled={isReconnecting}
					>
						{isReconnecting ? 'Reconnecting...' : 'Reconnect'}
					</Button>
				</form>
			</div>
		{/if}
	</Card.Content>
</Card.Root>
