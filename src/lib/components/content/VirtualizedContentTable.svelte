<script lang="ts">
import { createVirtualizer } from '@tanstack/svelte-virtual';
import { goto } from '$app/navigation';
import { page } from '$app/stores';
import { Badge } from '$lib/components/ui/badge';
import { Checkbox } from '$lib/components/ui/checkbox';
import type { ContentItem } from '$lib/server/db/queries/content';
import { cn } from '$lib/utils.js';
import ContentStatusBadge from './ContentStatusBadge.svelte';

interface Props {
	items: ContentItem[];
	selectedKeys?: Set<string> | undefined;
	onToggleSelection?: ((key: string, shiftKey: boolean) => void) | undefined;
	onToggleAll?: (() => void) | undefined;
	maxHeight?: string;
}

let { items, selectedKeys, onToggleSelection, onToggleAll, maxHeight = '70vh' }: Props = $props();

let scrollContainer: HTMLDivElement | null = $state(null);

const ROW_HEIGHT = 52;
const OVERSCAN = 5;

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

const virtualItems = $derived.by(() => {
	if (!virtualizerStore) return [];
	return $virtualizerStore?.getVirtualItems() ?? [];
});
const totalHeight = $derived.by(() => {
	if (!virtualizerStore) return 0;
	return $virtualizerStore?.getTotalSize() ?? 0;
});

const selectionEnabled = $derived(selectedKeys !== undefined && onToggleSelection !== undefined);
const allSelected = $derived(
	selectionEnabled && items.length > 0 && items.every((item) => selectedKeys!.has(getItemKey(item)))
);
const someSelected = $derived(
	selectionEnabled && items.some((item) => selectedKeys!.has(getItemKey(item))) && !allSelected
);

function getItemKey(item: ContentItem): string {
	return `${item.type}-${item.id}`;
}

function handleRowCheckboxClick(item: ContentItem, event: MouseEvent) {
	if (onToggleSelection) {
		onToggleSelection(getItemKey(item), event.shiftKey);
	}
}

const currentSort = $derived($page.url.searchParams.get('sort') ?? 'title');
const currentOrder = $derived($page.url.searchParams.get('order') ?? 'asc');

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

function getSortIndicator(column: string): string {
	if (currentSort !== column) return '';
	return currentOrder === 'asc' ? ' \u2191' : ' \u2193';
}

const typeColors: Record<string, string> = {
	sonarr:
		'bg-[oklch(var(--accent-sonarr)/0.15)] text-[oklch(var(--accent-sonarr))] border border-[oklch(var(--accent-sonarr)/0.3)]',
	radarr:
		'bg-[oklch(var(--accent-radarr)/0.15)] text-[oklch(var(--accent-radarr))] border border-[oklch(var(--accent-radarr)/0.3)]',
	whisparr:
		'bg-[oklch(var(--accent-whisparr)/0.15)] text-[oklch(var(--accent-whisparr))] border border-[oklch(var(--accent-whisparr)/0.3)]'
};
</script>

<div class="glass-panel overflow-hidden animate-float-up" style="animation-delay: 100ms;">
	<!-- Sticky header -->
	<div class="border-b border-glass-border/30 bg-glass/50 backdrop-blur-sm">
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
	<div bind:this={scrollContainer} class="overflow-auto" style="max-height: {maxHeight};">
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
								'absolute left-0 right-0 flex items-center px-4 gap-4 border-b border-glass-border/20 hover:bg-glass/50 transition-all duration-200',
								isSelected && 'bg-primary/10 border-l-2 border-l-primary'
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
										'rounded-lg px-2.5 py-1 text-xs font-medium truncate inline-block max-w-full',
										typeColors[item.connectorType] ?? 'bg-muted text-muted-foreground border border-border'
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
								<ContentStatusBadge state={item.searchState} count={item.searchStateCount} />
							</div>
						</div>
					{/if}
				{/each}
			{/if}
		</div>
	</div>
</div>
