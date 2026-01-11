<script lang="ts">
import ClockIcon from '@lucide/svelte/icons/clock';
import Loader2Icon from '@lucide/svelte/icons/loader-2';
import { cn } from '$lib/utils.js';

type SearchState = 'pending' | 'queued' | 'searching' | 'cooldown' | 'exhausted' | null;

interface Props {
	state: SearchState | string | null;
	count?: number | null;
	class?: string;
}

let { state, count, class: className }: Props = $props();

const stateConfig: Record<
	NonNullable<SearchState>,
	{ bg: string; text: string; label: string; icon?: 'spinner' | 'clock' }
> = {
	pending: {
		bg: 'bg-gray-500/20',
		text: 'text-gray-600 dark:text-gray-400',
		label: 'Pending'
	},
	queued: {
		bg: 'bg-blue-500/20',
		text: 'text-blue-600 dark:text-blue-400',
		label: 'Queued',
		icon: 'clock'
	},
	searching: {
		bg: 'bg-yellow-500/20',
		text: 'text-yellow-600 dark:text-yellow-400',
		label: 'Searching',
		icon: 'spinner'
	},
	cooldown: {
		bg: 'bg-orange-500/20',
		text: 'text-orange-600 dark:text-orange-400',
		label: 'Cooldown',
		icon: 'clock'
	},
	exhausted: {
		bg: 'bg-red-500/20',
		text: 'text-red-600 dark:text-red-400',
		label: 'Exhausted'
	}
};

const config = $derived(
	state && Object.hasOwn(stateConfig, state) ? stateConfig[state as NonNullable<SearchState>] : null
);

const displayLabel = $derived.by(() => {
	if (!config) return '';
	if (count && count > 1) {
		return `${config.label} (${count})`;
	}
	return config.label;
});
</script>

{#if config}
	<span
		class={cn(
			'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
			config.bg,
			config.text,
			className
		)}
	>
		{#if config.icon === 'spinner'}
			<Loader2Icon class="h-3 w-3 animate-spin" />
		{:else if config.icon === 'clock'}
			<ClockIcon class="h-3 w-3" />
		{/if}
		{displayLabel}
	</span>
{/if}
