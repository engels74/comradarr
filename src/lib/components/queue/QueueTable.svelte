<script lang="ts">
import ClockIcon from '@lucide/svelte/icons/clock';
import { createVirtualizer } from '@tanstack/svelte-virtual';
import { Badge } from '$lib/components/ui/badge';
import { Checkbox } from '$lib/components/ui/checkbox';
import { cn } from '$lib/utils.js';
import QueueStateBadge from './QueueStateBadge.svelte';
import type { QueueSchedulerStatus, SerializedQueueItem, SerializedThrottleInfo } from './types';

interface Props {
	items: SerializedQueueItem[];
	throttleInfo: Record<number, SerializedThrottleInfo>;
	schedulerStatus?: QueueSchedulerStatus;
	maxHeight?: string | undefined;
	selectedIds?: Set<number> | undefined;
	onSelectionChange?: ((ids: Set<number>) => void) | undefined;
}

let {
	items,
	throttleInfo,
	schedulerStatus,
	maxHeight = '70vh',
	selectedIds = new Set(),
	onSelectionChange
}: Props = $props();

const isAllSelected = $derived(
	items.length > 0 && items.every((item) => selectedIds.has(item.searchRegistryId))
);
const isSomeSelected = $derived(items.some((item) => selectedIds.has(item.searchRegistryId)));
const isIndeterminate = $derived(isSomeSelected && !isAllSelected);

function toggleSelection(registryId: number) {
	const newSet = new Set(selectedIds);
	if (newSet.has(registryId)) {
		newSet.delete(registryId);
	} else {
		newSet.add(registryId);
	}
	onSelectionChange?.(newSet);
}

function toggleAll() {
	if (isAllSelected) {
		const newSet = new Set(selectedIds);
		for (const item of items) {
			newSet.delete(item.searchRegistryId);
		}
		onSelectionChange?.(newSet);
	} else {
		const newSet = new Set(selectedIds);
		for (const item of items) {
			newSet.add(item.searchRegistryId);
		}
		onSelectionChange?.(newSet);
	}
}

function handleRowClick(e: MouseEvent, registryId: number) {
	// Don't toggle if clicking on a link or checkbox
	const target = e.target as HTMLElement;
	if (
		target.tagName === 'A' ||
		target.closest('a') ||
		target.tagName === 'BUTTON' ||
		target.closest('button')
	) {
		return;
	}
	toggleSelection(registryId);
}

let scrollContainer: HTMLDivElement | null = $state(null);

const ROW_HEIGHT = 60;
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

const typeColors: Record<string, string> = {
	sonarr:
		'bg-[oklch(var(--accent-sonarr)/0.15)] text-[oklch(var(--accent-sonarr))] border border-[oklch(var(--accent-sonarr)/0.3)]',
	radarr:
		'bg-[oklch(var(--accent-radarr)/0.15)] text-[oklch(var(--accent-radarr))] border border-[oklch(var(--accent-radarr)/0.3)]',
	whisparr:
		'bg-[oklch(var(--accent-whisparr)/0.15)] text-[oklch(var(--accent-whisparr))] border border-[oklch(var(--accent-whisparr)/0.3)]'
};

function formatTitle(item: SerializedQueueItem): string {
	if (item.contentType === 'episode' && item.seriesTitle) {
		const episodeCode = `S${String(item.seasonNumber ?? 0).padStart(2, '0')}E${String(item.episodeNumber ?? 0).padStart(2, '0')}`;
		return `${item.seriesTitle} - ${episodeCode} - ${item.title}`;
	}
	if (item.contentType === 'movie' && item.year) {
		return `${item.title} (${item.year})`;
	}
	return item.title;
}

function getContentLink(item: SerializedQueueItem): string {
	if (item.contentType === 'episode') {
		// For episodes, we link to the series page
		// Note: We'd need series ID, but for now link to content browser
		return `/content?search=${encodeURIComponent(item.seriesTitle ?? item.title)}`;
	}
	return `/content/movie/${item.contentId}`;
}

interface DispatchEstimate {
	text: string;
	showClock: boolean;
	isMono: boolean;
}

