<script lang="ts">
/**
 * Log level badge with color coding.
 */

import AlertTriangleIcon from '@lucide/svelte/icons/alert-triangle';
import BugIcon from '@lucide/svelte/icons/bug';
import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
import InfoIcon from '@lucide/svelte/icons/info';
import ScanIcon from '@lucide/svelte/icons/scan';
import type { LogLevel } from '$lib/schemas/settings';
import { cn } from '$lib/utils.js';

interface Props {
	level: LogLevel | string;
	class?: string | undefined;
}

let { level, class: className }: Props = $props();

const levelConfig: Record<
	LogLevel,
	{ bg: string; text: string; border: string; Icon: typeof CircleAlertIcon }
> = {
	error: {
		bg: 'bg-red-500/15',
		text: 'text-red-500',
		border: 'border-red-500/30',
		Icon: CircleAlertIcon
	},
	warn: {
		bg: 'bg-yellow-500/15',
		text: 'text-yellow-500',
		border: 'border-yellow-500/30',
		Icon: AlertTriangleIcon
	},
	info: {
		bg: 'bg-blue-500/15',
		text: 'text-blue-500',
		border: 'border-blue-500/30',
		Icon: InfoIcon
	},
	debug: {
		bg: 'bg-purple-500/15',
		text: 'text-purple-500',
		border: 'border-purple-500/30',
		Icon: BugIcon
	},
	trace: {
		bg: 'bg-gray-500/15',
		text: 'text-gray-500',
		border: 'border-gray-500/30',
		Icon: ScanIcon
	}
};

const config = $derived(level in levelConfig ? levelConfig[level as LogLevel] : levelConfig.info);
</script>

<span
	class={cn(
		'inline-flex items-center gap-1.5 rounded-lg border px-2 py-0.5 text-xs font-medium uppercase tracking-wide backdrop-blur-sm',
		config.bg,
		config.text,
		config.border,
		className
	)}
>
	<config.Icon class="h-3 w-3" />
	{level}
</span>
