<script lang="ts">
	/**
	 * Log viewer filters component.
	 */
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { cn } from '$lib/utils.js';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { logLevels, type LogLevel } from '$lib/schemas/settings';
	import SearchIcon from '@lucide/svelte/icons/search';
	import XIcon from '@lucide/svelte/icons/x';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import DownloadIcon from '@lucide/svelte/icons/download';

	interface Props {
		levelCounts: Record<LogLevel, number>;
		modules: string[];
		selectedLevels: LogLevel[];
		selectedModule: string;
		searchQuery: string;
		class?: string | undefined;
		onRefresh?: () => void;
	}

	let {
		levelCounts,
		modules,
		selectedLevels,
		selectedModule,
		searchQuery,
		class: className,
		onRefresh
	}: Props = $props();

	let localSearch = $state('');
	let isRefreshing = $state(false);

	// Initialize localSearch from prop
	$effect(() => {
		localSearch = searchQuery;
	});

	function updateFilters(params: Record<string, string | undefined>) {
		const url = new URL($page.url);

		for (const [key, value] of Object.entries(params)) {
			if (value) {
				url.searchParams.set(key, value);
			} else {
				url.searchParams.delete(key);
			}
		}

		// Reset offset when filters change
		url.searchParams.delete('offset');

		goto(url.toString());
	}

	function toggleLevel(level: LogLevel) {
		const newLevels = selectedLevels.includes(level)
			? selectedLevels.filter((l) => l !== level)
			: [...selectedLevels, level];

		updateFilters({
			levels: newLevels.length > 0 ? newLevels.join(',') : undefined
		});
	}

	function handleSearch() {
		updateFilters({
			search: localSearch.trim() || undefined
		});
	}

	function clearSearch() {
		localSearch = '';
		updateFilters({ search: undefined });
	}

	function handleModuleChange(e: Event) {
		const target = e.target as HTMLSelectElement;
		updateFilters({
			module: target.value || undefined
		});
	}

	function clearAllFilters() {
		const url = new URL($page.url);
		url.searchParams.delete('levels');
		url.searchParams.delete('module');
		url.searchParams.delete('search');
		url.searchParams.delete('offset');
		localSearch = '';
		goto(url.toString());
	}

	async function handleRefresh() {
		if (isRefreshing) return;
		isRefreshing = true;
		onRefresh?.();
		// Small delay for visual feedback
		await new Promise((resolve) => setTimeout(resolve, 500));
		isRefreshing = false;
	}

	function handleExport() {
		const url = new URL($page.url);
		const exportUrl = new URL('/api/logs', url.origin);

		// Copy current filters to export URL
		if (selectedLevels.length > 0) {
			exportUrl.searchParams.set('levels', selectedLevels.join(','));
		}
		if (selectedModule) {
			exportUrl.searchParams.set('module', selectedModule);
		}
		if (searchQuery) {
			exportUrl.searchParams.set('search', searchQuery);
		}
		exportUrl.searchParams.set('format', 'json');

		window.open(exportUrl.toString(), '_blank');
	}

	const hasActiveFilters = $derived(selectedLevels.length > 0 || selectedModule || searchQuery);

	const levelColors: Record<LogLevel, string> = {
		error: 'bg-red-500',
		warn: 'bg-yellow-500',
		info: 'bg-blue-500',
		debug: 'bg-purple-500',
		trace: 'bg-gray-500'
	};
</script>

<div class={cn('space-y-4', className)}>
	<!-- Search and Actions -->
	<div class="flex flex-col sm:flex-row gap-3">
		<div class="relative flex-1">
			<div class="pointer-events-none absolute inset-y-0 left-3 flex items-center">
				<SearchIcon class="h-4 w-4 text-muted-foreground" />
			</div>
			<Input
				type="text"
				placeholder="Search logs..."
				class="pl-9 pr-8"
				bind:value={localSearch}
				onkeydown={(e) => e.key === 'Enter' && handleSearch()}
			/>
			{#if localSearch}
				<button
					type="button"
					class="absolute inset-y-0 right-3 flex items-center text-muted-foreground hover:text-foreground"
					onclick={clearSearch}
				>
					<XIcon class="h-4 w-4" />
				</button>
			{/if}
		</div>

		<div class="flex gap-2">
			<Button variant="outline" size="sm" onclick={handleSearch}>Search</Button>
			<Button variant="outline" size="sm" onclick={handleRefresh} disabled={isRefreshing}>
				<RefreshCwIcon class={cn('h-4 w-4 mr-1', isRefreshing && 'animate-spin')} />
				Refresh
			</Button>
			<Button variant="outline" size="sm" onclick={handleExport}>
				<DownloadIcon class="h-4 w-4 mr-1" />
				Export
			</Button>
		</div>
	</div>

	<!-- Level Filters -->
	<div class="flex flex-wrap items-center gap-2">
		<span class="text-sm font-medium text-muted-foreground">Levels:</span>
		{#each logLevels as level}
			{@const isSelected = selectedLevels.includes(level)}
			{@const count = levelCounts[level] ?? 0}
			<button
				type="button"
				class={cn(
					'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors',
					isSelected
						? `${levelColors[level]} text-white`
						: 'bg-muted text-muted-foreground hover:bg-muted/80'
				)}
				onclick={() => toggleLevel(level)}
			>
				<span class="uppercase">{level}</span>
				<span
					class={cn(
						'rounded-full px-1.5 py-0.5 text-[10px]',
						isSelected ? 'bg-white/20' : 'bg-background'
					)}
				>
					{count}
				</span>
			</button>
		{/each}
	</div>

	<!-- Module Filter -->
	<div class="flex flex-wrap items-center gap-3">
		<span class="text-sm font-medium text-muted-foreground">Module:</span>
		<select
			class="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
			value={selectedModule}
			onchange={handleModuleChange}
		>
			<option value="">All modules</option>
			{#each modules as mod}
				<option value={mod}>{mod}</option>
			{/each}
		</select>

		{#if hasActiveFilters}
			<Button variant="ghost" size="sm" onclick={clearAllFilters}>
				<XIcon class="h-4 w-4 mr-1" />
				Clear filters
			</Button>
		{/if}
	</div>
</div>
