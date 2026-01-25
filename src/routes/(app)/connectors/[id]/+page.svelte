<!--
  Connector detail page.

  - Display full configuration
  - Show connection health/sync status
  - Show per-connector statistics
  - Provide actionable quick actions
-->
<script lang="ts">
import { enhance } from '$app/forms';
import { goto } from '$app/navigation';
import { StatusBadge } from '$lib/components/shared';
import { Badge } from '$lib/components/ui/badge';
import { Button } from '$lib/components/ui/button';
import * as Card from '$lib/components/ui/card';
import * as Dialog from '$lib/components/ui/dialog';
import { Separator } from '$lib/components/ui/separator';
import * as Table from '$lib/components/ui/table';
import { toastStore } from '$lib/components/ui/toast';
import { cn } from '$lib/utils.js';
import type { ActionData, PageProps } from './$types';

let { data, form }: { data: PageProps['data']; form: ActionData } = $props();

// Connector type badge colors (matching ConnectorCard pattern)
const typeColors: Record<string, string> = {
	sonarr: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
	radarr: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
	whisparr: 'bg-purple-500/10 text-purple-600 dark:text-purple-400'
};

const typeColor = $derived(typeColors[data.connector.type] ?? 'bg-gray-500/10 text-gray-600');

const formattedType = $derived(
	data.connector.type.charAt(0).toUpperCase() + data.connector.type.slice(1)
);

// Calculate total failed searches
const failedSearchCount = $derived(
	data.searchStateDistribution.exhausted + data.searchStateDistribution.cooldown
);

// Outcome badge styling
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

// Format outcome for display
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

// Loading states
let isTestingConnection = $state(false);
let isTriggeringSync = $state(false);
let isClearingFailedSearches = $state(false);
let isDeleting = $state(false);
let isReconnecting = $state(false);
let isPausingReconnect = $state(false);
let isResumingReconnect = $state(false);

// Dialog state
let deleteDialogOpen = $state(false);

// Derived state
const isOfflineOrUnhealthy = $derived(
	data.connector.healthStatus === 'offline' || data.connector.healthStatus === 'unhealthy'
);

const hasActiveReconnect = $derived(
	data.reconnectState !== null && data.reconnectState.reconnectStartedAt !== null
);

// Format relative time for next reconnect
function formatRelativeTime(date: Date | string | null): string {
	if (!date) return 'N/A';
	const d = typeof date === 'string' ? new Date(date) : date;
	const now = new Date();
	const diffMs = d.getTime() - now.getTime();

	if (diffMs < 0) return 'Now';

	const diffSec = Math.floor(diffMs / 1000);
	if (diffSec < 60) return `${diffSec}s`;

	const diffMin = Math.floor(diffSec / 60);
	if (diffMin < 60) return `${diffMin}m`;

	const diffHrs = Math.floor(diffMin / 60);
	return `${diffHrs}h ${diffMin % 60}m`;
}
</script>

<svelte:head>
	<title>{data.connector.name} - Connectors - Comradarr</title>
</svelte:head>

