<script lang="ts">
/**
 * Layout for authentication pages (login, logout).
 * Provides centered card container with no navigation.
 */
let { children } = $props();
</script>

<div class="flex min-h-screen items-center justify-center p-4">
	<div class="w-full max-w-md">
		{@render children()}
	</div>
</div>
