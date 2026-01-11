<script lang="ts">
import { onMount } from 'svelte';
import { goto } from '$app/navigation';
import { page } from '$app/stores';
import {
	QueueBulkActions,
	QueueControls,
	QueueFilters,
	QueueProgressSummary,
	QueueTable,
	RecentCompletions,
	ThrottleStatusPanel
} from '$lib/components/queue';
import { Button } from '$lib/components/ui/button';
import { toastStore } from '$lib/components/ui/toast';
import { createPollingController, POLLING_INTERVALS } from '$lib/utils/polling';
import type { PageProps } from './$types';

/**
 * Queue management page with virtualized table.
 *
 * - Display items in priority order
 * - Show estimated dispatch time
 * - Show current processing indicator
 * - Manual priority adjustment and removal from queue
 * - Pause, resume, and clear queue actions
 * - Display recent completions with outcome indicators
 * - Real-time updates without page refresh
 */

let { data }: PageProps = $props();

// Polling controller for real-time updates
const polling = createPollingController({
	dependencyKey: 'app:queue',
	interval: POLLING_INTERVALS.FAST
});

// Start/stop polling on mount/unmount
onMount(() => {
	polling.start();
	return () => polling.stop();
});

// Selection state
let selectedIds = $state<Set<number>>(new Set());

// Clear selection when data changes (e.g., after an action)
$effect(() => {
	// Access data to create dependency
	data.queue;
	// Clear selection on data refresh
	selectedIds = new Set();
});

/**
 * Handle selection change from QueueTable.
 */
function handleSelectionChange(ids: Set<number>) {
	selectedIds = ids;
}

/**
 * Clear all selections.
 */
function clearSelection() {
	selectedIds = new Set();
}

/**
 * Handle action start - pause polling during form submission.
 */
function handleActionStart() {
	polling.pause();
}

/**
 * Handle action complete - resume polling and show feedback.
 */
function handleActionComplete(message: string) {
	toastStore.success(message);
	// Resume polling after a short delay to allow UI to settle
	setTimeout(() => {
		polling.resume();
	}, 500);
}

// Pagination state
const pageSize = $derived(data.filters.limit ?? 50);
const totalPages = $derived(Math.ceil(data.total / pageSize));
const currentPage = $derived(Math.floor((data.filters.offset ?? 0) / pageSize) + 1);

/**
 * Navigate to a page.
 */
function goToPage(pageNum: number) {
	if (pageNum < 1 || pageNum > totalPages) return;

	const params = new URLSearchParams($page.url.searchParams);
	params.set('page', pageNum.toString());
	goto(`/queue?${params.toString()}`);
}
</script>

<svelte:head>
	<title>Queue Management - Comradarr</title>
</svelte:head>

<div class="container mx-auto p-6 lg:p-8">
	<!-- Header -->
	<header class="flex items-center justify-between mb-8 animate-float-up" style="animation-delay: 0ms;">
		<div>
			<h1 class="font-display text-3xl font-semibold tracking-tight md:text-4xl">Queue</h1>
			<p class="text-muted-foreground mt-2">
				{#if data.statusCounts.searching > 0}
					{data.statusCounts.searching} searching, {data.statusCounts.queued} waiting
				{:else if data.statusCounts.queued > 0}
					{data.statusCounts.queued} item{data.statusCounts.queued !== 1 ? 's' : ''} waiting for rate limit
				{:else}
					View and manage the search queue
				{/if}
			</p>
		</div>
		<QueueControls
			pauseStatus={data.pauseStatus}
			onActionStart={handleActionStart}
			onActionComplete={handleActionComplete}
		/>
	</header>

	<!-- Throttle Status Panel -->
	<ThrottleStatusPanel
		throttleInfo={data.throttleInfo}
		class="mb-6 animate-float-up"
		style="animation-delay: 50ms;"
	/>

	<!-- Queue Progress Summary -->
	<QueueProgressSummary
		statusCounts={data.statusCounts}
		class="mb-6 animate-float-up"
		style="animation-delay: 75ms;"
	/>

	<!-- Filters -->
	<div class="animate-float-up" style="animation-delay: 100ms;">
		<QueueFilters connectors={data.connectors} statusCounts={data.statusCounts} />
	</div>

	<!-- Bulk Actions (when items selected) -->
	<QueueBulkActions
		selectedCount={selectedIds.size}
		{selectedIds}
		onClearSelection={clearSelection}
		onActionStart={handleActionStart}
		onActionComplete={handleActionComplete}
	/>

	<!-- Content -->
	{#if data.queue.length === 0}
		<div class="glass-panel p-8 text-center animate-float-up" style="animation-delay: 150ms;">
			<div class="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-glass/50 mb-4">
				<svg class="h-8 w-8 text-muted-foreground opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
				</svg>
			</div>
			<h2 class="text-lg font-medium mb-2">No queue items found</h2>
			<p class="text-muted-foreground text-sm">
				{#if data.filters.search}
					No results for "{data.filters.search}". Try a different search term.
				{:else if data.filters.state !== 'all'}
					No items match the selected state filter.
				{:else}
					The queue is empty. Content will appear here when gaps or upgrades are detected.
				{/if}
			</p>
		</div>
	{:else}
		<QueueTable
			items={data.queue}
			throttleInfo={data.throttleInfo}
			{selectedIds}
			onSelectionChange={handleSelectionChange}
		/>

		<!-- Pagination -->
		<div class="flex flex-col items-center gap-4 mt-6">
			<p class="text-sm text-muted-foreground">
				Showing {data.queue.length.toLocaleString()} of {data.total.toLocaleString()} items
				{#if totalPages > 1}
					(Page {currentPage} of {totalPages})
				{/if}
			</p>

			{#if totalPages > 1}
				<div class="flex items-center gap-2">
					<Button
						variant="outline"
						size="sm"
						disabled={currentPage <= 1}
						onclick={() => goToPage(currentPage - 1)}
					>
						Previous
					</Button>
					<Button
						variant="outline"
						size="sm"
						disabled={currentPage >= totalPages}
						onclick={() => goToPage(currentPage + 1)}
					>
						Next
					</Button>
				</div>
			{/if}
		</div>
	{/if}

	<!-- Recent Completions -->
	<RecentCompletions completions={data.recentCompletions} class="mt-8" />
</div>
