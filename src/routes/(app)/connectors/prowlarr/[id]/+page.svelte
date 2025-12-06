<!--
  Prowlarr instance detail page.

  - Display configuration
  - Show indexer health status table
  - Provide actionable quick actions
-->
<script lang="ts">
	import type { PageProps, ActionData } from './$types';
	import { enhance } from '$app/forms';
	import * as Card from '$lib/components/ui/card';
	import * as Table from '$lib/components/ui/table';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { StatusBadge } from '$lib/components/shared';
	import { cn } from '$lib/utils.js';

	let { data, form }: { data: PageProps['data']; form: ActionData } = $props();

	// Loading states
	let isTestingConnection = $state(false);
	let isCheckingHealth = $state(false);
	let isDeleting = $state(false);

	// Dialog state
	let deleteDialogOpen = $state(false);

	// Calculate summary stats
	const totalIndexers = $derived(data.indexerHealth.length);
	const enabledIndexers = $derived(data.indexerHealth.filter((i) => i.enabled).length);
	const rateLimitedIndexers = $derived(data.indexerHealth.filter((i) => i.isRateLimited).length);
	const hasStaleData = $derived(data.indexerHealth.some((i) => i.isStale));

	/**
	 * Format relative time for display
	 */
	function formatRelativeTime(date: Date | string | null): string {
		if (!date) return 'Never';
		const d = new Date(date);
		const now = new Date();
		const diffMs = now.getTime() - d.getTime();
		const diffMins = Math.floor(diffMs / (1000 * 60));
		const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
		const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

		if (diffMins < 1) return 'Just now';
		if (diffMins < 60) return `${diffMins}m ago`;
		if (diffHours < 24) return `${diffHours}h ago`;
		return `${diffDays}d ago`;
	}
</script>

