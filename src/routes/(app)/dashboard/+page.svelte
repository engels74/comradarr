<script lang="ts">
import ActivityFeed from '$lib/components/dashboard/ActivityFeed.svelte';
import ConnectionStatusPanel from '$lib/components/dashboard/ConnectionStatusPanel.svelte';
import LibraryCompletionPanel from '$lib/components/dashboard/LibraryCompletionPanel.svelte';
import StatisticsPanel from '$lib/components/dashboard/StatisticsPanel.svelte';
import UpcomingSchedulePanel from '$lib/components/dashboard/UpcomingSchedulePanel.svelte';
import type { PageProps } from './$types';

let { data }: PageProps = $props();
</script>

<div class="container mx-auto px-6 py-8 lg:px-8 lg:py-10">
	<!-- Page Header -->
	<header class="mb-10">
		<h1 class="font-display text-3xl font-semibold tracking-tight md:text-4xl">Dashboard</h1>
		<p class="text-muted-foreground mt-2 text-base">Overview of your media library completion status</p>
	</header>

	<!-- Statistics Section - Hero Stats -->
	<section class="mb-10 animate-float-up" style="animation-delay: 0ms;">
		<StatisticsPanel contentStats={data.contentStats} todayStats={data.todayStats} />
	</section>

	<!-- Main Content Grid - Library & Schedules side by side -->
	<div class="grid gap-8 mb-10 {data.connectors.length > 0 ? 'lg:grid-cols-2' : 'lg:grid-cols-1'}">
		<!-- Library Completion Section -->
		<section class="animate-float-up" style="animation-delay: 50ms;">
			<LibraryCompletionPanel completionData={data.completionData} />
		</section>

		<!-- Upcoming Schedules Section -->
		<!-- Only show when connectors are configured, as scheduled jobs are meaningless without them -->
		{#if data.connectors.length > 0}
			<section class="animate-float-up" style="animation-delay: 100ms;">
				<UpcomingSchedulePanel scheduledJobs={data.scheduledJobs} />
			</section>
		{/if}
	</div>

	<!-- Connection Status Section - Full Width -->
	<section class="mb-10 animate-float-up" style="animation-delay: 150ms;">
		<ConnectionStatusPanel connectors={data.connectors} stats={data.stats} />
	</section>

	<!-- Activity Feed Section - Full Width -->
	<section class="animate-float-up" style="animation-delay: 200ms;">
		<ActivityFeed activities={data.activities} />
	</section>
</div>
