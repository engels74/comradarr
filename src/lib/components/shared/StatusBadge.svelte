<script lang="ts">
	import { cn } from '$lib/utils.js';

	/**
	 * Health status values for connectors.
	 * Requirement 22.4: Consistent color coding
	 */
	type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'offline' | 'unknown';

	interface Props {
		status: HealthStatus | string;
		class?: string;
	}

	let { status, class: className }: Props = $props();

	const statusConfig: Record<HealthStatus, { bg: string; text: string; label: string }> = {
		healthy: { bg: 'bg-green-500', text: 'text-white', label: 'Healthy' },
		degraded: { bg: 'bg-yellow-500', text: 'text-black', label: 'Degraded' },
		unhealthy: { bg: 'bg-red-500', text: 'text-white', label: 'Unhealthy' },
		offline: { bg: 'bg-gray-500', text: 'text-white', label: 'Offline' },
		unknown: { bg: 'bg-gray-400', text: 'text-white', label: 'Unknown' }
	};

	const config = $derived(
		statusConfig[status as HealthStatus] ?? statusConfig.unknown
	);
</script>

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
