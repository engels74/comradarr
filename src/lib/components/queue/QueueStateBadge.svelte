<script lang="ts">
import Loader2Icon from '@lucide/svelte/icons/loader-2';
import * as Tooltip from '$lib/components/ui/tooltip';
import { cn } from '$lib/utils.js';

type QueueState = 'pending' | 'queued' | 'searching' | 'cooldown' | 'exhausted';

interface Props {
	state: QueueState | string;
	cooldownUntil?: string | null;
	class?: string | undefined;
}

let { state, cooldownUntil, class: className }: Props = $props();

const stateConfig: Record<
	QueueState,
	{ bg: string; text: string; label: string; tooltip: string; animate?: boolean }
> = {
	pending: {
		bg: 'bg-gray-500/20',
		text: 'text-gray-600 dark:text-gray-400',
		label: 'Scheduled',
		tooltip: 'Will be queued on the next sweep'
	},
	queued: {
		bg: 'bg-blue-500/20',
		text: 'text-blue-600 dark:text-blue-400',
		label: 'Waiting',
		tooltip: 'Waiting for rate limit slot'
	},
	searching: {
		bg: 'bg-yellow-500/20',
		text: 'text-yellow-600 dark:text-yellow-400',
		label: 'Searching',
		tooltip: 'Actively searching now',
		animate: true
	},
	cooldown: {
		bg: 'bg-orange-500/20',
		text: 'text-orange-600 dark:text-orange-400',
		label: 'Cooldown',
		tooltip: 'Failed, waiting before retry'
	},
	exhausted: {
		bg: 'bg-red-500/20',
		text: 'text-red-600 dark:text-red-400',
		label: 'No Results',
		tooltip: 'Max attempts reached, no releases found'
	}
};

const config = $derived(
	state && state in stateConfig ? stateConfig[state as QueueState] : stateConfig.pending
);

const cooldownRemaining = $derived.by(() => {
	if (state !== 'cooldown' || !cooldownUntil) return null;
	const until = new Date(cooldownUntil);
	const now = Date.now();
	const diff = until.getTime() - now;
	if (diff <= 0) return null;

	const seconds = Math.floor(diff / 1000);
	if (seconds < 60) return `${seconds}s`;

	const minutes = Math.ceil(diff / 60000);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	const remainingMinutes = minutes % 60;
	return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
});

const displayLabel = $derived.by(() => {
	if (state === 'cooldown' && cooldownRemaining) {
		return `Retry ${cooldownRemaining}`;
	}
	return config.label;
});
</script>

<Tooltip.Provider>
	<Tooltip.Root>
		<Tooltip.Trigger>
			<span
				class={cn(
					'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium cursor-help',
					config.bg,
					config.text,
					className
				)}
			>
				{#if config.animate}
					<Loader2Icon class="h-3 w-3 animate-spin" />
				{/if}
				{displayLabel}
			</span>
		</Tooltip.Trigger>
		<Tooltip.Portal>
			<Tooltip.Content>
				{config.tooltip}
			</Tooltip.Content>
		</Tooltip.Portal>
	</Tooltip.Root>
</Tooltip.Provider>
