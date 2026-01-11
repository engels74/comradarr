<script lang="ts">
import { Badge } from '$lib/components/ui/badge';
import * as Card from '$lib/components/ui/card';
import OutcomeBadge from './OutcomeBadge.svelte';
import type { SerializedCompletion } from './types';

interface Props {
	completions: SerializedCompletion[];
	class?: string | undefined;
}

let { completions, class: className }: Props = $props();

const typeColors: Record<string, string> = {
	sonarr: 'bg-[oklch(var(--accent-sonarr)/0.15)] text-[oklch(var(--accent-sonarr))]',
	radarr: 'bg-[oklch(var(--accent-radarr)/0.15)] text-[oklch(var(--accent-radarr))]',
	whisparr: 'bg-[oklch(var(--accent-whisparr)/0.15)] text-[oklch(var(--accent-whisparr))]'
};

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

function getContentLink(completion: SerializedCompletion): string {
	if (completion.contentType === 'episode' && completion.seriesId) {
		return `/content/series/${completion.seriesId}`;
	}
	if (completion.contentType === 'movie') {
		return `/content/movie/${completion.contentId}`;
	}
	return '#';
}

function formatTitle(completion: SerializedCompletion): string {
	if (completion.contentType === 'episode') {
		const episode =
			completion.seasonNumber !== null && completion.episodeNumber !== null
				? `S${String(completion.seasonNumber).padStart(2, '0')}E${String(completion.episodeNumber).padStart(2, '0')}`
				: '';
		const title = completion.contentTitle ?? 'Unknown Episode';
		return episode ? `${episode} - ${title}` : title;
	}
	return completion.contentTitle ?? 'Unknown Movie';
}
</script>

<Card.Root variant="glass" class={className}>
	<Card.Header>
		<Card.Title class="text-lg font-display">Recent Completions</Card.Title>
		<Card.Description>
			Last {completions.length} completed search{completions.length !== 1 ? 'es' : ''}
		</Card.Description>
	</Card.Header>
	<Card.Content>
		{#if completions.length === 0}
			<div class="text-center py-8 text-muted-foreground">
				<div class="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-glass/50 mb-3">
					<svg class="h-6 w-6 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
					</svg>
				</div>
				<p class="font-medium">No recent completions yet.</p>
				<p class="text-sm mt-1 opacity-75">Completed searches will appear here.</p>
			</div>
		{:else}
			<div class="space-y-2">
				{#each completions as completion (completion.id)}
					{@const link = getContentLink(completion)}
					<div
						class="flex items-center justify-between gap-4 p-3 rounded-xl border border-glass-border/20 bg-glass/30 backdrop-blur-sm hover:bg-glass/50 transition-all duration-200"
					>
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
