<script lang="ts">
import type { HTMLAttributes } from 'svelte/elements';
import { cn, type WithElementRef } from '$lib/utils.js';

interface CardProps extends WithElementRef<HTMLAttributes<HTMLDivElement>> {
	variant?: 'default' | 'glass' | 'elevated';
}

let {
	ref = $bindable(null),
	class: className,
	variant = 'default',
	children,
	...restProps
}: CardProps = $props();

const variantStyles = {
	default: 'bg-card border-border shadow-sm',
	glass: 'glass-panel',
	elevated: 'glass-elevated'
};
</script>

<div
	bind:this={ref}
	data-slot="card"
	class={cn(
		'flex flex-col gap-6 rounded-xl border py-6 text-card-foreground transition-all duration-200',
		variantStyles[variant],
		className
	)}
	{...restProps}
>
	{@render children?.()}
</div>
