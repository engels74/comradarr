<script lang="ts">
	import { enhance } from '$app/forms';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { StatusBadge } from '$lib/components/shared';
	import type { ProwlarrInstance } from '$lib/server/db/schema';
	import { cn } from '$lib/utils.js';

	/**
	 * Stats for a Prowlarr instance.
	 */
	interface ProwlarrInstanceStats {
		instanceId: number;
		totalIndexers: number;
		rateLimitedIndexers: number;
	}

	interface Props {
		instance: ProwlarrInstance;
		stats: ProwlarrInstanceStats;
		class?: string;
	}

	let { instance, stats, class: className }: Props = $props();

	/**
	 * Truncate URL for display
	 */
	const truncatedUrl = $derived(() => {
		const maxLength = 35;
		if (instance.url.length <= maxLength) return instance.url;
		return instance.url.substring(0, maxLength) + '...';
	});
</script>

<Card.Root class={cn('relative', className)}>
	<Card.Header class="pb-3">
		<div class="flex items-start justify-between gap-2">
			<div class="space-y-1">
				<Card.Title class="text-lg">
					<a
						href="/connectors/prowlarr/{instance.id}"
						class="hover:underline hover:text-primary transition-colors"
					>
						{instance.name}
					</a>
				</Card.Title>
				<div class="flex items-center gap-2">
					<span
						class={cn(
							'inline-flex items-center rounded-md px-2 py-1 text-xs font-medium',
							'bg-pink-500/10 text-pink-600 dark:text-pink-400'
						)}
					>
						Prowlarr
					</span>
					<StatusBadge status={instance.healthStatus} />
				</div>
			</div>
			<!-- Enable/Disable Toggle -->
			<form method="POST" action="?/toggleProwlarr" use:enhance>
				<input type="hidden" name="id" value={instance.id} />
				<input type="hidden" name="enabled" value={!instance.enabled} />
				<Button
					type="submit"
					variant={instance.enabled ? 'outline' : 'secondary'}
					size="sm"
					class={cn(
						instance.enabled
							? 'text-green-600 hover:text-green-700 dark:text-green-400'
							: 'text-muted-foreground'
					)}
				>
					{instance.enabled ? 'Enabled' : 'Disabled'}
				</Button>
			</form>
		</div>
	</Card.Header>
	<Card.Content class="space-y-3">
		<!-- URL -->
		<div class="text-sm text-muted-foreground truncate" title={instance.url}>
			{truncatedUrl()}
		</div>

		<!-- Quick Stats -->
		<div class="flex items-center gap-4 text-sm">
			<div class="flex items-center gap-1.5">
				<span class="font-medium text-foreground">{stats.totalIndexers}</span>
				<span class="text-muted-foreground">indexers</span>
			</div>
			{#if stats.rateLimitedIndexers > 0}
				<div class="flex items-center gap-1.5">
					<span class="font-medium text-yellow-600 dark:text-yellow-400"
						>{stats.rateLimitedIndexers}</span
					>
					<span class="text-muted-foreground">rate-limited</span>
				</div>
			{/if}
		</div>

		<!-- Last Health Check -->
		{#if instance.lastHealthCheck}
			<div class="text-xs text-muted-foreground">
				Last check: {new Date(instance.lastHealthCheck).toLocaleString()}
			</div>
		{:else}
			<div class="text-xs text-muted-foreground">Never checked</div>
		{/if}
	</Card.Content>
</Card.Root>
