<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<div class="container mx-auto p-6">
	<h1 class="text-3xl font-bold mb-4">Dashboard</h1>
	<p class="text-muted-foreground">
		Welcome, {data.user.displayName ?? data.user.username}!
	</p>
</div>
