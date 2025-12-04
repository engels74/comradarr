<script lang="ts">
	import ActivityFeed from '$lib/components/dashboard/ActivityFeed.svelte';
	import ConnectionStatusPanel from '$lib/components/dashboard/ConnectionStatusPanel.svelte';
	import LibraryCompletionPanel from '$lib/components/dashboard/LibraryCompletionPanel.svelte';
	import StatisticsPanel from '$lib/components/dashboard/StatisticsPanel.svelte';
	import UpcomingSchedulePanel from '$lib/components/dashboard/UpcomingSchedulePanel.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<div class="container mx-auto p-6">
	<!-- Page Header -->
	<div class="mb-6">
		<h1 class="text-3xl font-bold">Dashboard</h1>
		<p class="text-muted-foreground mt-1">Overview of your media library completion status</p>
	</div>

	<!-- Statistics Section -->
	<div class="mb-6">
		<StatisticsPanel contentStats={data.contentStats} todayStats={data.todayStats} />
	</div>

	<!-- Library Completion Section (Requirement 15.4) -->
	<div class="mb-6">
		<LibraryCompletionPanel completionData={data.completionData} />
	</div>

	<!-- Upcoming Schedules Section (Requirement 15.5) -->
	<div class="mb-6">
		<UpcomingSchedulePanel scheduledJobs={data.scheduledJobs} />
	</div>

	<!-- Connection Status Section -->
	<div class="mb-6">
		<ConnectionStatusPanel connectors={data.connectors} stats={data.stats} />
	</div>

	<!-- Activity Feed Section -->
	<div class="mb-6">
		<ActivityFeed activities={data.activities} />
	</div>
</div>
