<!--
  Movie detail page.
  Displays movie metadata, current quality, search history, and lastSearchTime.
-->
<script lang="ts">
import { Badge } from '$lib/components/ui/badge';
import * as Card from '$lib/components/ui/card';
import * as Table from '$lib/components/ui/table';
import { cn } from '$lib/utils.js';
import type { PageProps } from './$types';

let { data }: PageProps = $props();

// Connector type badge colors (matching existing pattern)
const typeColors: Record<string, string> = {
	sonarr: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
	radarr: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
	whisparr: 'bg-purple-500/10 text-purple-600 dark:text-purple-400'
};

const typeColor = $derived(typeColors[data.movie.connectorType] ?? 'bg-gray-500/10 text-gray-600');

// Format movie year for display
const yearDisplay = $derived(data.movie.year ? `(${data.movie.year})` : '');

// Compute movie status
const movieStatus = $derived(() => {
	if (!data.movie.hasFile) {
		return { label: 'Missing', variant: 'destructive' as const };
	}
	if (data.movie.qualityCutoffNotMet) {
		return { label: 'Upgrade', variant: 'secondary' as const };
	}
	return { label: 'Downloaded', variant: 'default' as const };
});

// Outcome badge styling (matching series detail pattern)
function getOutcomeBadgeVariant(
	outcome: string
): 'default' | 'secondary' | 'destructive' | 'outline' {
	switch (outcome) {
		case 'success':
			return 'default';
		case 'no_results':
			return 'secondary';
		case 'error':
		case 'timeout':
			return 'destructive';
		default:
			return 'outline';
	}
}

function formatOutcome(outcome: string): string {
	switch (outcome) {
		case 'success':
			return 'Success';
		case 'no_results':
			return 'No Results';
		case 'error':
			return 'Error';
		case 'timeout':
			return 'Timeout';
		default:
			return outcome;
	}
}

// Format quality for display
function formatQuality(quality: unknown): string {
	if (!quality) return 'N/A';
	const q = quality as { quality?: { name?: string } };
	return q.quality?.name ?? 'N/A';
}

// Format last search time
function formatLastSearchTime(date: Date | null): string {
	if (!date) return 'Never';
	return new Date(date).toLocaleString();
}
</script>

<svelte:head>
	<title>{data.movie.title} - Content - Comradarr</title>
</svelte:head>

<div class="container mx-auto p-6">
	<!-- Back navigation -->
	<div class="mb-6">
		<a href="/content" class="text-sm text-muted-foreground hover:text-foreground">
			&larr; Back to Content Browser
		</a>
	</div>

	<!-- Header -->
	<div class="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
		<div class="flex flex-wrap items-center gap-3">
			<h1 class="text-3xl font-bold">
				{data.movie.title}
				{#if yearDisplay}
					<span class="text-muted-foreground">{yearDisplay}</span>
				{/if}
			</h1>
			<span class={cn('rounded-md px-2 py-1 text-xs font-medium', typeColor)}>
				{data.movie.connectorName}
			</span>
			<Badge variant={movieStatus().variant}>
				{movieStatus().label}
			</Badge>
			{#if !data.movie.monitored}
				<Badge variant="outline">Unmonitored</Badge>
			{/if}
		</div>
	</div>

	<!-- Main content grid -->
	<div class="grid gap-6 lg:grid-cols-2">
		<!-- Movie Metadata Card -->
		<Card.Root>
			<Card.Header>
				<Card.Title>Movie Information</Card.Title>
			</Card.Header>
			<Card.Content class="space-y-4">
				<div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
					<span class="text-muted-foreground">Connector</span>
					<span>{data.movie.connectorName}</span>

					{#if data.movie.year}
						<span class="text-muted-foreground">Year</span>
						<span>{data.movie.year}</span>
					{/if}

					<span class="text-muted-foreground">Monitored</span>
					<span>{data.movie.monitored ? 'Yes' : 'No'}</span>

					{#if data.movie.tmdbId}
						<span class="text-muted-foreground">TMDB ID</span>
						<a
							href="https://www.themoviedb.org/movie/{data.movie.tmdbId}"
							target="_blank"
							rel="noopener noreferrer"
							class="text-primary hover:underline"
						>
							{data.movie.tmdbId}
						</a>
					{/if}

					{#if data.movie.imdbId}
						<span class="text-muted-foreground">IMDB ID</span>
						<a
							href="https://www.imdb.com/title/{data.movie.imdbId}"
							target="_blank"
							rel="noopener noreferrer"
							class="text-primary hover:underline"
						>
							{data.movie.imdbId}
						</a>
					{/if}

					<span class="text-muted-foreground">*arr ID</span>
					<span>{data.movie.arrId}</span>
				</div>
			</Card.Content>
		</Card.Root>

		<!-- Status Card -->
		<Card.Root>
			<Card.Header>
				<Card.Title>Status</Card.Title>
			</Card.Header>
			<Card.Content>
				<div class="space-y-4">
					<div class="flex items-center justify-between rounded bg-muted/50 p-3">
						<span class="text-sm text-muted-foreground">Status</span>
						<Badge variant={movieStatus().variant}>
							{movieStatus().label}
						</Badge>
					</div>
					<div class="flex items-center justify-between rounded bg-muted/50 p-3">
						<span class="text-sm text-muted-foreground">Quality</span>
						<span class="font-medium">{formatQuality(data.movie.quality)}</span>
					</div>
					<div class="flex items-center justify-between rounded bg-muted/50 p-3">
						<span class="text-sm text-muted-foreground">Last Search</span>
						<span class="font-medium">{formatLastSearchTime(data.movie.lastSearchTime)}</span>
					</div>
				</div>
			</Card.Content>
		</Card.Root>
	</div>

	<!-- Search History Section -->
	<Card.Root class="mt-6">
		<Card.Header>
			<Card.Title>Recent Search History</Card.Title>
		</Card.Header>
		<Card.Content>
			{#if data.searchHistory.length === 0}
				<p class="text-sm text-muted-foreground">No search history yet.</p>
			{:else}
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>Outcome</Table.Head>
							<Table.Head class="text-right">Time</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each data.searchHistory as entry (entry.id)}
							<Table.Row>
								<Table.Cell>
									<Badge variant={getOutcomeBadgeVariant(entry.outcome)}>
										{formatOutcome(entry.outcome)}
									</Badge>
								</Table.Cell>
								<Table.Cell class="text-right text-muted-foreground">
									{new Date(entry.createdAt).toLocaleString()}
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			{/if}
		</Card.Content>
	</Card.Root>
</div>