<div class="container mx-auto p-6">
	<!-- Back navigation -->
	<div class="mb-6">
		<a href="/connectors" class="text-sm text-muted-foreground hover:text-foreground">
			&larr; Back to Connectors
		</a>
	</div>

	<!-- Header -->
	<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
		<div class="flex items-center gap-3 flex-wrap">
			<h1 class="text-3xl font-bold">{data.connector.name}</h1>
			<span
				class={cn('inline-flex items-center rounded-md px-2 py-1 text-xs font-medium', typeColor)}
			>
				{formattedType}
			</span>
			<StatusBadge status={data.connector.healthStatus} />
			{#if !data.connector.enabled}
				<Badge variant="secondary">Disabled</Badge>
			{/if}
		</div>
		<div class="flex gap-2">
			<Button href="/connectors/{data.connector.id}/edit" variant="outline">Edit</Button>
		</div>
	</div>

	<!-- Action result messages -->
	{#if form?.error}
		<div class="mb-6 rounded-md bg-red-50 dark:bg-red-900/20 p-4 text-red-800 dark:text-red-200">
			{form.error}
		</div>
	{/if}

	<!-- Main content grid -->
	<div class="grid gap-6 lg:grid-cols-2">
		<!-- Configuration Card -->
		<Card.Root>
			<Card.Header>
				<Card.Title>Configuration</Card.Title>
			</Card.Header>
			<Card.Content class="space-y-4">
				<div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
					<span class="text-muted-foreground">URL</span>
					<span class="font-mono break-all">{data.connector.url}</span>

					<span class="text-muted-foreground">Type</span>
					<span>{formattedType}</span>

					<span class="text-muted-foreground">Status</span>
					<span>{data.connector.enabled ? 'Enabled' : 'Disabled'}</span>

					<span class="text-muted-foreground">Created</span>
					<span>{new Date(data.connector.createdAt).toLocaleString()}</span>

					<span class="text-muted-foreground">Updated</span>
					<span>{new Date(data.connector.updatedAt).toLocaleString()}</span>
				</div>
			</Card.Content>
		</Card.Root>

		<!-- Sync Status Card -->
		<Card.Root>
			<Card.Header>
				<Card.Title>Sync Status</Card.Title>
			</Card.Header>
			<Card.Content class="space-y-4">
				<div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
					<span class="text-muted-foreground">Health</span>
					<StatusBadge status={data.connector.healthStatus} />

					<span class="text-muted-foreground">Last Sync</span>
					<span>
						{#if data.connector.lastSync}
							{new Date(data.connector.lastSync).toLocaleString()}
						{:else}
							<span class="text-muted-foreground">Never synced</span>
						{/if}
					</span>

					<span class="text-muted-foreground">Last Reconciliation</span>
					<span>
						{#if data.syncState?.lastReconciliation}
							{new Date(data.syncState.lastReconciliation).toLocaleString()}
						{:else}
							<span class="text-muted-foreground">Never</span>
						{/if}
					</span>

					<span class="text-muted-foreground">Consecutive Failures</span>
					<span
						class={cn(
							data.syncState && data.syncState.consecutiveFailures > 0
								? 'text-red-600 dark:text-red-400 font-medium'
								: ''
						)}
					>
						{data.syncState?.consecutiveFailures ?? 0}
					</span>
				</div>
			</Card.Content>
		</Card.Root>

		<!-- Reconnect Status Card (shown when offline/unhealthy) -->
		{#if isOfflineOrUnhealthy && hasActiveReconnect}
			<Card.Root class="border-warning/50">
				<Card.Header>
					<Card.Title class="text-warning">Reconnect Status</Card.Title>
				</Card.Header>
				<Card.Content class="space-y-4">
					<div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
						<span class="text-muted-foreground">Attempts</span>
						<span class="font-medium">{data.reconnectState?.reconnectAttempts ?? 0}</span>

						<span class="text-muted-foreground">Next Retry</span>
						<span class={data.reconnectState?.reconnectPaused ? 'text-muted-foreground' : ''}>
							{#if data.reconnectState?.reconnectPaused}
								Paused
							{:else}
								{formatRelativeTime(data.reconnectState?.nextReconnectAt ?? null)}
							{/if}
						</span>

						{#if data.reconnectState?.lastReconnectError}
							<span class="text-muted-foreground">Last Error</span>
							<span class="text-red-600 dark:text-red-400 text-xs break-words">
								{data.reconnectState.lastReconnectError}
							</span>
						{/if}
					</div>

					<div class="flex flex-wrap gap-2 pt-2 border-t border-border">
						<!-- Manual Reconnect -->
						<form
							method="POST"
							action="?/reconnect"
							use:enhance={() => {
								isReconnecting = true;
								return async ({ result, update }) => {
									await update();
									isReconnecting = false;

									if (result.type === 'success' && result.data?.success) {
										toastStore.success(result.data.message as string);
									}
								};
							}}
						>
							<Button type="submit" variant="default" size="sm" disabled={isReconnecting}>
								{isReconnecting ? 'Reconnecting...' : 'Reconnect Now'}
							</Button>
						</form>

						<!-- Pause/Resume Auto-Reconnect -->
						{#if data.reconnectState?.reconnectPaused}
							<form
								method="POST"
								action="?/resumeReconnect"
								use:enhance={() => {
									isResumingReconnect = true;
									return async ({ result, update }) => {
										await update();
										isResumingReconnect = false;

										if (result.type === 'success' && result.data?.success) {
											toastStore.success(result.data.message as string);
										}
									};
								}}
							>
								<Button type="submit" variant="outline" size="sm" disabled={isResumingReconnect}>
									{isResumingReconnect ? 'Resuming...' : 'Resume Auto-Reconnect'}
								</Button>
							</form>
						{:else}
							<form
								method="POST"
								action="?/pauseReconnect"
								use:enhance={() => {
									isPausingReconnect = true;
									return async ({ result, update }) => {
										await update();
										isPausingReconnect = false;

										if (result.type === 'success' && result.data?.success) {
											toastStore.success(result.data.message as string);
										}
									};
								}}
							>
								<Button type="submit" variant="outline" size="sm" disabled={isPausingReconnect}>
									{isPausingReconnect ? 'Pausing...' : 'Pause Auto-Reconnect'}
								</Button>
							</form>
						{/if}
					</div>
				</Card.Content>
			</Card.Root>
		{/if}

		<!-- Statistics Card -->
		<Card.Root>
			<Card.Header>
				<Card.Title>Statistics</Card.Title>
			</Card.Header>
			<Card.Content>
				<div class="space-y-4">
					<!-- Content Breakdown -->
					<div>
						<h4 class="text-sm font-medium mb-2">Content Gaps</h4>
						<div class="grid grid-cols-2 gap-4 text-sm">
							<div class="flex items-center justify-between p-2 rounded bg-muted/50">
								<span class="text-muted-foreground">Episode Gaps</span>
								<span class="font-medium">{data.detailedStats.episodeGapsCount}</span>
							</div>
							<div class="flex items-center justify-between p-2 rounded bg-muted/50">
								<span class="text-muted-foreground">Movie Gaps</span>
								<span class="font-medium">{data.detailedStats.movieGapsCount}</span>
							</div>
						</div>
					</div>

					<Separator />

					<!-- Upgrade Candidates -->
					<div>
						<h4 class="text-sm font-medium mb-2">Upgrade Candidates</h4>
						<div class="grid grid-cols-2 gap-4 text-sm">
							<div class="flex items-center justify-between p-2 rounded bg-muted/50">
								<span class="text-muted-foreground">Episodes</span>
								<span class="font-medium">{data.detailedStats.episodeUpgradesCount}</span>
							</div>
							<div class="flex items-center justify-between p-2 rounded bg-muted/50">
								<span class="text-muted-foreground">Movies</span>
								<span class="font-medium">{data.detailedStats.movieUpgradesCount}</span>
							</div>
						</div>
					</div>

					<Separator />

					<!-- Totals -->
					<div>
						<h4 class="text-sm font-medium mb-2">Library Totals</h4>
						<div class="grid grid-cols-2 gap-4 text-sm">
							<div class="flex items-center justify-between p-2 rounded bg-muted/50">
								<span class="text-muted-foreground">Total Episodes</span>
								<span class="font-medium">{data.detailedStats.totalEpisodes}</span>
							</div>
							<div class="flex items-center justify-between p-2 rounded bg-muted/50">
								<span class="text-muted-foreground">Total Movies</span>
								<span class="font-medium">{data.detailedStats.totalMovies}</span>
							</div>
						</div>
					</div>

					<Separator />

					<!-- Queue -->
					<div class="flex items-center justify-between p-2 rounded bg-muted/50 text-sm">
						<span class="text-muted-foreground">Queue Depth</span>
						<span class="font-medium">{data.detailedStats.queueDepth}</span>
					</div>
				</div>
			</Card.Content>
		</Card.Root>

		<!-- Search State Distribution Card -->
		<Card.Root>
			<Card.Header>
				<Card.Title>Search State Distribution</Card.Title>
			</Card.Header>
			<Card.Content>
				<div class="space-y-2">
					<div class="flex items-center justify-between p-2 rounded bg-muted/50 text-sm">
						<span class="text-muted-foreground">Pending</span>
						<Badge variant="outline">{data.searchStateDistribution.pending}</Badge>
					</div>
					<div class="flex items-center justify-between p-2 rounded bg-muted/50 text-sm">
						<span class="text-muted-foreground">Queued</span>
						<Badge variant="outline">{data.searchStateDistribution.queued}</Badge>
					</div>
					<div class="flex items-center justify-between p-2 rounded bg-muted/50 text-sm">
						<span class="text-muted-foreground">Searching</span>
						<Badge variant="default">{data.searchStateDistribution.searching}</Badge>
					</div>
					<div class="flex items-center justify-between p-2 rounded bg-muted/50 text-sm">
						<span class="text-muted-foreground">Cooldown</span>
						<Badge variant="secondary">{data.searchStateDistribution.cooldown}</Badge>
					</div>
					<div class="flex items-center justify-between p-2 rounded bg-muted/50 text-sm">
						<span class="text-muted-foreground">Exhausted</span>
						<Badge variant="destructive">{data.searchStateDistribution.exhausted}</Badge>
					</div>
				</div>
			</Card.Content>
		</Card.Root>
	</div>

	<!-- Quick Actions Card -->
	<Card.Root class="mt-6">
		<Card.Header>
			<Card.Title>Quick Actions</Card.Title>
		</Card.Header>
		<Card.Content>
			<div class="flex flex-wrap gap-3">
				<!-- Test Connection -->
				<form
					method="POST"
					action="?/testConnection"
					use:enhance={() => {
						isTestingConnection = true;
						return async ({ result, update }) => {
							await update();
							isTestingConnection = false;

							// Show toast on success
							if (result.type === 'success' && result.data?.success) {
								toastStore.success(result.data.message as string);
							}
						};
					}}
				>
					<Button type="submit" variant="default" disabled={isTestingConnection}>
						{isTestingConnection ? 'Testing...' : 'Test Connection'}
					</Button>
				</form>

				<!-- Trigger Sync -->
				<form
					method="POST"
					action="?/triggerSync"
					use:enhance={() => {
						isTriggeringSync = true;
						return async ({ result, update }) => {
							await update();
							isTriggeringSync = false;

							// Show toast on success
							if (result.type === 'success' && result.data?.success) {
								toastStore.success(result.data.message as string);
							}
						};
					}}
				>
					<Button
						type="submit"
						variant="outline"
						disabled={isTriggeringSync || !data.connector.enabled}
					>
						{isTriggeringSync ? 'Triggering...' : 'Trigger Sync'}
					</Button>
				</form>

				<!-- Clear Failed Searches (only show if there are failed searches) -->
				{#if failedSearchCount > 0}
					<form
						method="POST"
						action="?/clearFailedSearches"
						use:enhance={() => {
							isClearingFailedSearches = true;
							return async ({ result, update }) => {
								await update();
								isClearingFailedSearches = false;

								// Show toast on success
								if (result.type === 'success' && result.data?.success) {
									toastStore.success(result.data.message as string);
								}
							};
						}}
					>
						<Button type="submit" variant="secondary" disabled={isClearingFailedSearches}>
							{isClearingFailedSearches
								? 'Clearing...'
								: `Clear Failed Searches (${failedSearchCount})`}
						</Button>
					</form>
				{/if}

				<!-- Reconnect (only show if offline/unhealthy and no active reconnect cycle) -->
				{#if isOfflineOrUnhealthy && !hasActiveReconnect}
					<form
						method="POST"
						action="?/reconnect"
						use:enhance={() => {
							isReconnecting = true;
							return async ({ result, update }) => {
								await update();
								isReconnecting = false;

								if (result.type === 'success' && result.data?.success) {
									toastStore.success(result.data.message as string);
								}
							};
						}}
					>
						<Button type="submit" variant="outline" disabled={isReconnecting}>
							{isReconnecting ? 'Reconnecting...' : 'Reconnect'}
						</Button>
					</form>
				{/if}
			</div>
		</Card.Content>
	</Card.Root>

	<!-- Recent Search History -->
	<Card.Root class="mt-6">
		<Card.Header>
			<Card.Title>Recent Search History</Card.Title>
		</Card.Header>
		<Card.Content>
			{#if data.recentSearchHistory.length === 0}
				<p class="text-sm text-muted-foreground">No search history yet.</p>
			{:else}
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>Content</Table.Head>
							<Table.Head>Type</Table.Head>
							<Table.Head>Outcome</Table.Head>
							<Table.Head class="text-right">Time</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each data.recentSearchHistory as entry (entry.id)}
							<Table.Row>
								<Table.Cell class="font-medium">
									{entry.contentTitle ?? `Unknown (ID: ${entry.contentId})`}
								</Table.Cell>
								<Table.Cell>
									<span class="capitalize">{entry.contentType}</span>
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

	<!-- Danger Zone -->
	<Card.Root class="mt-6 border-destructive/50">
		<Card.Header>
			<Card.Title class="text-destructive">Danger Zone</Card.Title>
		</Card.Header>
		<Card.Content>
			<div class="flex items-center justify-between">
				<div>
					<p class="font-medium">Delete Connector</p>
					<p class="text-sm text-muted-foreground">
						Permanently delete this connector and all associated data.
					</p>
				</div>
				<Dialog.Root bind:open={deleteDialogOpen}>
					<Dialog.Trigger>
						{#snippet child({ props })}
							<Button {...props} variant="destructive">Delete</Button>
						{/snippet}
					</Dialog.Trigger>
					<Dialog.Content>
						<Dialog.Header>
							<Dialog.Title>Delete Connector</Dialog.Title>
							<Dialog.Description>
								Are you sure you want to delete <strong>{data.connector.name}</strong>? This will
								permanently remove the connector and all associated data including synced content,
								search history, and queue items. This action cannot be undone.
							</Dialog.Description>
						</Dialog.Header>
						<Dialog.Footer>
							<Button variant="outline" onclick={() => (deleteDialogOpen = false)}>Cancel</Button>
							<form
								method="POST"
								action="?/delete"
								use:enhance={() => {
									isDeleting = true;
									return async ({ result, update }) => {
										await update();
										isDeleting = false;

										// Show toast and navigate on success
										if (result.type === 'success' && result.data?.success) {
											toastStore.success(result.data.message as string);
											if (result.data.redirectTo) {
												goto(result.data.redirectTo as string);
											}
										}
									};
								}}
							>
								<Button type="submit" variant="destructive" disabled={isDeleting}>
									{isDeleting ? 'Deleting...' : 'Delete Connector'}
								</Button>
							</form>
						</Dialog.Footer>
					</Dialog.Content>
				</Dialog.Root>
			</div>
		</Card.Content>
	</Card.Root>
</div>
