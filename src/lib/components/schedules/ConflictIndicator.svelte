<script lang="ts">
	/**
	 * Conflict Indicator - displays a warning when sweeps conflict.
	 */
	import * as Tooltip from '$lib/components/ui/tooltip';
	import AlertTriangleIcon from '@lucide/svelte/icons/alert-triangle';
	import { conflictColors } from './types';

	interface Props {
		/** Number of conflicting schedules */
		conflictCount: number;
		/** Names of conflicting schedules (for tooltip) */
		conflictNames?: string[];
		/** Additional CSS classes */
		class?: string;
	}

	let { conflictCount, conflictNames = [], class: className = '' }: Props = $props();

	const tooltipText = $derived(() => {
		if (conflictNames.length === 0) {
			return `${conflictCount} conflict${conflictCount > 1 ? 's' : ''} within 5 minutes`;
		}
		if (conflictNames.length === 1) {
			return `Conflicts with: ${conflictNames[0]}`;
		}
		return `Conflicts with: ${conflictNames.slice(0, 2).join(', ')}${conflictNames.length > 2 ? ` +${conflictNames.length - 2} more` : ''}`;
	});
</script>

{#if conflictCount > 0}
	<Tooltip.Provider>
		<Tooltip.Root>
			<Tooltip.Trigger>
				<span
					class="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium {conflictColors.bg} {conflictColors.text} {conflictColors.border} border {className}"
				>
					<AlertTriangleIcon class="h-3 w-3" />
					<span class="sr-only">Conflict</span>
				</span>
			</Tooltip.Trigger>
			<Tooltip.Portal>
				<Tooltip.Content>
					<p>{tooltipText()}</p>
				</Tooltip.Content>
			</Tooltip.Portal>
		</Tooltip.Root>
	</Tooltip.Provider>
{/if}
