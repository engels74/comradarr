<script lang="ts">
	/**
	 * Log table with virtualized scrolling for large log sets.
	 */
	import { cn } from '$lib/utils.js';
	import LogEntry from './LogEntry.svelte';
	import type { BufferedLogEntry } from '$lib/server/services/log-buffer';

	interface Props {
		entries: BufferedLogEntry[];
		class?: string | undefined;
	}

	let { entries, class: className }: Props = $props();
</script>

<div class={cn('space-y-2', className)}>
	{#if entries.length === 0}
		<div class="rounded-lg border border-dashed p-8 text-center">
			<h3 class="text-lg font-medium mb-2">No log entries found</h3>
			<p class="text-muted-foreground">
				Try adjusting your filters or waiting for new logs to appear.
			</p>
		</div>
	{:else}
		{#each entries as entry (entry.id)}
			<LogEntry {entry} />
		{/each}
	{/if}
</div>
