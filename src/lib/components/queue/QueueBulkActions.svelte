<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { Button } from '$lib/components/ui/button';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';

	/**
	 * Bulk action bar for selected queue items.
	 * Provides priority adjustment and removal from queue.
	 */

	interface Props {
		selectedCount: number;
		selectedIds: Set<number>;
		onClearSelection: () => void;
		onActionStart?: (() => void) | undefined;
		onActionComplete?: ((message: string) => void) | undefined;
	}

	let { selectedCount, selectedIds, onClearSelection, onActionStart, onActionComplete }: Props = $props();

	// Serialize IDs for form submission
	const registryIdsJson = $derived(JSON.stringify([...selectedIds]));

	// Loading states
	let isAdjustingPriority = $state(false);
	let isRemoving = $state(false);

	// Dialog states
	let priorityDialogOpen = $state(false);
	let priorityValue = $state(50);
	let removeDialogOpen = $state(false);

	// Computed state
	const isAnyLoading = $derived(isAdjustingPriority || isRemoving);

	/**
	 * Creates an enhance handler for form submission.
	 */
	function createEnhanceHandler(
		setLoading: (val: boolean) => void,
		closeDialog?: () => void
	) {
		return () => {
			setLoading(true);
			onActionStart?.(); // Pause polling during form submission
			return async ({ result, update }: { result: { type: string; data?: { message?: string; error?: string } }; update: () => Promise<void> }) => {
				setLoading(false);
				closeDialog?.();

				if (result.type === 'success' && result.data?.message) {
					onActionComplete?.(result.data.message);
					onClearSelection();
					await invalidateAll();
				} else if (result.type === 'failure' && result.data?.error) {
					onActionComplete?.(`Error: ${result.data.error}`);
				}

				await update();
			};
		};
	}
</script>

{#if selectedCount > 0}
	<div class="sticky top-0 z-10 bg-background/95 backdrop-blur border-b shadow-sm mb-4">
		<div class="flex items-center justify-between px-4 py-3">
			<!-- Selection info -->
			<div class="flex items-center gap-3">
				<Button
					variant="ghost"
					size="sm"
					onclick={onClearSelection}
					disabled={isAnyLoading}
					aria-label="Clear selection"
				>
					<svg class="size-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</Button>
				<span class="text-sm font-medium">
					{selectedCount} item{selectedCount === 1 ? '' : 's'} selected
				</span>
			</div>

			<!-- Actions -->
			<div class="flex items-center gap-2">
				<!-- Adjust Priority -->
				<AlertDialog.Root bind:open={priorityDialogOpen}>
					<AlertDialog.Trigger>
						{#snippet child({ props })}
							<Button {...props} variant="outline" size="sm" disabled={isAnyLoading}>
								<svg class="size-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
								</svg>
								Set Priority
							</Button>
						{/snippet}
					</AlertDialog.Trigger>
					<AlertDialog.Portal>
						<AlertDialog.Overlay />
						<AlertDialog.Content>
							<AlertDialog.Header>
								<AlertDialog.Title>Set Priority</AlertDialog.Title>
								<AlertDialog.Description>
									Set the search priority for {selectedCount} selected item{selectedCount === 1 ? '' : 's'}.
									Higher values will be searched first.
								</AlertDialog.Description>
							</AlertDialog.Header>

							<div class="py-4">
								<label class="flex flex-col gap-2">
									<span class="text-sm font-medium">Priority (0-100)</span>
									<input
										type="range"
										min="0"
										max="100"
										bind:value={priorityValue}
										class="w-full"
									/>
									<div class="flex justify-between text-xs text-muted-foreground">
										<span>Low (0)</span>
										<span class="font-medium text-foreground">{priorityValue}</span>
										<span>High (100)</span>
									</div>
								</label>
							</div>

							<AlertDialog.Footer>
								<AlertDialog.Cancel disabled={isAdjustingPriority}>Cancel</AlertDialog.Cancel>
								<form
									method="POST"
									action="?/adjustPriority"
									use:enhance={createEnhanceHandler(
										(v) => (isAdjustingPriority = v),
										() => (priorityDialogOpen = false)
									)}
								>
									<input type="hidden" name="registryIds" value={registryIdsJson} />
									<input type="hidden" name="priority" value={priorityValue} />
									<Button type="submit" disabled={isAdjustingPriority}>
										{#if isAdjustingPriority}
											Setting...
										{:else}
											Set Priority
										{/if}
									</Button>
								</form>
							</AlertDialog.Footer>
						</AlertDialog.Content>
					</AlertDialog.Portal>
				</AlertDialog.Root>

				<!-- Remove from Queue -->
				<AlertDialog.Root bind:open={removeDialogOpen}>
					<AlertDialog.Trigger>
						{#snippet child({ props })}
							<Button {...props} variant="destructive" size="sm" disabled={isAnyLoading}>
								<svg class="size-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
								</svg>
								Remove
							</Button>
						{/snippet}
					</AlertDialog.Trigger>
					<AlertDialog.Portal>
						<AlertDialog.Overlay />
						<AlertDialog.Content>
							<AlertDialog.Header>
								<AlertDialog.Title>Remove from Queue</AlertDialog.Title>
								<AlertDialog.Description>
									Are you sure you want to remove {selectedCount} item{selectedCount === 1 ? '' : 's'} from the queue?
									Items will be reset to pending state and can be re-queued later.
								</AlertDialog.Description>
							</AlertDialog.Header>
							<AlertDialog.Footer>
								<AlertDialog.Cancel disabled={isRemoving}>Cancel</AlertDialog.Cancel>
								<form
									method="POST"
									action="?/removeFromQueue"
									use:enhance={createEnhanceHandler(
										(v) => (isRemoving = v),
										() => (removeDialogOpen = false)
									)}
								>
									<input type="hidden" name="registryIds" value={registryIdsJson} />
									<Button type="submit" variant="destructive" disabled={isRemoving}>
										{#if isRemoving}
											Removing...
										{:else}
											Remove from Queue
										{/if}
									</Button>
								</form>
							</AlertDialog.Footer>
						</AlertDialog.Content>
					</AlertDialog.Portal>
				</AlertDialog.Root>
			</div>
		</div>
	</div>
{/if}