<svelte:head>
	<title>{data.instance.name} - Prowlarr - Comradarr</title>
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
			<h1 class="text-3xl font-bold">{data.instance.name}</h1>
			<span
				class={cn(
					'inline-flex items-center rounded-md px-2 py-1 text-xs font-medium',
					'bg-pink-500/10 text-pink-600 dark:text-pink-400'
				)}
			>
				Prowlarr
			</span>
			<StatusBadge status={data.instance.healthStatus} />
			{#if !data.instance.enabled}
				<Badge variant="secondary">Disabled</Badge>
			{/if}
			{#if hasStaleData}
				<Badge variant="outline" class="text-yellow-600 border-yellow-600">Stale Data</Badge>
			{/if}
		</div>
		<div class="flex gap-2">
			<Button href="/connectors/prowlarr/{data.instance.id}/edit" variant="outline">Edit</Button>
		</div>
	</div>

	<!-- Action result messages -->
	{#if form?.success}
		<div
			class="mb-6 rounded-md bg-green-50 dark:bg-green-900/20 p-4 text-green-800 dark:text-green-200"
		>
			{form.message}
		</div>
	{/if}
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
					<span class="font-mono break-all">{data.instance.url}</span>

					<span class="text-muted-foreground">Status</span>
					<span>{data.instance.enabled ? 'Enabled' : 'Disabled'}</span>

					<span class="text-muted-foreground">Created</span>
					<span>{new Date(data.instance.createdAt).toLocaleString()}</span>

					<span class="text-muted-foreground">Updated</span>
					<span>{new Date(data.instance.updatedAt).toLocaleString()}</span>
				</div>
			</Card.Content>
		</Card.Root>

		<!-- Health Summary Card -->
		<Card.Root>
			<Card.Header>
				<Card.Title>Health Summary</Card.Title>
			</Card.Header>
			<Card.Content class="space-y-4">
				<div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
					<span class="text-muted-foreground">Health</span>
					<StatusBadge status={data.instance.healthStatus} />

					<span class="text-muted-foreground">Last Check</span>
					<span>
						{#if data.instance.lastHealthCheck}
							{new Date(data.instance.lastHealthCheck).toLocaleString()}
						{:else}
							<span class="text-muted-foreground">Never checked</span>
						{/if}
					</span>

					<span class="text-muted-foreground">Total Indexers</span>
					<span class="font-medium">{totalIndexers}</span>

					<span class="text-muted-foreground">Enabled</span>
					<span class="font-medium">{enabledIndexers}</span>

					<span class="text-muted-foreground">Rate-Limited</span>
					<span
						class={cn(
							'font-medium',
							rateLimitedIndexers > 0 ? 'text-yellow-600 dark:text-yellow-400' : ''
						)}
					>
						{rateLimitedIndexers}
					</span>
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
						return async ({ update }) => {
							await update();
							isTestingConnection = false;
						};
					}}
				>
					<Button type="submit" variant="default" disabled={isTestingConnection}>
						{isTestingConnection ? 'Testing...' : 'Test Connection'}
					</Button>
				</form>

				<!-- Check Health -->
				<form
					method="POST"
					action="?/checkHealth"
					use:enhance={() => {
						isCheckingHealth = true;
						return async ({ update }) => {
							await update();
							isCheckingHealth = false;
						};
					}}
				>
					<Button
						type="submit"
						variant="outline"
						disabled={isCheckingHealth || !data.instance.enabled}
					>
						{isCheckingHealth ? 'Checking...' : 'Check Health'}
					</Button>
				</form>
			</div>
		</Card.Content>
	</Card.Root>

	<!-- Indexer Health Table -->
	<Card.Root class="mt-6">
		<Card.Header>
			<Card.Title>Indexer Health</Card.Title>
			<p class="text-sm text-muted-foreground">
				Current status of indexers from Prowlarr. This data is cached and updated periodically.
			</p>
		</Card.Header>
		<Card.Content>
			{#if data.indexerHealth.length === 0}
				<p class="text-sm text-muted-foreground">
					No indexer health data available. Click "Check Health" to fetch indexer status.
				</p>
			{:else}
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>Indexer</Table.Head>
							<Table.Head>Enabled</Table.Head>
							<Table.Head>Status</Table.Head>
							<Table.Head>Rate Limit Expires</Table.Head>
							<Table.Head>Last Failure</Table.Head>
							<Table.Head class="text-right">Last Updated</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each data.indexerHealth as indexer (indexer.id)}
							<Table.Row class={cn(indexer.isStale ? 'opacity-60' : '')}>
								<Table.Cell class="font-medium">
									{indexer.name}
									{#if indexer.isStale}
										<Badge variant="outline" class="ml-2 text-xs">Stale</Badge>
									{/if}
								</Table.Cell>
								<Table.Cell>
									{#if indexer.enabled}
										<Badge variant="default">Yes</Badge>
									{:else}
										<Badge variant="secondary">No</Badge>
									{/if}
								</Table.Cell>
								<Table.Cell>
									{#if indexer.isRateLimited}
										<Badge variant="destructive">Rate-Limited</Badge>
									{:else}
										<Badge variant="outline" class="text-green-600 border-green-600">OK</Badge>
									{/if}
								</Table.Cell>
								<Table.Cell>
									{#if indexer.rateLimitExpiresAt}
										<span class="text-muted-foreground">
											{formatRelativeTime(indexer.rateLimitExpiresAt)}
										</span>
									{:else}
										<span class="text-muted-foreground">-</span>
									{/if}
								</Table.Cell>
								<Table.Cell>
									{#if indexer.mostRecentFailure}
										<span class="text-muted-foreground">
											{formatRelativeTime(indexer.mostRecentFailure)}
										</span>
									{:else}
										<span class="text-muted-foreground">-</span>
									{/if}
								</Table.Cell>
								<Table.Cell class="text-right text-muted-foreground">
									{formatRelativeTime(indexer.lastUpdated)}
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
					<p class="font-medium">Delete Prowlarr Instance</p>
					<p class="text-sm text-muted-foreground">
						Permanently delete this Prowlarr instance and all cached indexer health data.
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
							<Dialog.Title>Delete Prowlarr Instance</Dialog.Title>
							<Dialog.Description>
								Are you sure you want to delete <strong>{data.instance.name}</strong>? This will
								permanently remove the instance and all cached indexer health data. This action
								cannot be undone.
							</Dialog.Description>
						</Dialog.Header>
						<Dialog.Footer>
							<Button variant="outline" onclick={() => (deleteDialogOpen = false)}>Cancel</Button>
							<form
								method="POST"
								action="?/delete"
								use:enhance={() => {
									isDeleting = true;
									return async ({ update }) => {
										await update();
										isDeleting = false;
									};
								}}
							>
								<Button type="submit" variant="destructive" disabled={isDeleting}>
									{isDeleting ? 'Deleting...' : 'Delete Instance'}
								</Button>
							</form>
						</Dialog.Footer>
					</Dialog.Content>
				</Dialog.Root>
			</div>
		</Card.Content>
	</Card.Root>
</div>
