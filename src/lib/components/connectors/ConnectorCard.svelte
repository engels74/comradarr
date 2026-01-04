<script lang="ts">
	import { enhance } from '$app/forms';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { StatusBadge } from '$lib/components/shared';
	import type { Connector } from '$lib/server/db/schema';
	import type { ConnectorStats } from '$lib/server/db/queries/connectors';
	import { cn } from '$lib/utils.js';

	interface Props {
		connector: Connector;
		stats: ConnectorStats;
		class?: string;
	}

	let { connector, stats, class: className }: Props = $props();

	/**
	 * Connector type badge colors
	 */
	const typeColors: Record<string, string> = {
		sonarr: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
		radarr: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
		whisparr: 'bg-purple-500/10 text-purple-600 dark:text-purple-400'
	};

	const typeColor = $derived(typeColors[connector.type] ?? 'bg-gray-500/10 text-gray-600');

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
		return connector.url.substring(0, maxLength) + '...';
	});
</script>

<Card.Root class={cn('relative', className)}>
	<Card.Header class="pb-3">
		<div class="flex items-start justify-between gap-2">
			<div class="space-y-1">
				<Card.Title class="text-lg">
					<a
						href="/connectors/{connector.id}"
						class="hover:underline hover:text-primary transition-colors"
					>
						{connector.name}
					</a>
				</Card.Title>
				<div class="flex items-center gap-2">
					<span
						class={cn(
							'inline-flex items-center rounded-md px-2 py-1 text-xs font-medium',
							typeColor
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
					variant={connector.enabled ? 'outline' : 'secondary'}
					size="sm"
					class={cn(
						connector.enabled
							? 'text-green-600 hover:text-green-700 dark:text-green-400'
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
		<div class="flex items-center gap-4 text-sm">
			<div class="flex items-center gap-1.5">
				<span class="font-medium text-foreground">{stats.gapsCount}</span>
				<span class="text-muted-foreground">gaps</span>
			</div>
			<div class="flex items-center gap-1.5">
				<span class="font-medium text-foreground">{stats.queueDepth}</span>
				<span class="text-muted-foreground">queued</span>
			</div>
		</div>

		<!-- Last Sync -->
		{#if connector.lastSync}
			<div class="text-xs text-muted-foreground">
				Last sync: {new Date(connector.lastSync).toLocaleString()}
			</div>
		{:else}
			<div class="text-xs text-muted-foreground">Never synced</div>
		{/if}
	</Card.Content>
</Card.Root>
