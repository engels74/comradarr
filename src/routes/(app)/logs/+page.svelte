<script lang="ts">
import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';
import ScrollTextIcon from '@lucide/svelte/icons/scroll-text';
import TrashIcon from '@lucide/svelte/icons/trash';
import { onMount } from 'svelte';
import { goto, invalidate } from '$app/navigation';
import { page } from '$app/stores';
import { LogFilters, LogTable } from '$lib/components/logs';
import * as AlertDialog from '$lib/components/ui/alert-dialog';
import { Button } from '$lib/components/ui/button';
import { createPollingController, POLLING_INTERVALS } from '$lib/utils/polling';
import type { PageProps } from './$types';

/**
 * Log viewer page.
 * Displays application logs with filtering, search, and real-time updates.
 */

let { data }: PageProps = $props();

// Polling for real-time updates
const polling = createPollingController({
	dependencyKey: 'app:logs',
	interval: POLLING_INTERVALS.SLOW
});

// Start/stop polling on mount/unmount
onMount(() => {
	polling.start();
	return () => polling.stop();
});

// Clear logs dialog state
let showClearDialog = $state(false);
let isClearing = $state(false);

// Pagination state
const pageSize = $derived(data.filters.limit);
const totalPages = $derived(Math.ceil(data.total / pageSize));
const currentPage = $derived(Math.floor(data.filters.offset / pageSize) + 1);

/**
 * Navigate to a page.
 */
function goToPage(pageNum: number) {
	if (pageNum < 1 || pageNum > totalPages) return;

	const params = new URLSearchParams($page.url.searchParams);
	params.set('offset', ((pageNum - 1) * pageSize).toString());
	goto(`/logs?${params.toString()}`);
}

/**
 * Handle refresh.
 */
function handleRefresh() {
	invalidate('app:logs');
}

/**
 * Clear all logs.
 */
async function handleClearLogs() {
	isClearing = true;
	try {
		const response = await fetch('/api/logs', { method: 'DELETE' });
		if (response.ok) {
			showClearDialog = false;
			invalidate('app:logs');
		}
	} finally {
		isClearing = false;
	}
}

// Buffer usage percentage
const bufferUsage = $derived(
	data.buffer.size > 0 ? Math.round((data.buffer.used / data.buffer.size) * 100) : 0
);

// Total error count
const errorCount = $derived(data.levelCounts.error);
const warnCount = $derived(data.levelCounts.warn);
</script>

<svelte:head>
	<title>Logs - Comradarr</title>
</svelte:head>

