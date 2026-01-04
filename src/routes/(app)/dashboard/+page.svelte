<script lang="ts">
import ActivityFeed from '$lib/components/dashboard/ActivityFeed.svelte';
import ConnectionStatusPanel from '$lib/components/dashboard/ConnectionStatusPanel.svelte';
import LibraryCompletionPanel from '$lib/components/dashboard/LibraryCompletionPanel.svelte';
import StatisticsPanel from '$lib/components/dashboard/StatisticsPanel.svelte';
import UpcomingSchedulePanel from '$lib/components/dashboard/UpcomingSchedulePanel.svelte';
import type { PageProps } from './$types';

let { data }: PageProps = $props();
</script>

<div class="container mx-auto p-6 lg:p-8">
	<!-- Page Header -->
	<header class="mb-8">
		<h1 class="font-display text-3xl font-semibold tracking-tight md:text-4xl">Dashboard</h1>
		<p class="text-muted-foreground mt-2">Overview of your media library completion status</p>
	</header>

	<!-- Statistics Section - Hero Stats -->
	<section class="mb-8 animate-float-up" style="animation-delay: 0ms;">
		<StatisticsPanel contentStats={data.contentStats} todayStats={data.todayStats} />
	</section>

	<!-- Main Content Grid -->
	<div class="grid gap-6 lg:grid-cols-2">
		<!-- Library Completion Section (Requirement 15.4) -->
		<section class="animate-float-up" style="animation-delay: 50ms;">
			<LibraryCompletionPanel completionData={data.completionData} />
		</section>

		<!-- Upcoming Schedules Section (Requirement 15.5) -->
		<!-- Only show when connectors are configured, as scheduled jobs are meaningless without them -->
		{#if data.connectors.length > 0}
			<section class="animate-float-up" style="animation-delay: 100ms;">
				<UpcomingSchedulePanel scheduledJobs={data.scheduledJobs} />
			</section>
		{/if}

		<!-- Connection Status Section -->
		<section class="animate-float-up {data.connectors.length > 0 ? '' : 'lg:col-span-2'}" style="animation-delay: 150ms;">
			<ConnectionStatusPanel connectors={data.connectors} stats={data.stats} />
		</section>
	</div>

	<!-- Activity Feed Section - Full Width -->
	<section class="mt-6 animate-float-up" style="animation-delay: 200ms;">
		<ActivityFeed activities={data.activities} />
	</section>
</div>
