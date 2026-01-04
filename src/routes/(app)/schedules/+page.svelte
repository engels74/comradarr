<script lang="ts">
/**
 * Schedules list page with timeline visualization.
 */

import CalendarDaysIcon from '@lucide/svelte/icons/calendar-days';
import { ScheduleCard, ScheduleTimeline } from '$lib/components/schedules';
import { Button } from '$lib/components/ui/button';
import type { PageProps } from './$types';

let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Schedules - Comradarr</title>
</svelte:head>

<div class="container mx-auto p-6 lg:p-8">
	<header class="flex items-center justify-between mb-8 animate-float-up" style="animation-delay: 0ms;">
		<div class="flex items-center gap-3">
			<div class="p-2.5 rounded-xl bg-muted/50">
				<CalendarDaysIcon class="h-6 w-6 text-muted-foreground" />
			</div>
			<div>
				<h1 class="font-display text-3xl font-semibold tracking-tight md:text-4xl">Sweep Schedules</h1>
				<p class="text-muted-foreground mt-2">
					Configure automated sweep schedules for your connectors
				</p>
			</div>
		</div>
		<Button href="/schedules/new">Add Schedule</Button>
	</header>

	{#if data.schedules.length === 0}
		<div class="glass-panel p-12 text-center animate-float-up" style="animation-delay: 100ms;">
			<div class="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-muted/50 mb-4">
				<CalendarDaysIcon class="h-6 w-6 text-muted-foreground opacity-50" />
			</div>
			<h2 class="text-lg font-display font-medium mb-2">No schedules configured</h2>
			<p class="text-muted-foreground mb-4">
				Create your first schedule to automate content gap detection and upgrade searches.
			</p>
			<Button href="/schedules/new">Add Schedule</Button>
		</div>
	{:else}
		<!-- Schedule Cards -->
		<div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3 animate-float-up" style="animation-delay: 100ms;">
			{#each data.schedules as schedule (schedule.id)}
				<ScheduleCard {schedule} />
			{/each}
		</div>

		<!-- Timeline Visualization -->
		<ScheduleTimeline timeline={data.timeline} class="mt-8" />
	{/if}
</div>
