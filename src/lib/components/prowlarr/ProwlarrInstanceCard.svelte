<script lang="ts">
import { enhance } from '$app/forms';
import { StatusBadge } from '$lib/components/shared';
import { Button } from '$lib/components/ui/button';
import * as Card from '$lib/components/ui/card';
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
	return `${instance.url.substring(0, maxLength)}...`;
});
</script>

<Card.Root
	variant="glass"
	class={cn(
		'relative transition-all duration-300 hover:shadow-[0_0_20px_oklch(var(--accent-prowlarr)/0.2)]',
		className
	)}
>
	<Card.Header class="pb-3">
		<div class="flex items-start justify-between gap-2">
			<div class="space-y-2">
				<Card.Title class="text-lg font-display font-semibold">
					<a
						href="/connectors/prowlarr/{instance.id}"
						class="hover:text-primary transition-colors"
					>
						{instance.name}
					</a>
				</Card.Title>
				<div class="flex items-center gap-2">
					<span
						class={cn(
							'inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-medium',
							'bg-[oklch(var(--accent-prowlarr)/0.15)] text-[oklch(var(--accent-prowlarr))] border border-[oklch(var(--accent-prowlarr)/0.3)]'
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
					variant="glass"
					size="sm"
					class={cn(
						'text-xs',
						instance.enabled
							? 'text-success border-success/30'
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
		<div class="flex items-center gap-4 text-sm pt-2 border-t border-glass-border/20">
			<div class="flex items-center gap-1.5">
				<span class="font-semibold text-foreground">{stats.totalIndexers}</span>
				<span class="text-muted-foreground">indexers</span>
			</div>
			{#if stats.rateLimitedIndexers > 0}
				<div class="flex items-center gap-1.5">
					<span class="font-semibold text-warning">{stats.rateLimitedIndexers}</span>
					<span class="text-muted-foreground">rate-limited</span>
				</div>
			{/if}
		</div>

		<!-- Last Health Check -->
		{#if instance.lastHealthCheck}
			<div class="text-xs text-muted-foreground">
				Last check: <span class="text-foreground/80">{new Date(instance.lastHealthCheck).toLocaleString()}</span>
			</div>
		{:else}
			<div class="text-xs text-muted-foreground italic opacity-75">Never checked</div>
		{/if}
	</Card.Content>
</Card.Root>
