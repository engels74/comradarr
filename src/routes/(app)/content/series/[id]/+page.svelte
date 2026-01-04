<!--
  Series detail page.

  Requirement 17.3:
  - Display series metadata
  - Current quality status per episode
  - Gap and upgrade status
  - Search history

  Episodes are lazy-loaded when seasons are expanded.
-->
<script lang="ts">
	import type { PageProps } from './$types';
	import type { EpisodeDetail } from '$lib/server/db/queries/content';
	import * as Card from '$lib/components/ui/card';
	import * as Table from '$lib/components/ui/table';
	import { Badge } from '$lib/components/ui/badge';
	import { ContentStatusBadge } from '$lib/components/content';
	import { cn } from '$lib/utils.js';

	let { data }: PageProps = $props();

	// Connector type badge colors (matching existing pattern)
	const typeColors: Record<string, string> = {
		sonarr: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
		radarr: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
		whisparr: 'bg-purple-500/10 text-purple-600 dark:text-purple-400'
	};

	const typeColor = $derived(
		typeColors[data.series.connectorType] ?? 'bg-gray-500/10 text-gray-600'
	);

	// Format series status for display
	const statusLabel = $derived(
		data.series.status
			? data.series.status.charAt(0).toUpperCase() + data.series.status.slice(1)
			: 'Unknown'
	);

	// Collapsible season state - track expanded/collapsed seasons
	// Using $state.raw() since we always replace collections (immutable pattern)
	let expandedSeasons = $state.raw<Set<number>>(new Set());

	// Episode cache per season - keyed by season ID
	let episodeCache = $state.raw<Map<number, EpisodeDetail[]>>(new Map());
	let loadingSeasons = $state.raw<Set<number>>(new Set());
	let errorSeasons = $state.raw<Map<number, string>>(new Map());

	function isSeasonExpanded(seasonId: number): boolean {
		return expandedSeasons.has(seasonId);
	}

	async function toggleSeason(seasonId: number) {
		if (expandedSeasons.has(seasonId)) {
			// Collapse
			expandedSeasons = new Set([...expandedSeasons].filter((id) => id !== seasonId));
		} else {
			// Expand and fetch episodes if not cached
			expandedSeasons = new Set([...expandedSeasons, seasonId]);
			if (!episodeCache.has(seasonId)) {
				await fetchEpisodes(seasonId);
			}
		}
	}

	async function fetchEpisodes(seasonId: number) {
		loadingSeasons = new Set([...loadingSeasons, seasonId]);
		errorSeasons = new Map([...errorSeasons].filter(([id]) => id !== seasonId));

		try {
			const response = await fetch(`/api/seasons/${seasonId}/episodes`);
			if (!response.ok) {
				throw new Error(`Failed to load episodes: ${response.statusText}`);
			}
			const data = await response.json();
			episodeCache = new Map(episodeCache).set(seasonId, data.episodes);
		} catch (e) {
			const message = e instanceof Error ? e.message : 'Failed to load episodes';
			errorSeasons = new Map(errorSeasons).set(seasonId, message);
		} finally {
			loadingSeasons = new Set([...loadingSeasons].filter((id) => id !== seasonId));
		}
	}

	// Outcome badge styling (matching connector detail pattern)
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
		if (!quality) return '-';
		const q = quality as { quality?: { name?: string } };
		return q.quality?.name ?? '-';
	}
</script>

<svelte:head>
	<title>{data.series.title} - Content - Comradarr</title>
</svelte:head>

