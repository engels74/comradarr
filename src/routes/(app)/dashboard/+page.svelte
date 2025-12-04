<script lang="ts">
	import ConnectionStatusPanel from '$lib/components/dashboard/ConnectionStatusPanel.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<div class="container mx-auto p-6">
	<!-- Page Header -->
	<div class="mb-6">
		<h1 class="text-3xl font-bold">Dashboard</h1>
		<p class="text-muted-foreground mt-1">
			Overview of your media library completion status
		</p>
	</div>

	<!-- Connection Status Section -->
	<div class="mb-6">
		<ConnectionStatusPanel connectors={data.connectors} stats={data.stats} />
	</div>

	<!-- Welcome Message (can be removed or moved later) -->
	<!-- <p class="text-muted-foreground">
		Welcome, {data.user.displayName ?? data.user.username}!
	</p> -->
</div>
