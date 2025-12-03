<script lang="ts">
	import { createVirtualizer } from '@tanstack/svelte-virtual';
	import { Badge } from '$lib/components/ui/badge';
	import { cn } from '$lib/utils.js';
	import QueueStateBadge from './QueueStateBadge.svelte';
	import type { QueueItemWithContent, QueueThrottleInfo } from '$lib/server/db/queries/queue';

	/**
	 * Virtualized queue table for large datasets.
	 * Uses TanStack Virtual to only render visible rows.
	 * Requirements: 18.1 (priority order, dispatch time, processing indicator)
	 */

	interface SerializedQueueItem {
		id: number;
		searchRegistryId: number;
		connectorId: number;
		connectorName: string;
		connectorType: string;
		contentType: 'episode' | 'movie';
		contentId: number;
		title: string;
		seriesTitle: string | null;
		seasonNumber: number | null;
		episodeNumber: number | null;
		year: number | null;
		searchType: 'gap' | 'upgrade';
		state: 'pending' | 'queued' | 'searching' | 'cooldown' | 'exhausted';
		priority: number;
		attemptCount: number;
		scheduledAt: string | null;
		createdAt: string;
	}

	interface SerializedThrottleInfo {
		connectorId: number;
		isPaused: boolean;
		pausedUntil: string | null;
		pauseReason: string | null;
		requestsPerMinute: number;
		requestsThisMinute: number;
		dailyBudget: number | null;
		requestsToday: number;
	}

	interface Props {
		items: SerializedQueueItem[];
		throttleInfo: Record<number, SerializedThrottleInfo>;
		maxHeight?: string | undefined;
	}

	let { items, throttleInfo, maxHeight = '70vh' }: Props = $props();

	// Scroll container reference
	let scrollContainer: HTMLDivElement | null = $state(null);

	// Virtualizer configuration
	const ROW_HEIGHT = 60;
	const OVERSCAN = 5;

	// Create virtualizer
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

	// Connector type colors
	const typeColors: Record<string, string> = {
		sonarr: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
		radarr: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
		whisparr: 'bg-purple-500/10 text-purple-600 dark:text-purple-400'
	};

	/**
	 * Formats the display title for an item.
	 */
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

	/**
	 * Gets the link to the content detail page.
	 */
	function getContentLink(item: SerializedQueueItem): string {
		if (item.contentType === 'episode') {
			// For episodes, we link to the series page
			// Note: We'd need series ID, but for now link to content browser
			return `/content?search=${encodeURIComponent(item.seriesTitle ?? item.title)}`;
		}
		return `/content/movie/${item.contentId}`;
	}

	/**
	 * Estimates dispatch time based on queue position and throttle info.
	 */
	function estimateDispatchTime(item: SerializedQueueItem, index: number): string {
		const info = throttleInfo[item.connectorId];

		// If searching, it's in progress
		if (item.state === 'searching') {
			return 'In progress';
		}

		// If not queued, no dispatch time
		if (item.state !== 'queued') {
			return '-';
		}

		// If no throttle info, use scheduled time
		if (!info) {
			if (!item.scheduledAt) return 'Unknown';
			return formatRelativeTime(new Date(item.scheduledAt));
		}

		// If paused, show paused state
		if (info.isPaused) {
			if (info.pausedUntil) {
				return `Paused until ${formatTime(new Date(info.pausedUntil))}`;
			}
			return 'Paused';
		}

		// Calculate estimated dispatch based on position and rate
		const requestsPerMinute = info.requestsPerMinute || 5;
		const minutesAhead = Math.ceil((index + 1) / requestsPerMinute);

		if (minutesAhead <= 1) {
			return 'Next';
		}

		const dispatchTime = new Date(Date.now() + minutesAhead * 60000);
		return formatRelativeTime(dispatchTime);
	}

	/**
	 * Formats a relative time string.
	 */
	function formatRelativeTime(date: Date): string {
		const now = Date.now();
		const diff = date.getTime() - now;

		if (diff <= 0) {
			return 'Now';
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

	/**
	 * Formats a time for display.
	 */
	function formatTime(date: Date): string {
		return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
	}

	/**
	 * Max attempts for exhausted calculation display.
	 */
	const MAX_ATTEMPTS = 5;
</script>

<div class="rounded-md border">
	<!-- Sticky header -->
	<div class="border-b bg-muted/50">
		<div class="flex items-center h-12 px-4 gap-4 text-sm font-medium text-muted-foreground">
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
	<div
		bind:this={scrollContainer}
		class="overflow-auto"
		style="max-height: {maxHeight};"
	>
		<!-- Content area with total height for scroll -->
		<div style="height: {totalHeight}px; position: relative;">
			{#if items.length === 0}
				<div class="absolute inset-0 flex items-center justify-center text-muted-foreground py-8">
					No queue items found.
				</div>
			{:else}
				{#each virtualItems as virtualItem (virtualItem.key)}
					{@const item = items[virtualItem.index]}
					{#if item}
						<div
							class="absolute left-0 right-0 flex items-center px-4 gap-4 border-b hover:bg-muted/50 transition-colors"
							style="height: {ROW_HEIGHT}px; top: {virtualItem.start}px;"
						>
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
										'rounded-md px-2 py-1 text-xs font-medium truncate inline-block max-w-full',
										typeColors[item.connectorType] ?? 'bg-gray-500/10 text-gray-600'
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
								<QueueStateBadge state={item.state} />
							</div>

							<!-- Attempts -->
							<div class="w-16 flex-shrink-0 text-center">
								<span
									class={cn(
										'text-sm',
										item.attemptCount >= MAX_ATTEMPTS && 'text-red-500'
									)}
								>
									{item.attemptCount}/{MAX_ATTEMPTS}
								</span>
							</div>

							<!-- Estimated Dispatch -->
							<div class="w-28 flex-shrink-0 text-right">
								<span
									class={cn(
										'text-sm',
										item.state === 'searching' && 'text-yellow-600 dark:text-yellow-400 font-medium'
									)}
								>
									{estimateDispatchTime(item, virtualItem.index)}
								</span>
							</div>
						</div>
					{/if}
				{/each}
			{/if}
		</div>
	</div>
</div>
