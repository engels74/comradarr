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

const levelConfig: Record<LogLevel, { bg: string; text: string; Icon: typeof CircleAlertIcon }> = {
	error: {
		bg: 'bg-red-500/20',
		text: 'text-red-600 dark:text-red-400',
		Icon: CircleAlertIcon
	},
	warn: {
		bg: 'bg-yellow-500/20',
		text: 'text-yellow-600 dark:text-yellow-400',
		Icon: AlertTriangleIcon
	},
	info: {
		bg: 'bg-blue-500/20',
		text: 'text-blue-600 dark:text-blue-400',
		Icon: InfoIcon
	},
	debug: {
		bg: 'bg-purple-500/20',
		text: 'text-purple-600 dark:text-purple-400',
		Icon: BugIcon
	},
	trace: {
		bg: 'bg-gray-500/20',
		text: 'text-gray-600 dark:text-gray-400',
		Icon: ScanIcon
	}
};

const config = $derived(level in levelConfig ? levelConfig[level as LogLevel] : levelConfig.info);
</script>

<span
	class={cn(
		'inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium uppercase tracking-wide',
		config.bg,
		config.text,
		className
	)}
>
	<config.Icon class="h-3 w-3" />
	{level}
</span>
