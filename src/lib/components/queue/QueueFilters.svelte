<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { Input } from '$lib/components/ui/input';
	import type { QueueStatusCounts, QueueConnector } from '$lib/server/db/queries/queue';

	/**
	 * Queue filter controls with URL-based state.
	 */

	interface Props {
		connectors: QueueConnector[];
		statusCounts: QueueStatusCounts;
	}

	let { connectors, statusCounts }: Props = $props();

	// Initialize from URL params
	let search = $state($page.url.searchParams.get('search') ?? '');
	let connectorId = $state($page.url.searchParams.get('connector') ?? '');
	let contentType = $state($page.url.searchParams.get('type') ?? 'all');
	let queueState = $state($page.url.searchParams.get('state') ?? 'all');
	let searchType = $state($page.url.searchParams.get('searchType') ?? 'all');

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
		if (queueState !== 'all') params.set('state', queueState);
		if (searchType !== 'all') params.set('searchType', searchType);

		// Preserve pagination
		const currentLimit = $page.url.searchParams.get('limit');
		if (currentLimit) params.set('limit', currentLimit);

		goto(`/queue?${params.toString()}`, { replaceState: true, keepFocus: true });
	}

	/**
	 * Handles search input with debounce.
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

<div class="flex flex-wrap gap-4 mb-6">
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
		class="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
	>
		<option value="">All Connectors</option>
		{#each connectors as c (c.id)}
			<option value={c.id.toString()}>{c.name} ({c.queueCount})</option>
		{/each}
	</select>

	<!-- Content Type Filter -->
	<select
		bind:value={contentType}
		onchange={onFilterChange}
		class="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
	>
		<option value="all">All Types</option>
		<option value="episode">Episodes</option>
		<option value="movie">Movies</option>
	</select>

	<!-- State Filter -->
	<select
		bind:value={queueState}
		onchange={onFilterChange}
		class="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
	>
		<option value="all">All States ({statusCounts.all})</option>
		<option value="pending">Pending ({statusCounts.pending})</option>
		<option value="queued">Queued ({statusCounts.queued})</option>
		<option value="searching">Searching ({statusCounts.searching})</option>
		<option value="cooldown">Cooldown ({statusCounts.cooldown})</option>
		<option value="exhausted">Exhausted ({statusCounts.exhausted})</option>
	</select>

	<!-- Search Type Filter -->
	<select
		bind:value={searchType}
		onchange={onFilterChange}
		class="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
	>
		<option value="all">All Search Types</option>
		<option value="gap">Gaps (Missing)</option>
		<option value="upgrade">Upgrades</option>
	</select>
</div>
