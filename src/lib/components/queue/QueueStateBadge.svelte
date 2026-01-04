<script lang="ts">
	import { cn } from '$lib/utils.js';
	import Loader2Icon from '@lucide/svelte/icons/loader-2';

	/**
	 * Queue state badge with processing indicator.
	 */
	type QueueState = 'pending' | 'queued' | 'searching' | 'cooldown' | 'exhausted';

	interface Props {
		state: QueueState | string;
		class?: string | undefined;
	}

	let { state, class: className }: Props = $props();

	const stateConfig: Record<
		QueueState,
		{ bg: string; text: string; label: string; animate?: boolean }
	> = {
		pending: { bg: 'bg-gray-500/20', text: 'text-gray-600 dark:text-gray-400', label: 'Pending' },
		queued: { bg: 'bg-blue-500/20', text: 'text-blue-600 dark:text-blue-400', label: 'Queued' },
		searching: {
			bg: 'bg-yellow-500/20',
			text: 'text-yellow-600 dark:text-yellow-400',
			label: 'Searching',
			animate: true
		},
		cooldown: {
			bg: 'bg-orange-500/20',
			text: 'text-orange-600 dark:text-orange-400',
			label: 'Cooldown'
		},
		exhausted: { bg: 'bg-red-500/20', text: 'text-red-600 dark:text-red-400', label: 'Exhausted' }
	};

	const config = $derived(
		state && state in stateConfig ? stateConfig[state as QueueState] : stateConfig.pending
	);
</script>

<span
	class={cn(
		'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
		config.bg,
		config.text,
		className
	)}
>
	{#if config.animate}
		<Loader2Icon class="h-3 w-3 animate-spin" />
	{/if}
	{config.label}
</span>
