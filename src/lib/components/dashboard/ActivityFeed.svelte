<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import OutcomeBadge from '$lib/components/queue/OutcomeBadge.svelte';
	import type { SerializedActivity } from './types';

	// Icons (direct imports for tree-shaking)
	import SearchIcon from '@lucide/svelte/icons/search';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import TvIcon from '@lucide/svelte/icons/tv';
	import FilmIcon from '@lucide/svelte/icons/film';
	import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
	import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';

	/**
	 * Activity feed component for the dashboard.
	 * Displays recent discoveries, search outcomes, and system events.
	 */

	interface Props {
		activities: SerializedActivity[];
		class?: string | undefined;
	}

	let { activities, class: className }: Props = $props();

	// Connector type badge colors
	const typeColors: Record<string, string> = {
		sonarr: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
		radarr: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
		whisparr: 'bg-purple-500/10 text-purple-600 dark:text-purple-400'
	};

	/**
	 * Format relative time for display.
	 */
	function formatRelativeTime(dateStr: string): string {
		const date = new Date(dateStr);
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
		const diffMins = Math.floor(diffMs / 60000);
		const diffHours = Math.floor(diffMs / 3600000);
		const diffDays = Math.floor(diffMs / 86400000);

		if (diffMins < 1) return 'just now';
		if (diffMins < 60) return `${diffMins}m ago`;
		if (diffHours < 24) return `${diffHours}h ago`;
		if (diffDays < 7) return `${diffDays}d ago`;
		return date.toLocaleDateString();
	}

	/**
	 * Get the activity icon component based on type.
	 */
	function getActivityIcon(activity: SerializedActivity) {
		if (activity.type === 'search') {
			return SearchIcon;
		}
		if (activity.type === 'discovery') {
			return EyeIcon;
		}
		return RefreshCwIcon;
	}

	/**
	 * Get the activity description text.
	 */
	function getActivityDescription(activity: SerializedActivity): string {
		if (activity.type === 'search') {
			const title = formatContentTitle(activity);
			return `Searched for ${title}`;
		}
		if (activity.type === 'discovery') {
			const title = formatContentTitle(activity);
			const typeLabel = activity.searchType === 'gap' ? 'missing' : 'upgrade candidate';
			return `Discovered ${typeLabel}: ${title}`;
		}
		// Sync
		return `Synced ${activity.connectorName}`;
	}

	/**
	 * Format content title for display.
	 */
	function formatContentTitle(activity: SerializedActivity): string {
		if (activity.contentType === 'episode') {
			const episode =
				activity.seasonNumber !== undefined && activity.episodeNumber !== undefined
					? `S${String(activity.seasonNumber).padStart(2, '0')}E${String(activity.episodeNumber).padStart(2, '0')}`
					: '';
			const title = activity.contentTitle ?? 'Unknown Episode';
			const series = activity.seriesTitle ?? '';
			if (series && episode) return `${series} ${episode}`;
			if (series) return series;
			return title;
		}
		return activity.contentTitle ?? 'Unknown Movie';
	}

	/**
	 * Get content type icon.
	 */
	function getContentIcon(activity: SerializedActivity) {
		if (activity.contentType === 'episode') {
			return TvIcon;
		}
		if (activity.contentType === 'movie') {
			return FilmIcon;
		}
		return null;
	}

	/**
	 * Get discovery type color class.
	 */
	function getDiscoveryColor(searchType: string | undefined): string {
		if (searchType === 'gap') {
			return 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400';
		}
		if (searchType === 'upgrade') {
			return 'bg-blue-500/20 text-blue-600 dark:text-blue-400';
		}
		return 'bg-gray-500/20 text-gray-600 dark:text-gray-400';
	}

	/**
	 * Get background color class for activity icon container.
	 */
	function getIconBgClass(activity: SerializedActivity): string {
		if (activity.type === 'search' && activity.outcome === 'success') {
			return 'bg-green-500/10';
		}
		if (activity.type === 'discovery') {
			return 'bg-blue-500/10';
		}
		if (activity.type === 'sync') {
			return 'bg-gray-500/10';
		}
		return 'bg-muted';
	}

	/**
	 * Get text color class for activity icon.
	 */
	function getIconTextClass(activity: SerializedActivity): string {
		if (activity.type === 'search' && activity.outcome === 'success') {
			return 'text-green-600 dark:text-green-400';
		}
		if (activity.type === 'discovery') {
			return 'text-blue-600 dark:text-blue-400';
		}
		if (activity.type === 'sync') {
			return 'text-gray-600 dark:text-gray-400';
		}
		return 'text-muted-foreground';
	}
