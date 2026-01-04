<script lang="ts">
import { goto } from '$app/navigation';
import { page } from '$app/stores';
import { BulkActionBar, ContentFilters, VirtualizedContentTable } from '$lib/components/content';
import { Button } from '$lib/components/ui/button';
import * as Dialog from '$lib/components/ui/dialog';
import { Input } from '$lib/components/ui/input';
import { toastStore } from '$lib/components/ui/toast';
import type { BulkActionTarget, ContentItem } from '$lib/server/db/queries/content';
import type { PageProps } from './$types';

/**
 * Content browser page with virtualized table and "Load More" pagination.
 */

let { data }: PageProps = $props();

// Loaded items state - starts with initial data, grows as user loads more
// Initialize empty and populate via effect to track reactive data changes
let loadedItems = $state<ContentItem[]>([]);
let nextCursor = $state<string | null>(null);
let isLoadingMore = $state(false);
let loadError = $state<string | null>(null);
let lastDataContent = $state<ContentItem[] | null>(null);

// Reset loaded items when filters change (detected via data.content changing)
$effect(() => {
	// Only update when data.content reference changes (filter change or initial load)
	if (data.content !== lastDataContent) {
		loadedItems = [...data.content];
		nextCursor = data.nextCursor;
		loadError = null;
		// Clear selection when filters change
		selectedKeys = new Set();
		lastClickedKey = null;
		lastDataContent = data.content;
	}
});

// Selection state
let selectedKeys = $state<Set<string>>(new Set());
let lastClickedKey = $state<string | null>(null);

// Computed selection values
const selectedCount = $derived(selectedKeys.size);
const selectedTargets = $derived<BulkActionTarget[]>(
	Array.from(selectedKeys).map((key) => {
		const [type, id] = key.split('-');
		return { type: type as 'series' | 'movie', id: Number(id) };
	})
);

// Has more items to load
const hasMore = $derived(nextCursor !== null);

// Jump to page state
let jumpDialogOpen = $state(false);
let jumpPageInput = $state('');
const pageSize = $derived(data.filters.limit ?? 50);
const totalPages = $derived(Math.ceil(data.total / pageSize));
const currentPage = $derived(Math.floor((data.filters.offset ?? 0) / pageSize) + 1);

/**
 * Jump to a specific page number.
 */
function jumpToPage() {
	const targetPage = parseInt(jumpPageInput, 10);
	if (Number.isNaN(targetPage) || targetPage < 1 || targetPage > totalPages) {
		return; // Invalid page number
	}

	// Navigate to the target page
	const params = new URLSearchParams($page.url.searchParams);
	params.set('page', targetPage.toString());
	goto(`/content?${params.toString()}`);

	// Close dialog and reset input
	jumpDialogOpen = false;
	jumpPageInput = '';
}

/**
 * Load more items from the API.
 */
async function loadMore() {
	if (isLoadingMore || !nextCursor) return;

	isLoadingMore = true;
	loadError = null;

	try {
		// Build API URL with current filters
		const params = new URLSearchParams($page.url.searchParams);
		params.set('cursor', nextCursor);
		params.set('offset', loadedItems.length.toString());

		const response = await fetch(`/api/content?${params.toString()}`);
		if (!response.ok) {
			throw new Error(`Failed to load more items: ${response.statusText}`);
		}

		const result = await response.json();
		loadedItems = [...loadedItems, ...result.items];
		nextCursor = result.nextCursor;
	} catch (e) {
		loadError = e instanceof Error ? e.message : 'Failed to load more items';
	} finally {
		isLoadingMore = false;
	}
}

/**
 * Toggle selection for an item, with optional range selection (Shift+click).
 */
function toggleSelection(key: string, shiftKey: boolean) {
	const newSet = new Set(selectedKeys);

	if (shiftKey && lastClickedKey) {
		// Range select: select all items between lastClickedKey and key
		const keys = loadedItems.map((item) => `${item.type}-${item.id}`);
		const fromIndex = keys.indexOf(lastClickedKey);
		const toIndex = keys.indexOf(key);

		if (fromIndex !== -1 && toIndex !== -1) {
			const start = Math.min(fromIndex, toIndex);
			const end = Math.max(fromIndex, toIndex);
			for (let i = start; i <= end; i++) {
				const k = keys[i];
				if (k !== undefined) {
					newSet.add(k);
				}
			}
		} else {
			// Fallback to single toggle
			if (newSet.has(key)) {
				newSet.delete(key);
			} else {
				newSet.add(key);
			}
		}
	} else {
		// Single toggle
		if (newSet.has(key)) {
			newSet.delete(key);
		} else {
			newSet.add(key);
		}
	}

	selectedKeys = newSet;
	lastClickedKey = key;
}

