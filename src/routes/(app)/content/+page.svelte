<script lang="ts">
	import type { PageProps } from './$types';
	import { ContentFilters, ContentTable } from '$lib/components/content';
	import { Button } from '$lib/components/ui/button';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';

	/**
	 * Content browser page.
	 * Requirements: 17.1, 17.2
	 */

	let { data }: PageProps = $props();

	// Pagination state derived from filters
	const currentPage = $derived(
		Math.floor((data.filters.offset ?? 0) / (data.filters.limit ?? 50)) + 1
	);
	const totalPages = $derived(Math.ceil(data.total / (data.filters.limit ?? 50)));
	const showingFrom = $derived(data.content.length > 0 ? (data.filters.offset ?? 0) + 1 : 0);
	const showingTo = $derived((data.filters.offset ?? 0) + data.content.length);

	/**
	 * Navigate to a specific page.
	 */
	function goToPage(pageNum: number) {
		const params = new URLSearchParams($page.url.searchParams);
		params.set('page', pageNum.toString());
		goto(`/content?${params.toString()}`);
	}
</script>

<svelte:head>
	<title>Content Browser - Comradarr</title>
</svelte:head>

<div class="container mx-auto p-6">
	<!-- Header -->
	<div class="flex items-center justify-between mb-6">
		<div>
			<h1 class="text-3xl font-bold">Content Browser</h1>
			<p class="text-muted-foreground mt-1">
				Browse and manage your library content
			</p>
		</div>
	</div>

	<!-- Filters -->
	<ContentFilters
		connectors={data.connectors}
		statusCounts={data.statusCounts}
	/>

	<!-- Content -->
	{#if data.content.length === 0}
		<div class="rounded-lg border border-dashed p-8 text-center">
			<h2 class="text-lg font-medium mb-2">No content found</h2>
			<p class="text-muted-foreground">
				{#if data.filters.search}
					No results for "{data.filters.search}". Try a different search term.
				{:else if data.filters.status !== 'all'}
					No content matches the selected status filter.
				{:else}
					No content has been synced yet. Add a connector and run a sync.
				{/if}
			</p>
		</div>
	{:else}
		<ContentTable items={data.content} />

		<!-- Pagination -->
		{#if totalPages > 1}
			<div class="flex items-center justify-between mt-6">
				<p class="text-sm text-muted-foreground">
					Showing {showingFrom}-{showingTo} of {data.total} items
				</p>

				<div class="flex items-center gap-2">
					<Button
						variant="outline"
						size="sm"
						disabled={currentPage <= 1}
						onclick={() => goToPage(currentPage - 1)}
					>
						Previous
					</Button>

					<span class="px-4 py-2 text-sm">
						Page {currentPage} of {totalPages}
					</span>

					<Button
						variant="outline"
						size="sm"
						disabled={currentPage >= totalPages}
						onclick={() => goToPage(currentPage + 1)}
					>
						Next
					</Button>
				</div>
			</div>
		{:else if data.total > 0}
			<p class="text-sm text-muted-foreground mt-4 text-center">
				Showing all {data.total} items
			</p>
		{/if}
	{/if}
</div>
