<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import type { TimePeriod } from './types';

	interface Props {
		value: TimePeriod;
		onchange: (period: TimePeriod) => void;
		class?: string;
	}

	let { value, onchange, class: className = '' }: Props = $props();

	const periods: { value: TimePeriod; label: string }[] = [
		{ value: '24h', label: '24h' },
		{ value: '7d', label: '7d' },
		{ value: '30d', label: '30d' }
	];
</script>

<div class="inline-flex rounded-md border border-border {className}" role="group">
	{#each periods as period}
		<Button
			variant={value === period.value ? 'default' : 'ghost'}
			size="sm"
			class="rounded-none first:rounded-l-md last:rounded-r-md border-0 {value === period.value
				? ''
				: 'hover:bg-muted'}"
			onclick={() => onchange(period.value)}
		>
			{period.label}
		</Button>
	{/each}
</div>
