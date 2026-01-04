<script lang="ts">
/**
 * Log table with virtualized scrolling for large log sets.
 */

import type { BufferedLogEntry } from '$lib/server/services/log-buffer';
import { cn } from '$lib/utils.js';
import LogEntry from './LogEntry.svelte';

interface Props {
	entries: BufferedLogEntry[];
	class?: string | undefined;
}

let { entries, class: className }: Props = $props();
</script>

<div class={cn('space-y-2 animate-float-up', className)} style="animation-delay: 150ms;">
	{#if entries.length === 0}
		<div class="glass-panel p-12 text-center">
			<div class="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-muted/50 mb-4">
				<svg class="h-6 w-6 text-muted-foreground opacity-50" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14,2 14,8 20,8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>
			</div>
			<h3 class="text-lg font-display font-medium mb-2">No log entries found</h3>
			<p class="text-sm text-muted-foreground">
				Try adjusting your filters or waiting for new logs to appear.
			</p>
		</div>
	{:else}
		{#each entries as entry, i (entry.id)}
			<div class="animate-float-up" style="animation-delay: {Math.min(i * 20, 200)}ms;">
				<LogEntry {entry} />
			</div>
		{/each}
	{/if}
</div>