</script>

<Card.Root class={className}>
	<Card.Header>
		<Card.Title class="text-lg">Recent Activity</Card.Title>
		<Card.Description>
			{activities.length} recent event{activities.length !== 1 ? 's' : ''} in your library
		</Card.Description>
	</Card.Header>
	<Card.Content>
		{#if activities.length === 0}
			<div class="text-center py-8 text-muted-foreground">
				<AlertCircleIcon class="h-8 w-8 mx-auto mb-2 opacity-50" />
				<p>No recent activity yet.</p>
				<p class="text-sm mt-1">Activity will appear here as searches and discoveries occur.</p>
			</div>
		{:else}
			<div class="space-y-3">
				{#each activities as activity (activity.id)}
					{@const ActivityIcon = getActivityIcon(activity)}
					{@const ContentIcon = getContentIcon(activity)}
					<div
						class="flex items-center justify-between gap-4 p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
					>
						<!-- Activity icon -->
						<div class="shrink-0">
							<div
								class="h-8 w-8 rounded-full flex items-center justify-center {getIconBgClass(
									activity
								)}"
							>
								<ActivityIcon class="h-4 w-4 {getIconTextClass(activity)}" />
							</div>
						</div>

						<!-- Activity info -->
						<div class="flex-1 min-w-0">
							<div class="flex items-center gap-2">
								{#if ContentIcon}
									<ContentIcon class="h-3.5 w-3.5 text-muted-foreground shrink-0" />
								{/if}
								<p class="font-medium text-sm truncate">
									{getActivityDescription(activity)}
								</p>
							</div>
							{#if activity.type === 'search' && activity.contentType === 'episode' && activity.contentTitle}
								<p class="text-xs text-muted-foreground truncate">
									{activity.contentTitle}
								</p>
							{/if}
						</div>

						<!-- Connector badge (if applicable) -->
						{#if activity.connectorName && activity.connectorType && activity.type !== 'sync'}
							<Badge
								variant="outline"
								class="shrink-0 text-xs {typeColors[activity.connectorType] ?? ''}"
							>
								{activity.connectorName}
							</Badge>
						{/if}

						<!-- Outcome/Type badge -->
						{#if activity.type === 'search' && activity.outcome}
							<OutcomeBadge outcome={activity.outcome} class="shrink-0" />
						{:else if activity.type === 'discovery' && activity.searchType}
							<span
								class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium shrink-0 {getDiscoveryColor(
									activity.searchType
								)}"
							>
								{#if activity.searchType === 'upgrade'}
									<ArrowUpIcon class="h-3 w-3" />
								{/if}
								{activity.searchType === 'gap' ? 'Missing' : 'Upgrade'}
							</span>
						{:else if activity.type === 'sync'}
							<span
								class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium shrink-0 bg-green-500/20 text-green-600 dark:text-green-400"
							>
								<RefreshCwIcon class="h-3 w-3" />
								Synced
							</span>
						{/if}

						<!-- Time -->
						<span class="text-xs text-muted-foreground shrink-0 w-16 text-right">
							{formatRelativeTime(activity.timestamp)}
						</span>
					</div>
				{/each}
			</div>
		{/if}
	</Card.Content>
</Card.Root>
