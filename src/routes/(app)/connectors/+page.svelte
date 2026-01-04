<script lang="ts">
import PlugIcon from '@lucide/svelte/icons/plug';
import RadarIcon from '@lucide/svelte/icons/radar';
import { ConnectorCard } from '$lib/components/connectors';
import { ProwlarrInstanceCard } from '$lib/components/prowlarr';
import { Button } from '$lib/components/ui/button';
import * as Card from '$lib/components/ui/card';
import type { PageProps } from './$types';

let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Connectors - Comradarr</title>
</svelte:head>

<div class="container mx-auto p-6 lg:p-8">
	<!-- Page Header -->
	<header class="mb-8 animate-float-up" style="animation-delay: 0ms;">
		<h1 class="font-display text-3xl font-semibold tracking-tight md:text-4xl">Connectors</h1>
		<p class="text-muted-foreground mt-2">Manage your *arr application connections</p>
	</header>

	<!-- *arr Connectors Section -->
	<section class="mb-10 animate-float-up" style="animation-delay: 50ms;">
		<div class="flex items-center justify-between mb-6">
			<h2 class="font-display text-xl font-semibold tracking-tight flex items-center gap-2">
				<PlugIcon class="h-5 w-5 text-primary" />
				Media Connectors
			</h2>
			<Button href="/connectors/new">Add Connector</Button>
		</div>

		{#if data.connectors.length === 0}
			<Card.Root variant="glass" class="p-8">
				<div class="text-center text-muted-foreground">
					<div class="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-glass/50 mb-4">
						<PlugIcon class="h-8 w-8 opacity-50" />
					</div>
					<p class="font-medium text-lg mb-2">No connectors configured</p>
					<p class="text-sm opacity-75 mb-6">
						Add your first connector to start monitoring your media library.
					</p>
					<Button href="/connectors/new">Add Connector</Button>
				</div>
			</Card.Root>
		{:else}
			<div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
				{#each data.connectors as connector, i (connector.id)}
					<div class="animate-float-up" style="animation-delay: {100 + i * 50}ms;">
						<ConnectorCard
							{connector}
							stats={data.stats[connector.id] ?? {
								connectorId: connector.id,
								gapsCount: 0,
								queueDepth: 0
							}}
						/>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<!-- Prowlarr Section -->
	<section class="animate-float-up" style="animation-delay: 150ms;">
		<div class="flex items-center justify-between mb-6">
			<h2 class="font-display text-xl font-semibold tracking-tight flex items-center gap-2">
				<RadarIcon class="h-5 w-5 text-[oklch(var(--accent-prowlarr))]" />
				Prowlarr Instances
			</h2>
			<Button href="/connectors/prowlarr/new" variant="glass">Add Prowlarr</Button>
		</div>

		{#if data.prowlarrInstances.length === 0}
			<Card.Root variant="glass" class="p-8">
				<div class="text-center text-muted-foreground">
					<div class="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-glass/50 mb-4">
						<RadarIcon class="h-8 w-8 opacity-50" />
					</div>
					<p class="font-medium text-lg mb-2">No Prowlarr instances configured</p>
					<p class="text-sm opacity-75 mb-6">
						Connect to Prowlarr to monitor your indexer health status.
					</p>
					<Button href="/connectors/prowlarr/new" variant="glass">Add Prowlarr</Button>
				</div>
			</Card.Root>
		{:else}
			<div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
				{#each data.prowlarrInstances as instance, i (instance.id)}
					<div class="animate-float-up" style="animation-delay: {200 + i * 50}ms;">
						<ProwlarrInstanceCard
							{instance}
							stats={data.prowlarrStats[instance.id] ?? {
								instanceId: instance.id,
								totalIndexers: 0,
								rateLimitedIndexers: 0
							}}
						/>
					</div>
				{/each}
			</div>
		{/if}
	</section>
</div>
