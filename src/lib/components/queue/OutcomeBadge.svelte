<script lang="ts">
import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';
import CheckIcon from '@lucide/svelte/icons/check';
import ClockIcon from '@lucide/svelte/icons/clock';
import SearchXIcon from '@lucide/svelte/icons/search-x';
import { cn } from '$lib/utils.js';

/**
 * Outcome badge for search completion results.
 */
type Outcome = 'success' | 'no_results' | 'error' | 'timeout';

interface Props {
	outcome: Outcome | string;
	class?: string | undefined;
}

let { outcome, class: className }: Props = $props();

const outcomeConfig: Record<
	Outcome,
	{ bg: string; text: string; label: string; Icon: typeof CheckIcon }
> = {
	success: {
		bg: 'bg-green-500/20',
		text: 'text-green-600 dark:text-green-400',
		label: 'Success',
		Icon: CheckIcon
	},
	no_results: {
		bg: 'bg-gray-500/20',
		text: 'text-gray-600 dark:text-gray-400',
		label: 'No Results',
		Icon: SearchXIcon
	},
	error: {
		bg: 'bg-red-500/20',
		text: 'text-red-600 dark:text-red-400',
		label: 'Error',
		Icon: AlertCircleIcon
	},
	timeout: {
		bg: 'bg-orange-500/20',
		text: 'text-orange-600 dark:text-orange-400',
		label: 'Timeout',
		Icon: ClockIcon
	}
};

const config = $derived(
	outcome && outcome in outcomeConfig ? outcomeConfig[outcome as Outcome] : outcomeConfig.error
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
	<config.Icon class="h-3 w-3" />
	{config.label}
</span>
