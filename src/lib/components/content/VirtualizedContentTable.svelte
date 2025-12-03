<script lang="ts">
	import { createVirtualizer } from '@tanstack/svelte-virtual';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { Badge } from '$lib/components/ui/badge';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { cn } from '$lib/utils.js';
	import ContentStatusBadge from './ContentStatusBadge.svelte';
	import type { ContentItem } from '$lib/server/db/queries/content';

	/**
	 * Virtualized content table for large datasets.
	 * Uses TanStack Virtual to only render visible rows.
	 * Requirements: 17.1 (sortable columns), 17.5 (bulk selection)
	 */

	interface Props {
		items: ContentItem[];
		selectedKeys?: Set<string> | undefined;
		onToggleSelection?: ((key: string, shiftKey: boolean) => void) | undefined;
		onToggleAll?: (() => void) | undefined;
		maxHeight?: string;
	}

	let { items, selectedKeys, onToggleSelection, onToggleAll, maxHeight = '70vh' }: Props = $props();

	// Scroll container reference
	let scrollContainer: HTMLDivElement | null = $state(null);

	// Virtualizer configuration
	const ROW_HEIGHT = 52; // Height of each table row in pixels
	const OVERSCAN = 5; // Number of rows to render outside visible area

	// Create virtualizer - returns a Svelte store
	const virtualizerStore = $derived(
		scrollContainer
			? createVirtualizer({
					count: items.length,
					getScrollElement: () => scrollContainer,
					estimateSize: () => ROW_HEIGHT,
					overscan: OVERSCAN
				})
			: null
	);

	// Subscribe to the virtualizer store to get the current state
	// Use optional chaining as the store value may be null during initialization
	const virtualItems = $derived.by(() => {
		if (!virtualizerStore) return [];
		return $virtualizerStore?.getVirtualItems() ?? [];
	});
	const totalHeight = $derived.by(() => {
		if (!virtualizerStore) return 0;
		return $virtualizerStore?.getTotalSize() ?? 0;
	});

	// Computed selection states
	const selectionEnabled = $derived(selectedKeys !== undefined && onToggleSelection !== undefined);
	const allSelected = $derived(
		selectionEnabled && items.length > 0 && items.every((item) => selectedKeys!.has(getItemKey(item)))
	);
	const someSelected = $derived(
		selectionEnabled && items.some((item) => selectedKeys!.has(getItemKey(item))) && !allSelected
	);

	/**
	 * Gets the unique key for an item.
	 */
	function getItemKey(item: ContentItem): string {
		return `${item.type}-${item.id}`;
	}

	/**
	 * Handles checkbox click for row selection.
	 */
	function handleRowCheckboxClick(item: ContentItem, event: MouseEvent) {
		if (onToggleSelection) {
			onToggleSelection(getItemKey(item), event.shiftKey);
		}
	}

	// Get current sort state from URL
	const currentSort = $derived($page.url.searchParams.get('sort') ?? 'title');
	const currentOrder = $derived($page.url.searchParams.get('order') ?? 'asc');

	/**
	 * Toggles sort on a column.
	 */
	function toggleSort(column: string) {
		const params = new URLSearchParams($page.url.searchParams);

		if (currentSort === column) {
			params.set('order', currentOrder === 'asc' ? 'desc' : 'asc');
		} else {
			params.set('sort', column);
			params.set('order', 'asc');
		}

		goto(`/content?${params.toString()}`);
	}

	/**
	 * Gets sort indicator for column header.
	 */
	function getSortIndicator(column: string): string {
		if (currentSort !== column) return '';
		return currentOrder === 'asc' ? ' \u2191' : ' \u2193';
	}

	// Connector type colors (matching existing pattern)
	const typeColors: Record<string, string> = {
		sonarr: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
		radarr: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
		whisparr: 'bg-purple-500/10 text-purple-600 dark:text-purple-400'
	};
</script>

