<script lang="ts">
import type { HTMLInputAttributes, HTMLInputTypeAttribute } from 'svelte/elements';
import { cn, type WithElementRef } from '$lib/utils.js';

type InputType = Exclude<HTMLInputTypeAttribute, 'file'>;

type Props = WithElementRef<
	Omit<HTMLInputAttributes, 'type'> &
		({ type: 'file'; files?: FileList } | { type?: InputType; files?: undefined })
>;

let {
	ref = $bindable(null),
	value = $bindable(),
	type,
	files = $bindable(),
	class: className,
	'data-slot': dataSlot = 'input',
	...restProps
}: Props = $props();

const baseStyles =
	'flex h-10 w-full min-w-0 rounded-lg border px-3 py-2 text-base outline-none transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm';
const glassStyles = 'bg-glass/40 dark:bg-glass/30 border-glass-border/30 backdrop-blur-sm';
const focusStyles =
	'focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:bg-glass/50';
const textStyles =
	'selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground/70 text-foreground';
const invalidStyles =
	'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive';
</script>

{#if type === 'file'}
	<input
		bind:this={ref}
		data-slot={dataSlot}
		class={cn(
			baseStyles,
			glassStyles,
			focusStyles,
			textStyles,
			invalidStyles,
			'pt-2 font-medium',
			className
		)}
		type="file"
		bind:files
		bind:value
		{...restProps}
	/>
{:else}
	<input
		bind:this={ref}
		data-slot={dataSlot}
		class={cn(
			baseStyles,
			glassStyles,
			focusStyles,
			textStyles,
			invalidStyles,
			className
		)}
		{type}
		bind:value
		{...restProps}
	/>
{/if}
