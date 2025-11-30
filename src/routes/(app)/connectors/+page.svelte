<script lang="ts">
	import type { PageProps } from './$types';
	import { ConnectorCard } from '$lib/components/connectors';
	import { Button } from '$lib/components/ui/button';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Connectors - Comradarr</title>
</svelte:head>

<div class="container mx-auto p-6">
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
</div>
