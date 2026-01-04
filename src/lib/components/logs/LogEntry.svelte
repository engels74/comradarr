<script lang="ts">
/**
 * Individual log entry display component.
 * Shows log details with expandable context.
 */

import CheckIcon from '@lucide/svelte/icons/check';
import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
import CopyIcon from '@lucide/svelte/icons/copy';
import LinkIcon from '@lucide/svelte/icons/link';
import type { BufferedLogEntry } from '$lib/server/services/log-buffer';
import { cn } from '$lib/utils.js';
import LogLevelBadge from './LogLevelBadge.svelte';

interface Props {
	entry: BufferedLogEntry;
	class?: string | undefined;
}

let { entry, class: className }: Props = $props();

let isExpanded = $state(false);
let isCopied = $state(false);

const formattedTime = $derived(() => {
	const date = new Date(entry.timestamp);
	return date.toLocaleTimeString('en-US', {
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hour12: false
	});
});

const formattedDate = $derived(() => {
	const date = new Date(entry.timestamp);
	return date.toLocaleDateString('en-US', {
		month: 'short',
		day: 'numeric'
	});
});

const hasContext = $derived(entry.context && Object.keys(entry.context).length > 0);

async function copyToClipboard() {
	try {
		const text = JSON.stringify(entry, null, 2);
		await navigator.clipboard.writeText(text);
		isCopied = true;
		setTimeout(() => {
			isCopied = false;
		}, 2000);
	} catch {
		// Clipboard API not available
	}
}

function toggleExpanded() {
	isExpanded = !isExpanded;
}
</script>

<div
	class={cn(
		'group rounded-xl border border-glass-border/20 bg-glass/30 backdrop-blur-sm transition-all duration-200 hover:bg-glass/50 hover:border-glass-border/40',
		entry.level === 'error' && 'border-l-2 border-l-red-500 hover:shadow-[0_0_15px_rgba(239,68,68,0.1)]',
		entry.level === 'warn' && 'border-l-2 border-l-yellow-500 hover:shadow-[0_0_15px_rgba(234,179,8,0.1)]',
		className
	)}
>
	<!-- Main Row -->
	<div class="flex items-start gap-3 p-3">
		<!-- Expand Toggle -->
		<button
			type="button"
			class="mt-0.5 text-muted-foreground hover:text-foreground transition-colors"
			onclick={toggleExpanded}
			disabled={!hasContext && !entry.correlationId}
		>
			{#if isExpanded}
				<ChevronDownIcon class="h-4 w-4" />
			{:else}
				<ChevronRightIcon
					class={cn('h-4 w-4', !hasContext && !entry.correlationId && 'opacity-30')}
				/>
			{/if}
		</button>

		<!-- Timestamp -->
		<div class="shrink-0 w-20 text-xs text-muted-foreground tabular-nums">
			<div>{formattedTime()}</div>
			<div class="text-[10px] opacity-70">{formattedDate()}</div>
		</div>

		<!-- Level Badge -->
		<LogLevelBadge level={entry.level} class="shrink-0" />

		<!-- Module -->
		<div
			class="shrink-0 w-24 truncate text-xs font-medium text-muted-foreground"
			title={entry.module}
		>
			{entry.module}
		</div>

		<!-- Message -->
		<div class="flex-1 min-w-0">
			<p
				class={cn(
					'text-sm break-words',
					entry.level === 'error' && 'text-red-600 dark:text-red-400',
					entry.level === 'warn' && 'text-yellow-600 dark:text-yellow-400'
				)}
			>
				{entry.message}
			</p>
		</div>

		<!-- Actions -->
		<div class="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
			<button
				type="button"
				class="p-1 text-muted-foreground hover:text-foreground transition-colors"
				onclick={copyToClipboard}
				title="Copy log entry"
			>
				{#if isCopied}
					<CheckIcon class="h-4 w-4 text-green-500" />
				{:else}
					<CopyIcon class="h-4 w-4" />
				{/if}
			</button>
		</div>
	</div>

	<!-- Expanded Details -->
	{#if isExpanded && (hasContext || entry.correlationId)}
		<div class="border-t border-glass-border/20 px-3 py-3 bg-glass/20">
			<!-- Correlation ID -->
			{#if entry.correlationId}
				<div class="flex items-center gap-2 mb-2">
					<LinkIcon class="h-3 w-3 text-muted-foreground" />
					<span class="text-xs text-muted-foreground">Correlation ID:</span>
					<code class="text-xs font-mono bg-glass/50 border border-glass-border/30 px-1.5 py-0.5 rounded-md">
						{entry.correlationId}
					</code>
				</div>
			{/if}

			<!-- Context -->
			{#if hasContext}
				<div class="mt-2">
					<span class="text-xs text-muted-foreground mb-1 block">Context:</span>
					<pre class="text-xs font-mono bg-glass/50 border border-glass-border/30 p-3 rounded-lg overflow-x-auto">{JSON.stringify(
							entry.context,
							null,
							2
						)}</pre>
				</div>
			{/if}
		</div>
	{/if}
</div>