/**
 * Toggle all loaded items.
 */
function toggleAll() {
	const allKeys = loadedItems.map((item) => `${item.type}-${item.id}`);
	const allSelected = allKeys.every((key) => selectedKeys.has(key));

	if (allSelected) {
		// Deselect all
		selectedKeys = new Set();
	} else {
		// Select all loaded
		selectedKeys = new Set(allKeys);
	}
}

/**
 * Clear all selections.
 */
function clearSelection() {
	selectedKeys = new Set();
	lastClickedKey = null;
}

/**
 * Handle action completion (show toast/notification).
 */
function handleActionComplete(message: string) {
	toastStore.success(message);
}
</script>

<svelte:head>
	<title>Content Browser - Comradarr</title>
</svelte:head>

<div class="container mx-auto p-6 lg:p-8">
	<!-- Header -->
	<header class="mb-8 animate-float-up" style="animation-delay: 0ms;">
		<h1 class="font-display text-3xl font-semibold tracking-tight md:text-4xl">Content Browser</h1>
		<p class="text-muted-foreground mt-2">Browse and manage your library content</p>
	</header>

	<!-- Filters -->
	<div class="animate-float-up" style="animation-delay: 50ms;">
		<ContentFilters connectors={data.connectors} statusCounts={data.statusCounts} />
	</div>

	<!-- Bulk Action Bar (shown when items selected) -->
	<BulkActionBar
		{selectedCount}
		{selectedTargets}
		onClearSelection={clearSelection}
		onActionComplete={handleActionComplete}
	/>

	<!-- Content -->
	{#if loadedItems.length === 0}
		<div class="glass-panel p-8 text-center animate-float-up" style="animation-delay: 100ms;">
			<div class="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-glass/50 mb-4">
				<svg class="h-8 w-8 text-muted-foreground opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
				</svg>
			</div>
			<h2 class="text-lg font-medium mb-2">No content found</h2>
			<p class="text-muted-foreground text-sm">
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
		<VirtualizedContentTable
			items={loadedItems}
			{selectedKeys}
			onToggleSelection={toggleSelection}
			onToggleAll={toggleAll}
		/>

		<!-- Load More / Status -->
		<div class="flex flex-col items-center gap-4 mt-6">
			<p class="text-sm text-muted-foreground">
				Showing {loadedItems.length.toLocaleString()} of {data.total.toLocaleString()} items
			</p>

			<div class="flex items-center gap-2">
				{#if loadError}
					<div class="flex items-center gap-2 text-sm text-destructive">
						<span>{loadError}</span>
						<Button variant="outline" size="sm" onclick={loadMore}>Retry</Button>
					</div>
				{:else if hasMore}
					<Button variant="outline" size="sm" disabled={isLoadingMore} onclick={loadMore}>
						{#if isLoadingMore}
							<span class="animate-spin mr-2">&#8987;</span>
							Loading...
						{:else}
							Load More
						{/if}
					</Button>
				{:else if data.total > 0}
					<span class="text-sm text-muted-foreground"> All items loaded </span>
				{/if}

				{#if totalPages > 1}
					<Dialog.Root bind:open={jumpDialogOpen}>
						<Dialog.Trigger>
							{#snippet child({ props })}
								<Button variant="outline" size="sm" {...props}>Jump to Page</Button>
							{/snippet}
						</Dialog.Trigger>
						<Dialog.Content class="sm:max-w-[300px]">
							<Dialog.Header>
								<Dialog.Title>Jump to Page</Dialog.Title>
								<Dialog.Description>
									Enter a page number (1-{totalPages.toLocaleString()})
								</Dialog.Description>
							</Dialog.Header>
							<form
								onsubmit={(e) => {
									e.preventDefault();
									jumpToPage();
								}}
								class="space-y-4"
							>
								<div class="flex items-center gap-2">
									<span class="text-sm text-muted-foreground">Page</span>
									<Input
										type="number"
										min={1}
										max={totalPages}
										placeholder={currentPage.toString()}
										bind:value={jumpPageInput}
										class="w-24"
									/>
									<span class="text-sm text-muted-foreground">
										of {totalPages.toLocaleString()}
									</span>
								</div>
								<Dialog.Footer>
									<Dialog.Close>
										{#snippet child({ props })}
											<Button variant="outline" {...props}>Cancel</Button>
										{/snippet}
									</Dialog.Close>
									<Button type="submit">Go</Button>
								</Dialog.Footer>
							</form>
						</Dialog.Content>
					</Dialog.Root>
				{/if}
			</div>
		</div>
	{/if}
</div>
