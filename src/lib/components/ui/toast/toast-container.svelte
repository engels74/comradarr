<script lang="ts">
	/**
	 * Toast container component.
	 * Renders toast notifications in a fixed position with proper accessibility.
	 */
	import { toastStore } from '$lib/stores/toast.svelte';
	import ToastItem from './toast-item.svelte';
</script>

<!-- Toast container - fixed top-right, stacks vertically -->
{#if toastStore.toasts.length > 0}
	<div
		class="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none w-full max-w-sm"
		role="region"
		aria-label="Notifications"
		aria-live="polite"
	>
		{#each toastStore.toasts as toast (toast.id)}
			<ToastItem {toast} />
		{/each}
	</div>
{/if}
