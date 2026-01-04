<script lang="ts" module>
import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';
import { tv, type VariantProps } from 'tailwind-variants';
import { cn, type WithElementRef } from '$lib/utils.js';

export const buttonVariants = tv({
	base: "focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium outline-none transition-all duration-200 focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0 active:scale-[0.98]",
	variants: {
		variant: {
			default:
				'bg-primary text-primary-foreground shadow-md shadow-primary/20 hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/30',
			destructive:
				'bg-destructive shadow-md shadow-destructive/20 hover:bg-destructive/90 hover:shadow-lg hover:shadow-destructive/30 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 text-white',
			outline:
				'bg-transparent shadow-sm hover:bg-accent/30 hover:text-accent-foreground dark:bg-glass/30 dark:border-glass-border/40 dark:hover:bg-glass/50 border backdrop-blur-sm',
			secondary: 'bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80',
			ghost: 'hover:bg-accent/40 hover:text-accent-foreground dark:hover:bg-accent/30',
			link: 'text-primary underline-offset-4 hover:underline',
			glass:
				'bg-glass/50 backdrop-blur-xl border border-glass-border/30 text-foreground hover:bg-glass/70 hover:border-glass-border/50 shadow-sm'
		},
		size: {
			default: 'h-9 px-4 py-2 has-[>svg]:px-3',
			sm: 'h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5',
			lg: 'h-10 rounded-lg px-6 has-[>svg]:px-4',
			icon: 'size-9 rounded-lg',
			'icon-sm': 'size-8 rounded-md',
			'icon-lg': 'size-10 rounded-lg'
		}
	},
	defaultVariants: {
		variant: 'default',
		size: 'default'
	}
});

export type ButtonVariant = VariantProps<typeof buttonVariants>['variant'];
export type ButtonSize = VariantProps<typeof buttonVariants>['size'];

export type ButtonProps = WithElementRef<HTMLButtonAttributes> &
	WithElementRef<HTMLAnchorAttributes> & {
		variant?: ButtonVariant;
		size?: ButtonSize;
	};
</script>

<script lang="ts">
	let {
		class: className,
		variant = 'default',
		size = 'default',
		ref = $bindable(null),
		href = undefined,
		type = 'button',
		disabled,
		children,
		...restProps
	}: ButtonProps = $props();
</script>

{#if href}
	<a
		bind:this={ref}
		data-slot="button"
		class={cn(buttonVariants({ variant, size }), className)}
		href={disabled ? undefined : href}
		aria-disabled={disabled}
		role={disabled ? 'link' : undefined}
		tabindex={disabled ? -1 : undefined}
		{...restProps}
	>
		{@render children?.()}
	</a>
{:else}
	<button
		bind:this={ref}
		data-slot="button"
		class={cn(buttonVariants({ variant, size }), className)}
		{type}
		{disabled}
		{...restProps}
	>
		{@render children?.()}
	</button>
{/if}
