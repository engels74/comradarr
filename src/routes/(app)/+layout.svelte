<script lang="ts">
	import { Sidebar } from '$lib/components/layout';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();
</script>

<div class="min-h-screen">
	<Sidebar user={data.user} />
	<main class="ml-60">
		{@render children()}
	</main>
</div>
