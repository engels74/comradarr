<script lang="ts">
	import { cn } from '$lib/utils.js';

	/**
	 * Search state values for content.
	 */
	type SearchState = 'pending' | 'queued' | 'searching' | 'cooldown' | 'exhausted' | null;

	interface Props {
		state: SearchState | string | null;
		class?: string;
	}

	let { state, class: className }: Props = $props();

	const stateConfig: Record<NonNullable<SearchState>, { bg: string; text: string; label: string }> = {
		pending: { bg: 'bg-gray-400', text: 'text-white', label: 'Pending' },
		queued: { bg: 'bg-blue-500', text: 'text-white', label: 'Queued' },
		searching: { bg: 'bg-yellow-500', text: 'text-black', label: 'Searching' },
		cooldown: { bg: 'bg-orange-500', text: 'text-white', label: 'Cooldown' },
		exhausted: { bg: 'bg-red-500', text: 'text-white', label: 'Exhausted' }
	};

	const config = $derived(
		state && state in stateConfig
			? stateConfig[state as NonNullable<SearchState>]
			: null
	);
</script>

{#if config}
	<span
		class={cn(
			'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
			config.bg,
			config.text,
			className
		)}
	>
		{config.label}
	</span>
{/if}
