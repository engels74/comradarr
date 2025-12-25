<script lang="ts" module>
	import { tv, type VariantProps } from 'tailwind-variants';

	export const toastVariants = tv({
		base: 'pointer-events-auto relative flex items-start gap-3 rounded-lg border p-4 pr-10 shadow-lg bg-background animate-in slide-in-from-top-2 fade-in-0 duration-200',
		variants: {
			type: {
				success: 'border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400',
				error: 'border-destructive/30 bg-destructive/10 text-destructive',
				warning: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
				info: 'border-border bg-card text-card-foreground'
			}
		},
		defaultVariants: {
			type: 'info'
		}
	});

	export type ToastVariantType = VariantProps<typeof toastVariants>['type'];
</script>

<script lang="ts">
	import { toastStore, type Toast } from '$lib/stores/toast.svelte';
	import { cn } from '$lib/utils';
	import CheckCircle2Icon from '@lucide/svelte/icons/check-circle-2';
	import XCircleIcon from '@lucide/svelte/icons/x-circle';
	import AlertTriangleIcon from '@lucide/svelte/icons/alert-triangle';
	import InfoIcon from '@lucide/svelte/icons/info';
	import XIcon from '@lucide/svelte/icons/x';
	import type { Component } from 'svelte';

	interface Props {
		toast: Toast;
		class?: string;
	}

	let { toast, class: className }: Props = $props();

	// Track dismissing state for exit animation
	let isDismissing = $state(false);

	// Icon mapping by type
	const icons: Record<Toast['type'], Component> = {
		success: CheckCircle2Icon,
		error: XCircleIcon,
		warning: AlertTriangleIcon,
		info: InfoIcon
	};

	const Icon = $derived(icons[toast.type]);

	function handleDismiss() {
		isDismissing = true;
		// Wait for exit animation before removing
		setTimeout(() => {
			toastStore.dismiss(toast.id);
		}, 150);
	}
</script>

<div
	class={cn(
		toastVariants({ type: toast.type }),
		isDismissing && 'animate-out fade-out-0 slide-out-to-right-2 duration-150',
		className
	)}
	role="alert"
	aria-atomic="true"
>
	<!-- Icon -->
	<Icon class="h-5 w-5 shrink-0 mt-0.5" />

	<!-- Message -->
	<p class="text-sm font-medium flex-1">{toast.message}</p>

	<!-- Close button -->
	{#if toast.dismissible}
		<button
			type="button"
			class="absolute top-3 right-3 p-1 rounded-md opacity-70 hover:opacity-100 transition-opacity focus:outline-none focus:ring-2 focus:ring-ring"
			onclick={handleDismiss}
			aria-label="Dismiss notification"
		>
			<XIcon class="h-4 w-4" />
		</button>
	{/if}
</div>
