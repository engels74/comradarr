<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import * as Table from '$lib/components/ui/table';
	import * as Tabs from '$lib/components/ui/tabs';
	import { Badge } from '$lib/components/ui/badge';
	import type {
		SerializedMostSearchedItem,
		SerializedHardestToFindItem,
		SerializedQualityDistribution
	} from './types';
	import SearchIcon from '@lucide/svelte/icons/search';
	import AlertTriangleIcon from '@lucide/svelte/icons/alert-triangle';
	import StarIcon from '@lucide/svelte/icons/star';
	import TvIcon from '@lucide/svelte/icons/tv';
	import FilmIcon from '@lucide/svelte/icons/film';

	interface Props {
		mostSearched: SerializedMostSearchedItem[];
		hardestToFind: SerializedHardestToFindItem[];
		qualityDistribution: SerializedQualityDistribution[];
		class?: string;
	}

	let { mostSearched, hardestToFind, qualityDistribution, class: className = '' }: Props = $props();

	/**
	 * Formats content title with episode info if applicable.
	 */
	function formatTitle(item: SerializedMostSearchedItem | SerializedHardestToFindItem): string {
		if (item.contentType === 'episode' && item.seriesTitle) {
			const epNum =
				item.seasonNumber !== null && item.episodeNumber !== null
					? ` S${String(item.seasonNumber).padStart(2, '0')}E${String(item.episodeNumber).padStart(2, '0')}`
					: '';
			return `${item.seriesTitle}${epNum}`;
		}
		return item.title;
	}

	/**
	 * Formats date for display.
	 */
	function formatDate(isoString: string): string {
		return new Date(isoString).toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric'
		});
	}

	/**
	 * Gets state badge variant based on state.
	 */
	function getStateBadge(state: string): {
		variant: 'default' | 'secondary' | 'destructive' | 'outline';
		label: string;
	} {
		switch (state) {
			case 'exhausted':
				return { variant: 'destructive', label: 'Exhausted' };
			case 'cooldown':
				return { variant: 'secondary', label: 'Cooldown' };
			case 'searching':
				return { variant: 'default', label: 'Searching' };
			default:
				return { variant: 'outline', label: state };
		}
	}

	/**
	 * Calculates quality bar width percentage.
	 */
	function getBarWidth(percentage: number): string {
		return `${Math.max(2, percentage)}%`;
	}

	const hasSearchData = $derived(mostSearched.length > 0);
	const hasFindData = $derived(hardestToFind.length > 0);
	const hasQualityData = $derived(qualityDistribution.length > 0);
</script>