<div class="container mx-auto p-6">
	<!-- Back navigation -->
	<div class="mb-6">
		<a href="/content" class="text-sm text-muted-foreground hover:text-foreground">
			&larr; Back to Content Browser
		</a>
	</div>

	<!-- Header -->
	<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
		<div class="flex items-center gap-3 flex-wrap">
			<h1 class="text-3xl font-bold">{data.series.title}</h1>
			<span class={cn('rounded-md px-2 py-1 text-xs font-medium', typeColor)}>
				{data.series.connectorName}
			</span>
			<Badge variant={data.series.status === 'continuing' ? 'default' : 'secondary'}>
				{statusLabel}
			</Badge>
			{#if !data.series.monitored}
				<Badge variant="outline">Unmonitored</Badge>
			{/if}
		</div>
	</div>

	<!-- Main content grid -->
	<div class="grid gap-6 lg:grid-cols-2">
		<!-- Series Metadata Card -->
		<Card.Root>
			<Card.Header>
				<Card.Title>Series Information</Card.Title>
			</Card.Header>
			<Card.Content class="space-y-4">
				<div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
					<span class="text-muted-foreground">Connector</span>
					<span>{data.series.connectorName}</span>

					<span class="text-muted-foreground">Status</span>
					<span>{statusLabel}</span>

					<span class="text-muted-foreground">Monitored</span>
					<span>{data.series.monitored ? 'Yes' : 'No'}</span>

					{#if data.series.tvdbId}
						<span class="text-muted-foreground">TVDB ID</span>
						<a
							href="https://thetvdb.com/dereferrer/series/{data.series.tvdbId}"
							target="_blank"
							rel="noopener noreferrer"
							class="text-primary hover:underline"
						>
							{data.series.tvdbId}
						</a>
					{/if}

					<span class="text-muted-foreground">*arr ID</span>
					<span>{data.series.arrId}</span>
				</div>
			</Card.Content>
		</Card.Root>

		<!-- Statistics Card -->
		<Card.Root>
			<Card.Header>
				<Card.Title>Statistics</Card.Title>
			</Card.Header>
			<Card.Content>
				<div class="grid grid-cols-2 gap-4">
					<div class="flex items-center justify-between p-3 rounded bg-muted/50">
						<span class="text-muted-foreground text-sm">Total Episodes</span>
						<span class="font-medium">{data.stats.totalEpisodes}</span>
					</div>
					<div class="flex items-center justify-between p-3 rounded bg-muted/50">
						<span class="text-muted-foreground text-sm">Downloaded</span>
						<span class="font-medium">{data.stats.downloadedEpisodes}</span>
					</div>
					<div class="flex items-center justify-between p-3 rounded bg-red-50 dark:bg-red-900/20">
						<span class="text-muted-foreground text-sm">Missing</span>
						<span class="font-medium text-red-600 dark:text-red-400">{data.stats.totalMissing}</span
						>
					</div>
					<div
						class="flex items-center justify-between p-3 rounded bg-yellow-50 dark:bg-yellow-900/20"
					>
						<span class="text-muted-foreground text-sm">Upgrades</span>
						<span class="font-medium text-yellow-600 dark:text-yellow-400"
							>{data.stats.totalUpgrades}</span
						>
					</div>
				</div>
			</Card.Content>
		</Card.Root>
	</div>

	<!-- Seasons Section -->
	<div class="mt-6 space-y-4">
		<h2 class="text-xl font-semibold">Seasons</h2>

		{#each data.seasons as season (season.id)}
			{@const episodes = episodeCache.get(season.id) ?? []}
			{@const isLoading = loadingSeasons.has(season.id)}
			{@const error = errorSeasons.get(season.id)}
			<Card.Root>
				<Card.Header
					class="cursor-pointer hover:bg-muted/50 transition-colors"
					onclick={() => toggleSeason(season.id)}
				>
					<div class="flex items-center justify-between">
						<Card.Title class="text-lg">
							{season.seasonNumber === 0 ? 'Specials' : `Season ${season.seasonNumber}`}
						</Card.Title>
						<div class="flex items-center gap-2">
							{#if season.missingCount > 0}
								<Badge variant="destructive">{season.missingCount} missing</Badge>
							{/if}
							{#if season.upgradeCount > 0}
								<Badge variant="secondary">{season.upgradeCount} upgrades</Badge>
							{/if}
							<span class="text-sm text-muted-foreground">
								{season.downloadedEpisodes}/{season.totalEpisodes} episodes
							</span>
							<span class="text-muted-foreground">
								{isSeasonExpanded(season.id) ? '−' : '+'}
							</span>
						</div>
					</div>
				</Card.Header>

				{#if isSeasonExpanded(season.id)}
					<Card.Content>
						{#if isLoading}
							<div class="flex items-center justify-center py-8">
								<div class="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
								<span class="ml-2 text-sm text-muted-foreground">Loading episodes...</span>
							</div>
						{:else if error}
							<div class="flex flex-col items-center justify-center py-8 gap-2">
								<span class="text-sm text-destructive">{error}</span>
								<button
									class="text-sm text-primary hover:underline"
									onclick={() => fetchEpisodes(season.id)}
								>
									Retry
								</button>
							</div>
						{:else if episodes.length === 0}
							<p class="text-sm text-muted-foreground py-4 text-center">No episodes found.</p>
						{:else}
							<Table.Root>
								<Table.Header>
									<Table.Row>
										<Table.Head class="w-16">#</Table.Head>
										<Table.Head>Title</Table.Head>
										<Table.Head>Air Date</Table.Head>
										<Table.Head>Status</Table.Head>
										<Table.Head>Quality</Table.Head>
										<Table.Head>Search State</Table.Head>
									</Table.Row>
								</Table.Header>
								<Table.Body>
									{#each episodes as episode (episode.id)}
										<Table.Row class={cn(!episode.monitored && 'opacity-50')}>
											<Table.Cell class="font-mono">
												{episode.episodeNumber}
											</Table.Cell>
											<Table.Cell class="font-medium">
												{episode.title ?? 'TBA'}
												{#if !episode.monitored}
													<span class="text-xs text-muted-foreground ml-1">(unmonitored)</span>
												{/if}
											</Table.Cell>
											<Table.Cell class="text-muted-foreground">
												{episode.airDate ? new Date(episode.airDate).toLocaleDateString() : '-'}
											</Table.Cell>
											<Table.Cell>
												{#if episode.hasFile}
													{#if episode.qualityCutoffNotMet}
														<Badge variant="secondary">Upgrade</Badge>
													{:else}
														<Badge variant="default">Downloaded</Badge>
													{/if}
												{:else if episode.monitored}
													<Badge variant="destructive">Missing</Badge>
												{:else}
													<Badge variant="outline">-</Badge>
												{/if}
											</Table.Cell>
											<Table.Cell>
												{formatQuality(episode.quality)}
											</Table.Cell>
											<Table.Cell>
												<ContentStatusBadge state={episode.searchState} />
											</Table.Cell>
										</Table.Row>
									{/each}
								</Table.Body>
							</Table.Root>
						{/if}
					</Card.Content>
				{/if}
			</Card.Root>
		{/each}
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
							<Table.Head>Episode</Table.Head>
							<Table.Head>Outcome</Table.Head>
							<Table.Head class="text-right">Time</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each data.searchHistory as entry (entry.id)}
							<Table.Row>
								<Table.Cell class="font-medium">
									S{String(entry.seasonNumber).padStart(2, '0')}E{String(
										entry.episodeNumber
									).padStart(2, '0')}
									{#if entry.episodeTitle}
										- {entry.episodeTitle}
									{/if}
								</Table.Cell>
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