function estimateDispatchTime(item: SerializedQueueItem, index: number): DispatchEstimate {
	const info = throttleInfo[item.connectorId];

	if (item.state === 'searching') {
		return { text: 'In progress', showClock: false, isMono: false };
	}

	if (item.state === 'cooldown' && item.nextEligible) {
		const until = new Date(item.nextEligible);
		return { text: `Retry ${formatRelativeTime(until)}`, showClock: false, isMono: false };
	}

	if (item.state === 'exhausted') {
		return { text: 'Max attempts', showClock: false, isMono: false };
	}

	if (item.state === 'pending') {
		if (schedulerStatus?.sweep.nextRun) {
			const diff = new Date(schedulerStatus.sweep.nextRun).getTime() - Date.now();
			if (diff > 0) {
				const seconds = Math.floor(diff / 1000);
				if (seconds < 60) {
					return { text: `${seconds}s`, showClock: true, isMono: true };
				}
				const minutes = Math.ceil(diff / 60000);
				return {
					text: minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`,
					showClock: true,
					isMono: true
				};
			}
		}
		return { text: 'Enqueuing soon', showClock: true, isMono: false };
	}

	if (item.state !== 'queued') {
		return { text: '-', showClock: false, isMono: false };
	}

	if (!info) {
		if (!item.scheduledAt) return { text: 'Unknown', showClock: false, isMono: false };
		return {
			text: formatRelativeTime(new Date(item.scheduledAt)),
			showClock: false,
			isMono: false
		};
	}

	if (info.isPaused) {
		if (info.pausedUntil) {
			return {
				text: `Paused until ${formatTime(new Date(info.pausedUntil))}`,
				showClock: false,
				isMono: false
			};
		}
		return { text: 'Paused', showClock: false, isMono: false };
	}
	const requestsPerMinute = info.requestsPerMinute || 5;
	const minutesAhead = Math.ceil((index + 1) / requestsPerMinute);

	if (minutesAhead <= 1) {
		return { text: 'Next', showClock: false, isMono: false };
	}

	const dispatchTime = new Date(Date.now() + minutesAhead * 60000);
	return { text: formatRelativeTime(dispatchTime), showClock: false, isMono: false };
}

function formatRelativeTime(date: Date): string {
	const now = Date.now();
	const diff = date.getTime() - now;

	if (diff <= 0) {
		return 'Now';
	}

	const seconds = Math.floor(diff / 1000);
	if (seconds < 60) {
		return `in ${seconds}s`;
	}

	const minutes = Math.floor(diff / 60000);
	if (minutes < 60) {
		return minutes === 1 ? 'in 1 min' : `in ${minutes} mins`;
	}

	const hours = Math.floor(minutes / 60);
	if (hours < 24) {
		return hours === 1 ? 'in 1 hour' : `in ${hours} hours`;
	}

	const days = Math.floor(hours / 24);
	return days === 1 ? 'in 1 day' : `in ${days} days`;
}

function formatTime(date: Date): string {
	return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

const MAX_ATTEMPTS = 5;
</script>

<div class="glass-panel overflow-hidden animate-float-up" style="animation-delay: 100ms;">
	<!-- Sticky header -->
	<div class="border-b border-glass-border/30 bg-glass/50 backdrop-blur-sm">
		<div class="flex items-center h-12 px-4 gap-4 text-sm font-medium text-muted-foreground">
			<!-- Select all checkbox -->
			<div class="w-6 flex-shrink-0">
				<Checkbox
					checked={isAllSelected}
					indeterminate={isIndeterminate}
					onCheckedChange={toggleAll}
					aria-label="Select all"
				/>
			</div>
			<div class="flex-1 min-w-0">Title</div>
			<div class="w-28 flex-shrink-0">Connector</div>
			<div class="w-20 flex-shrink-0">Type</div>
			<div class="w-16 flex-shrink-0 text-right">Priority</div>
			<div class="w-24 flex-shrink-0">State</div>
			<div class="w-16 flex-shrink-0 text-center">Attempts</div>
			<div class="w-28 flex-shrink-0 text-right">Est. Dispatch</div>
		</div>
	</div>

	<!-- Virtualized scroll container -->
	<div bind:this={scrollContainer} class="overflow-auto" style="max-height: {maxHeight};">
		<!-- Content area with total height for scroll -->
		<div style="height: {totalHeight}px; position: relative;">
			{#if items.length === 0}
				<div class="absolute inset-0 flex items-center justify-center text-muted-foreground py-8">
					No queue items found.
				</div>
			{:else}
				{#each virtualItems as virtualItem (virtualItem.key)}
					{@const item = items[virtualItem.index]}
					{@const isSelected = selectedIds.has(item?.searchRegistryId ?? -1)}
					{#if item}
						<div
							class={cn(
								'absolute left-0 right-0 flex items-center px-4 gap-4 border-b border-glass-border/20 transition-all duration-200 cursor-pointer hover:bg-glass/50',
								isSelected && 'bg-primary/10 border-l-2 border-l-primary'
							)}
							style="height: {ROW_HEIGHT}px; top: {virtualItem.start}px;"
							onclick={(e) => handleRowClick(e, item.searchRegistryId)}
							onkeydown={(e) => e.key === 'Enter' && toggleSelection(item.searchRegistryId)}
							role="row"
							tabindex="0"
						>
							<!-- Row checkbox -->
							<div class="w-6 flex-shrink-0">
								<Checkbox
									checked={isSelected}
									onCheckedChange={() => toggleSelection(item.searchRegistryId)}
									aria-label="Select {formatTitle(item)}"
								/>
							</div>
							<!-- Title -->
							<div class="flex-1 min-w-0">
								<a
									href={getContentLink(item)}
									class="font-medium hover:underline hover:text-primary truncate block text-sm"
									title={formatTitle(item)}
								>
									{formatTitle(item)}
								</a>
								<span class="text-xs text-muted-foreground">
									{item.contentType === 'episode' ? 'Episode' : 'Movie'}
									&middot;
									{item.searchType === 'gap' ? 'Missing' : 'Upgrade'}
								</span>
							</div>

							<!-- Connector -->
							<div class="w-28 flex-shrink-0">
								<span
									class={cn(
										'rounded-lg px-2.5 py-1 text-xs font-medium truncate inline-block max-w-full',
										typeColors[item.connectorType] ?? 'bg-muted text-muted-foreground border border-border'
									)}
								>
									{item.connectorName}
								</span>
							</div>

							<!-- Search Type Badge -->
							<div class="w-20 flex-shrink-0">
								<Badge
									variant={item.searchType === 'gap' ? 'destructive' : 'secondary'}
									class="text-xs"
								>
									{item.searchType === 'gap' ? 'Gap' : 'Upgrade'}
								</Badge>
							</div>

							<!-- Priority -->
							<div class="w-16 flex-shrink-0 text-right">
								<span class="text-sm font-mono" title={`Priority score: ${item.priority}`}>
									{item.priority}
								</span>
							</div>

							<!-- State -->
							<div class="w-24 flex-shrink-0">
								<QueueStateBadge state={item.state} cooldownUntil={item.nextEligible} />
							</div>

							<!-- Attempts -->
							<div class="w-16 flex-shrink-0 text-center">
								<span class={cn('text-sm', item.attemptCount >= MAX_ATTEMPTS && 'text-red-500')}>
									{item.attemptCount}/{MAX_ATTEMPTS}
								</span>
							</div>

							<!-- Estimated Dispatch -->
							<div class="w-28 flex-shrink-0 text-right">
								{#snippet dispatchDisplay()}
									{@const dispatch = estimateDispatchTime(item, virtualItem.index)}
									<span
										class={cn(
											'text-sm inline-flex items-center justify-end gap-1',
											item.state === 'searching' && 'text-yellow-600 dark:text-yellow-400 font-medium',
											item.state === 'pending' && 'text-muted-foreground',
											dispatch.isMono && 'font-mono'
										)}
										title={item.state === 'pending' ? 'Will be added to queue on next sweep' : undefined}
									>
										{#if dispatch.showClock}
											<ClockIcon class="h-3 w-3 flex-shrink-0" />
										{/if}
										{dispatch.text}
									</span>
								{/snippet}
								{@render dispatchDisplay()}
							</div>
						</div>
					{/if}
				{/each}
			{/if}
		</div>
	</div>
</div>