<div class="container mx-auto p-6">
	<!-- Header -->
	<div class="flex items-center justify-between mb-6">
		<div>
			<div class="flex items-center gap-3">
				<ScrollTextIcon class="h-8 w-8 text-muted-foreground" />
				<h1 class="text-3xl font-bold">Logs</h1>
			</div>
			<p class="text-muted-foreground mt-1">View and search application logs</p>
		</div>

		<div class="flex items-center gap-3">
			<!-- Buffer Status -->
			<div class="text-sm text-muted-foreground hidden md:block">
				<span class="font-medium">{data.buffer.used.toLocaleString()}</span>
				<span class="opacity-70"> / {data.buffer.size.toLocaleString()} entries</span>
				<span class="ml-2 opacity-50">({bufferUsage}%)</span>
			</div>

			<!-- Clear Button -->
			<AlertDialog.Root bind:open={showClearDialog}>
				<AlertDialog.Trigger>
					{#snippet child({ props })}
						<Button variant="outline" size="sm" {...props}>
							<TrashIcon class="h-4 w-4 mr-1" />
							Clear
						</Button>
					{/snippet}
				</AlertDialog.Trigger>
				<AlertDialog.Content>
					<AlertDialog.Header>
						<AlertDialog.Title>Clear All Logs</AlertDialog.Title>
						<AlertDialog.Description>
							This will permanently delete all {data.buffer.used.toLocaleString()} log entries from the
							buffer. This action cannot be undone.
						</AlertDialog.Description>
					</AlertDialog.Header>
					<AlertDialog.Footer>
						<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
						<AlertDialog.Action onclick={handleClearLogs} disabled={isClearing}>
							{isClearing ? 'Clearing...' : 'Clear Logs'}
						</AlertDialog.Action>
					</AlertDialog.Footer>
				</AlertDialog.Content>
			</AlertDialog.Root>
		</div>
	</div>

	<!-- Stats Summary -->
	{#if errorCount > 0 || warnCount > 0}
		<div class="flex gap-4 mb-6">
			{#if errorCount > 0}
				<div
					class="flex items-center gap-2 rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-2"
				>
					<AlertCircleIcon class="h-4 w-4 text-red-500" />
					<span class="text-sm font-medium text-red-600 dark:text-red-400">
						{errorCount} error{errorCount !== 1 ? 's' : ''}
					</span>
				</div>
			{/if}
			{#if warnCount > 0}
				<div
					class="flex items-center gap-2 rounded-lg bg-yellow-500/10 border border-yellow-500/30 px-4 py-2"
				>
					<AlertCircleIcon class="h-4 w-4 text-yellow-500" />
					<span class="text-sm font-medium text-yellow-600 dark:text-yellow-400">
						{warnCount} warning{warnCount !== 1 ? 's' : ''}
					</span>
				</div>
			{/if}
		</div>
	{/if}

	<!-- Filters -->
	<LogFilters
		levelCounts={data.levelCounts}
		modules={data.modules}
		selectedLevels={data.filters.levels}
		selectedModule={data.filters.module}
		searchQuery={data.filters.search}
		onRefresh={handleRefresh}
		class="mb-6"
	/>

	<!-- Results Count -->
	<div class="text-sm text-muted-foreground mb-4">
		{#if data.total > 0}
			Showing {data.entries.length} of {data.total.toLocaleString()} entries
		{:else}
			No entries found
		{/if}
	</div>

	<!-- Log Table -->
	<LogTable entries={data.entries} />

	<!-- Pagination -->
	{#if totalPages > 1}
		<div class="flex flex-col items-center gap-4 mt-6">
			<p class="text-sm text-muted-foreground">
				Page {currentPage} of {totalPages}
			</p>

			<div class="flex items-center gap-2">
				<Button
					variant="outline"
					size="sm"
					disabled={currentPage <= 1}
					onclick={() => goToPage(currentPage - 1)}
				>
					Previous
				</Button>

				<!-- Page Numbers -->
				{#if totalPages <= 7}
					{#each Array(totalPages) as _, i}
						<Button
							variant={currentPage === i + 1 ? 'default' : 'outline'}
							size="sm"
							onclick={() => goToPage(i + 1)}
						>
							{i + 1}
						</Button>
					{/each}
				{:else}
					{#if currentPage > 3}
						<Button variant="outline" size="sm" onclick={() => goToPage(1)}>1</Button>
						{#if currentPage > 4}
							<span class="text-muted-foreground px-2">...</span>
						{/if}
					{/if}

					{#each Array(5) as _, i}
						{@const pageNum = Math.max(1, Math.min(totalPages - 4, currentPage - 2)) + i}
						{#if pageNum >= 1 && pageNum <= totalPages}
							<Button
								variant={currentPage === pageNum ? 'default' : 'outline'}
								size="sm"
								onclick={() => goToPage(pageNum)}
							>
								{pageNum}
							</Button>
						{/if}
					{/each}

					{#if currentPage < totalPages - 2}
						{#if currentPage < totalPages - 3}
							<span class="text-muted-foreground px-2">...</span>
						{/if}
						<Button variant="outline" size="sm" onclick={() => goToPage(totalPages)}
							>{totalPages}</Button
						>
					{/if}
				{/if}

				<Button
					variant="outline"
					size="sm"
					disabled={currentPage >= totalPages}
					onclick={() => goToPage(currentPage + 1)}
				>
					Next
				</Button>
			</div>
		</div>
	{/if}
</div>
