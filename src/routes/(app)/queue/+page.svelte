<script lang="ts">
	import type { PageProps } from './$types';
	import { QueueFilters, QueueTable } from '$lib/components/queue';
	import { Button } from '$lib/components/ui/button';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';

	/**
	 * Queue management page with virtualized table.
	 * Requirements: 18.1
	 * - Display items in priority order
	 * - Show estimated dispatch time
	 * - Show current processing indicator
	 */

	let { data }: PageProps = $props();

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

	// Count of active items (queued + searching)
	const activeCount = $derived(data.statusCounts.queued + data.statusCounts.searching);
</script>

<svelte:head>
	<title>Queue Management - Comradarr</title>
</svelte:head>

<div class="container mx-auto p-6">
	<!-- Header -->
	<div class="flex items-center justify-between mb-6">
		<div>
			<h1 class="text-3xl font-bold">Queue</h1>
			<p class="text-muted-foreground mt-1">
				{#if activeCount > 0}
					{activeCount} item{activeCount !== 1 ? 's' : ''} actively processing
				{:else}
					View and manage the search queue
				{/if}
			</p>
		</div>
	</div>

	<!-- Filters -->
	<QueueFilters
		connectors={data.connectors}
		statusCounts={data.statusCounts}
	/>

	<!-- Content -->
	{#if data.queue.length === 0}
		<div class="rounded-lg border border-dashed p-8 text-center">
			<h2 class="text-lg font-medium mb-2">No queue items found</h2>
			<p class="text-muted-foreground">
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
</div>
