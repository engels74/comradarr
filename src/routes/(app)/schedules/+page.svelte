<script lang="ts">
	import type { PageProps } from './$types';
	import { ScheduleCard } from '$lib/components/schedules';
	import { Button } from '$lib/components/ui/button';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Schedules - Comradarr</title>
</svelte:head>

<div class="container mx-auto p-6">
	<div class="flex items-center justify-between mb-6">
		<div>
			<h1 class="text-3xl font-bold">Sweep Schedules</h1>
			<p class="text-muted-foreground mt-1">
				Configure automated sweep schedules for your connectors
			</p>
		</div>
		<Button href="/schedules/new">Add Schedule</Button>
	</div>

	{#if data.schedules.length === 0}
		<div class="rounded-lg border border-dashed p-8 text-center">
			<h2 class="text-lg font-medium mb-2">No schedules configured</h2>
			<p class="text-muted-foreground mb-4">
				Create your first schedule to automate content gap detection and upgrade searches.
			</p>
			<Button href="/schedules/new">Add Schedule</Button>
		</div>
	{:else}
		<div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
			{#each data.schedules as schedule (schedule.id)}
				<ScheduleCard {schedule} />
			{/each}
		</div>
	{/if}
</div>
