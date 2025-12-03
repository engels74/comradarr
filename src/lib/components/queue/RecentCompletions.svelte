<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import OutcomeBadge from './OutcomeBadge.svelte';
	import type { SerializedCompletion } from './types';

	/**
	 * Recent completions display component.
	 * Shows the last N completed searches with outcome indicators.
	 *
	 * Requirements: 18.4
	 */

	interface Props {
		completions: SerializedCompletion[];
		class?: string | undefined;
	}

	let { completions, class: className }: Props = $props();

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
	 * Get the content link URL.
	 */
	function getContentLink(completion: SerializedCompletion): string {
		if (completion.contentType === 'episode' && completion.seriesId) {
			return `/content/series/${completion.seriesId}`;
		}
		if (completion.contentType === 'movie') {
			return `/content/movies/${completion.contentId}`;
		}
		return '#';
	}

	/**
	 * Format content title for display.
	 */
	function formatTitle(completion: SerializedCompletion): string {
		if (completion.contentType === 'episode') {
			const episode = completion.seasonNumber !== null && completion.episodeNumber !== null
				? `S${String(completion.seasonNumber).padStart(2, '0')}E${String(completion.episodeNumber).padStart(2, '0')}`
				: '';
			const title = completion.contentTitle ?? 'Unknown Episode';
			return episode ? `${episode} - ${title}` : title;
		}
		return completion.contentTitle ?? 'Unknown Movie';
	}
</script>

<Card.Root class={className}>
	<Card.Header>
		<Card.Title class="text-lg">Recent Completions</Card.Title>
		<Card.Description>
			Last {completions.length} completed search{completions.length !== 1 ? 'es' : ''}
		</Card.Description>
	</Card.Header>
	<Card.Content>
		{#if completions.length === 0}
			<div class="text-center py-8 text-muted-foreground">
				<p>No recent completions yet.</p>
				<p class="text-sm mt-1">Completed searches will appear here.</p>
			</div>
		{:else}
			<div class="space-y-3">
				{#each completions as completion (completion.id)}
					{@const link = getContentLink(completion)}
					<div class="flex items-center justify-between gap-4 p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors">
						<!-- Content info -->
						<div class="flex-1 min-w-0">
							<div class="flex items-center gap-2">
								{#if completion.contentType === 'episode' && completion.seriesTitle}
									<a href={link} class="font-medium text-sm truncate hover:underline">
										{completion.seriesTitle}
									</a>
								{:else}
									<a href={link} class="font-medium text-sm truncate hover:underline">
										{formatTitle(completion)}
									</a>
								{/if}
							</div>
							{#if completion.contentType === 'episode'}
								<p class="text-xs text-muted-foreground truncate">
									{formatTitle(completion)}
								</p>
							{/if}
						</div>

						<!-- Connector badge -->
						<Badge
							variant="outline"
							class="shrink-0 text-xs {typeColors[completion.connectorType] ?? ''}"
						>
							{completion.connectorName}
						</Badge>

						<!-- Outcome -->
						<OutcomeBadge outcome={completion.outcome} class="shrink-0" />

						<!-- Time -->
						<span class="text-xs text-muted-foreground shrink-0 w-16 text-right">
							{formatRelativeTime(completion.createdAt)}
						</span>
					</div>
				{/each}
			</div>
		{/if}
	</Card.Content>
</Card.Root>
