<script lang="ts">
	import type { PageProps } from './$types';
	import { ConnectorCard } from '$lib/components/connectors';
	import { ProwlarrInstanceCard } from '$lib/components/prowlarr';
	import { Button } from '$lib/components/ui/button';
	import { Separator } from '$lib/components/ui/separator';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Connectors - Comradarr</title>
</svelte:head>

<div class="container mx-auto p-6">
	<!-- *arr Connectors Section -->
	<div class="flex items-center justify-between mb-6">
		<div>
			<h1 class="text-3xl font-bold">Connectors</h1>
			<p class="text-muted-foreground mt-1">
				Manage your *arr application connections
			</p>
		</div>
		<Button href="/connectors/new">Add Connector</Button>
	</div>

	{#if data.connectors.length === 0}
		<div class="rounded-lg border border-dashed p-8 text-center">
			<h2 class="text-lg font-medium mb-2">No connectors configured</h2>
			<p class="text-muted-foreground mb-4">
				Add your first connector to start monitoring your media library.
			</p>
			<Button href="/connectors/new">Add Connector</Button>
		</div>
	{:else}
		<div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
			{#each data.connectors as connector (connector.id)}
				<ConnectorCard
					{connector}
					stats={data.stats[connector.id] ?? { connectorId: connector.id, gapsCount: 0, queueDepth: 0 }}
				/>
			{/each}
		</div>
	{/if}

	<!-- Prowlarr Section -->
	<Separator class="my-8" />

	<div class="flex items-center justify-between mb-6">
		<div>
			<h2 class="text-2xl font-bold">Prowlarr</h2>
			<p class="text-muted-foreground mt-1">
				Indexer health monitoring (informational only)
			</p>
		</div>
		<Button href="/connectors/prowlarr/new" variant="outline">Add Prowlarr</Button>
	</div>

	{#if data.prowlarrInstances.length === 0}
		<div class="rounded-lg border border-dashed p-8 text-center">
			<h3 class="text-lg font-medium mb-2">No Prowlarr instances configured</h3>
			<p class="text-muted-foreground mb-4">
				Connect to Prowlarr to monitor your indexer health status.
			</p>
			<Button href="/connectors/prowlarr/new" variant="outline">Add Prowlarr</Button>
		</div>
	{:else}
		<div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
			{#each data.prowlarrInstances as instance (instance.id)}
				<ProwlarrInstanceCard
					{instance}
					stats={data.prowlarrStats[instance.id] ?? { instanceId: instance.id, totalIndexers: 0, rateLimitedIndexers: 0 }}
				/>
			{/each}
		</div>
	{/if}
</div>