<div class="rounded-md border">
	<!-- Sticky header -->
	<div class="border-b bg-muted/50">
		<div class="flex items-center h-12 px-4 gap-4 text-sm font-medium text-muted-foreground">
			{#if selectionEnabled}
				<div class="w-8 flex-shrink-0">
					<Checkbox
						checked={allSelected}
						indeterminate={someSelected}
						onCheckedChange={() => onToggleAll?.()}
						aria-label={allSelected ? 'Deselect all items' : 'Select all visible items'}
					/>
				</div>
			{/if}
			<div
				class="flex-1 cursor-pointer select-none hover:text-foreground"
				onclick={() => toggleSort('title')}
				role="button"
				tabindex="0"
				onkeydown={(e) => e.key === 'Enter' && toggleSort('title')}
			>
				Title{getSortIndicator('title')}
			</div>
			<div class="w-20 flex-shrink-0">Type</div>
			<div
				class="w-32 flex-shrink-0 cursor-pointer select-none hover:text-foreground"
				onclick={() => toggleSort('connector')}
				role="button"
				tabindex="0"
				onkeydown={(e) => e.key === 'Enter' && toggleSort('connector')}
			>
				Connector{getSortIndicator('connector')}
			</div>
			<div class="w-40 flex-shrink-0">Content Status</div>
			<div class="w-24 flex-shrink-0">Search State</div>
		</div>
	</div>

	<!-- Virtualized scroll container -->
	<div
		bind:this={scrollContainer}
		class="overflow-auto"
		style="max-height: {maxHeight};"
	>
		<!-- Content area with total height for scroll -->
		<div style="height: {totalHeight}px; position: relative;">
			{#if items.length === 0}
				<div class="absolute inset-0 flex items-center justify-center text-muted-foreground py-8">
					No content found.
				</div>
			{:else}
				{#each virtualItems as virtualItem (virtualItem.key)}
					{@const item = items[virtualItem.index]}
					{#if item}
						{@const itemKey = getItemKey(item)}
						{@const isSelected = selectionEnabled && selectedKeys!.has(itemKey)}
						<div
							class={cn(
								'absolute left-0 right-0 flex items-center px-4 gap-4 border-b hover:bg-muted/50 transition-colors',
								isSelected && 'bg-muted/80'
							)}
							style="height: {ROW_HEIGHT}px; top: {virtualItem.start}px;"
							data-state={isSelected ? 'selected' : undefined}
						>
						{#if selectionEnabled}
							<div class="w-8 flex-shrink-0">
								<Checkbox
									checked={isSelected}
									onclick={(e: MouseEvent) => handleRowCheckboxClick(item, e)}
									aria-label={`Select ${item.title}`}
								/>
							</div>
						{/if}
						<div class="flex-1 min-w-0">
							<a
								href="/content/{item.type}/{item.id}"
								class="font-medium hover:underline hover:text-primary truncate block"
							>
								{item.title}
								{#if item.year}
									<span class="text-muted-foreground ml-1">({item.year})</span>
								{/if}
							</a>
						</div>
						<div class="w-20 flex-shrink-0">
							<span class="capitalize text-sm">{item.type}</span>
						</div>
						<div class="w-32 flex-shrink-0">
							<span
								class={cn(
									'rounded-md px-2 py-1 text-xs font-medium truncate inline-block max-w-full',
									typeColors[item.connectorType] ?? 'bg-gray-500/10 text-gray-600'
								)}
							>
								{item.connectorName}
							</span>
						</div>
						<div class="w-40 flex-shrink-0">
							<div class="flex gap-1 flex-wrap">
								{#if item.missingCount > 0}
									<Badge variant="destructive" class="text-xs">
										{item.missingCount} missing
									</Badge>
								{/if}
								{#if item.upgradeCount > 0}
									<Badge variant="secondary" class="text-xs">
										{item.upgradeCount} upgrade{item.upgradeCount > 1 ? 's' : ''}
									</Badge>
								{/if}
								{#if item.missingCount === 0 && item.upgradeCount === 0}
									<Badge variant="outline" class="text-xs">Complete</Badge>
								{/if}
							</div>
						</div>
						<div class="w-24 flex-shrink-0">
							<ContentStatusBadge state={item.searchState} />
						</div>
						</div>
					{/if}
				{/each}
			{/if}
		</div>
	</div>
</div>
