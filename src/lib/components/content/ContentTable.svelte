<script lang="ts">
import { goto } from '$app/navigation';
import { page } from '$app/stores';
import { Badge } from '$lib/components/ui/badge';
import { Checkbox } from '$lib/components/ui/checkbox';
import * as Table from '$lib/components/ui/table';
import type { ContentItem } from '$lib/server/db/queries/content';
import { cn } from '$lib/utils.js';
import ContentStatusBadge from './ContentStatusBadge.svelte';

/**
 * Content table with sortable columns and selection support.
 */

interface Props {
	items: ContentItem[];
	selectedKeys?: Set<string> | undefined;
	onToggleSelection?: ((key: string, shiftKey: boolean) => void) | undefined;
	onToggleAll?: (() => void) | undefined;
}

let { items, selectedKeys, onToggleSelection, onToggleAll }: Props = $props();

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
		// Toggle direction
		params.set('order', currentOrder === 'asc' ? 'desc' : 'asc');
	} else {
		// New column, default to ascending
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

// Connector type colors (matching existing ConnectorCard pattern)
const typeColors: Record<string, string> = {
	sonarr: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
	radarr: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
	whisparr: 'bg-purple-500/10 text-purple-600 dark:text-purple-400'
};
</script>

<div class="rounded-md border">
	<Table.Root>
		<Table.Header>
			<Table.Row>
				{#if selectionEnabled}
					<Table.Head class="w-[40px]">
						<Checkbox
							checked={allSelected}
							indeterminate={someSelected}
							onCheckedChange={() => onToggleAll?.()}
							aria-label={allSelected ? 'Deselect all items' : 'Select all visible items'}
						/>
					</Table.Head>
				{/if}
				<Table.Head
					class="cursor-pointer select-none hover:bg-muted/50"
					onclick={() => toggleSort('title')}
				>
					Title{getSortIndicator('title')}
				</Table.Head>
				<Table.Head>Type</Table.Head>
				<Table.Head
					class="cursor-pointer select-none hover:bg-muted/50"
					onclick={() => toggleSort('connector')}
				>
					Connector{getSortIndicator('connector')}
				</Table.Head>
				<Table.Head>Content Status</Table.Head>
				<Table.Head>Search State</Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each items as item (getItemKey(item))}
				{@const itemKey = getItemKey(item)}
				{@const isSelected = selectionEnabled && selectedKeys!.has(itemKey)}
				<Table.Row data-state={isSelected ? 'selected' : undefined}>
					{#if selectionEnabled}
						<Table.Cell>
							<Checkbox
								checked={isSelected}
								onclick={(e: MouseEvent) => handleRowCheckboxClick(item, e)}
								aria-label={`Select ${item.title}`}
							/>
						</Table.Cell>
					{/if}
					<Table.Cell class="font-medium">
						<a href="/content/{item.type}/{item.id}" class="hover:underline hover:text-primary">
							{item.title}
							{#if item.year}
								<span class="text-muted-foreground ml-1">({item.year})</span>
							{/if}
						</a>
					</Table.Cell>
					<Table.Cell>
						<span class="capitalize text-sm">{item.type}</span>
					</Table.Cell>
					<Table.Cell>
						<span
							class={cn(
								'rounded-md px-2 py-1 text-xs font-medium',
								typeColors[item.connectorType] ?? 'bg-gray-500/10 text-gray-600'
							)}
						>
							{item.connectorName}
						</span>
					</Table.Cell>
					<Table.Cell>
						<div class="flex gap-1 flex-wrap">
							{#if item.missingCount > 0}
								<Badge variant="destructive">
									{item.missingCount} missing
								</Badge>
							{/if}
							{#if item.upgradeCount > 0}
								<Badge variant="secondary">
									{item.upgradeCount} upgrade{item.upgradeCount > 1 ? 's' : ''}
								</Badge>
							{/if}
							{#if item.missingCount === 0 && item.upgradeCount === 0}
								<Badge variant="outline">Complete</Badge>
							{/if}
						</div>
					</Table.Cell>
					<Table.Cell>
						<ContentStatusBadge state={item.searchState} />
					</Table.Cell>
				</Table.Row>
			{:else}
				<Table.Row>
					<Table.Cell
						colspan={selectionEnabled ? 6 : 5}
						class="h-24 text-center text-muted-foreground"
					>
						No content found.
					</Table.Cell>
				</Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>
</div>