<Card.Root class={className}>
	<Card.Header class="pb-2">
		<Card.Title class="text-lg">Content Analysis</Card.Title>
		<Card.Description>Insights into search patterns and content quality</Card.Description>
	</Card.Header>
	<Card.Content>
		<Tabs.Root value="most-searched" class="w-full">
			<Tabs.List class="grid w-full grid-cols-3 mb-4">
				<Tabs.Trigger value="most-searched" class="flex items-center gap-2">
					<SearchIcon class="h-4 w-4" />
					Most Searched
				</Tabs.Trigger>
				<Tabs.Trigger value="hardest-to-find" class="flex items-center gap-2">
					<AlertTriangleIcon class="h-4 w-4" />
					Hardest to Find
				</Tabs.Trigger>
				<Tabs.Trigger value="quality" class="flex items-center gap-2">
					<StarIcon class="h-4 w-4" />
					Quality Distribution
				</Tabs.Trigger>
			</Tabs.List>

			<!-- Most Searched Tab -->
			<Tabs.Content value="most-searched">
				{#if hasSearchData}
					<div class="rounded-md border">
						<Table.Root>
							<Table.Header>
								<Table.Row>
									<Table.Head>Content</Table.Head>
									<Table.Head class="text-right">Searches</Table.Head>
									<Table.Head class="text-right">Last Searched</Table.Head>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{#each mostSearched as item (item.contentId)}
									<Table.Row>
										<Table.Cell>
											<div class="flex items-center gap-2">
												{#if item.contentType === 'episode'}
													<TvIcon class="h-4 w-4 text-muted-foreground shrink-0" />
												{:else}
													<FilmIcon class="h-4 w-4 text-muted-foreground shrink-0" />
												{/if}
												<div>
													<div class="font-medium">{formatTitle(item)}</div>
													<div class="text-xs text-muted-foreground">{item.connectorName}</div>
												</div>
											</div>
										</Table.Cell>
										<Table.Cell class="text-right tabular-nums font-medium">
											{item.searchCount}
										</Table.Cell>
										<Table.Cell class="text-right text-muted-foreground">
											{formatDate(item.lastSearched)}
										</Table.Cell>
									</Table.Row>
								{/each}
							</Table.Body>
						</Table.Root>
					</div>
				{:else}
					<div class="flex flex-col items-center justify-center py-12 text-muted-foreground">
						<SearchIcon class="h-8 w-8 mb-2 opacity-50" />
						<p>No search history available</p>
					</div>
				{/if}
			</Tabs.Content>

			<!-- Hardest to Find Tab -->
			<Tabs.Content value="hardest-to-find">
				{#if hasFindData}
					<div class="rounded-md border">
						<Table.Root>
							<Table.Header>
								<Table.Row>
									<Table.Head>Content</Table.Head>
									<Table.Head class="text-right">Attempts</Table.Head>
									<Table.Head class="text-right">Days</Table.Head>
									<Table.Head class="text-right">Status</Table.Head>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{#each hardestToFind as item (item.contentId)}
									{@const badge = getStateBadge(item.state)}
									<Table.Row>
										<Table.Cell>
											<div class="flex items-center gap-2">
												{#if item.contentType === 'episode'}
													<TvIcon class="h-4 w-4 text-muted-foreground shrink-0" />
												{:else}
													<FilmIcon class="h-4 w-4 text-muted-foreground shrink-0" />
												{/if}
												<div>
													<div class="font-medium">{formatTitle(item)}</div>
													<div class="text-xs text-muted-foreground">{item.connectorName}</div>
												</div>
											</div>
										</Table.Cell>
										<Table.Cell class="text-right tabular-nums font-medium">
											{item.attemptCount}
										</Table.Cell>
										<Table.Cell class="text-right tabular-nums text-muted-foreground">
											{item.daysSinceCreated}
										</Table.Cell>
										<Table.Cell class="text-right">
											<Badge variant={badge.variant}>{badge.label}</Badge>
										</Table.Cell>
									</Table.Row>
								{/each}
							</Table.Body>
						</Table.Root>
					</div>
				{:else}
					<div class="flex flex-col items-center justify-center py-12 text-muted-foreground">
						<AlertTriangleIcon class="h-8 w-8 mb-2 opacity-50" />
						<p>No pending searches with attempts</p>
					</div>
				{/if}
			</Tabs.Content>

			<!-- Quality Distribution Tab -->
			<Tabs.Content value="quality">
				{#if hasQualityData}
					<div class="space-y-3">
						{#each qualityDistribution as quality (quality.qualityName)}
							<div class="flex items-center gap-4">
								<div class="w-32 text-sm font-medium truncate" title={quality.qualityName}>
									{quality.qualityName}
								</div>
								<div class="flex-1 h-4 bg-muted rounded-full overflow-hidden">
									<div
										class="h-full bg-primary rounded-full transition-all duration-300"
										style="width: {getBarWidth(quality.percentage)}"
									></div>
								</div>
								<div class="w-20 text-right text-sm">
									<span class="font-medium">{quality.percentage}%</span>
									<span class="text-muted-foreground ml-1">({quality.count})</span>
								</div>
							</div>
						{/each}
					</div>
				{:else}
					<div class="flex flex-col items-center justify-center py-12 text-muted-foreground">
						<StarIcon class="h-8 w-8 mb-2 opacity-50" />
						<p>No quality data available</p>
						<p class="text-sm mt-1">Data will appear as content is acquired</p>
					</div>
				{/if}
			</Tabs.Content>
		</Tabs.Root>
	</Card.Content>
</Card.Root>
