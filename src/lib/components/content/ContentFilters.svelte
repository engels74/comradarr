<script lang="ts">
import { goto } from '$app/navigation';
import { page } from '$app/stores';
import { Input } from '$lib/components/ui/input';
import type { ContentStatusCounts } from '$lib/server/db/queries/content';

/**
 * Content filter controls with URL-based state.
 */

interface Props {
	connectors: Array<{ id: number; name: string; type: string }>;
	statusCounts: ContentStatusCounts;
}

let { connectors, statusCounts }: Props = $props();

// Initialize from URL params
let search = $state($page.url.searchParams.get('search') ?? '');
let connectorId = $state($page.url.searchParams.get('connector') ?? '');
let contentType = $state($page.url.searchParams.get('type') ?? 'all');
let status = $state($page.url.searchParams.get('status') ?? 'all');

// Debounced search
let searchTimeout: ReturnType<typeof setTimeout>;

/**
 * Updates URL with current filter state.
 */
function updateFilters() {
	const params = new URLSearchParams();

	if (search) params.set('search', search);
	if (connectorId) params.set('connector', connectorId);
	if (contentType !== 'all') params.set('type', contentType);
	if (status !== 'all') params.set('status', status);

	// Preserve sort params if they exist
	const currentSort = $page.url.searchParams.get('sort');
	const currentOrder = $page.url.searchParams.get('order');
	if (currentSort) params.set('sort', currentSort);
	if (currentOrder) params.set('order', currentOrder);

	goto(`/content?${params.toString()}`, { replaceState: true, keepFocus: true });
}

/**
 * Handles search input with debounce for real-time updates.
 */
function onSearchInput() {
	clearTimeout(searchTimeout);
	searchTimeout = setTimeout(updateFilters, 300);
}

/**
 * Handles filter dropdown changes.
 */
function onFilterChange() {
	updateFilters();
}
</script>

<div class="flex flex-wrap gap-3 mb-6 p-4 glass-panel">
	<!-- Search Input -->
	<Input
		type="text"
		placeholder="Search by title..."
		bind:value={search}
		oninput={onSearchInput}
		class="max-w-xs"
	/>

	<!-- Connector Filter -->
	<select
		bind:value={connectorId}
		onchange={onFilterChange}
		class="h-9 rounded-lg border border-glass-border/30 bg-glass/50 backdrop-blur-sm px-3 py-1 text-sm transition-all focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 hover:bg-glass/70"
	>
		<option value="">All Connectors</option>
		{#each connectors as c (c.id)}
			<option value={c.id.toString()}>{c.name}</option>
		{/each}
	</select>

	<!-- Content Type Filter -->
	<select
		bind:value={contentType}
		onchange={onFilterChange}
		class="h-9 rounded-lg border border-glass-border/30 bg-glass/50 backdrop-blur-sm px-3 py-1 text-sm transition-all focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 hover:bg-glass/70"
	>
		<option value="all">All Types</option>
		<option value="series">Series</option>
		<option value="movie">Movies</option>
	</select>

	<!-- Status Filter -->
	<select
		bind:value={status}
		onchange={onFilterChange}
		class="h-9 rounded-lg border border-glass-border/30 bg-glass/50 backdrop-blur-sm px-3 py-1 text-sm transition-all focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 hover:bg-glass/70"
	>
		<option value="all">All Status ({statusCounts.all})</option>
		<option value="missing">Missing ({statusCounts.missing})</option>
		<option value="upgrade">Upgrades ({statusCounts.upgrade})</option>
		<option value="queued">Queued ({statusCounts.queued})</option>
		<option value="searching">Searching ({statusCounts.searching})</option>
		<option value="exhausted">Exhausted ({statusCounts.exhausted})</option>
	</select>
</div>
