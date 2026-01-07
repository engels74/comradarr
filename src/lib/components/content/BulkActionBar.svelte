<script lang="ts">
import { enhance } from '$app/forms';
import { invalidateAll } from '$app/navigation';
import * as AlertDialog from '$lib/components/ui/alert-dialog';
import { Button } from '$lib/components/ui/button';
import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
import type { BulkActionTarget } from '$lib/server/db/queries/content';

interface Props {
	selectedCount: number;
	selectedTargets: BulkActionTarget[];
	onClearSelection: () => void;
	onActionComplete?: ((message: string) => void) | undefined;
}

let { selectedCount, selectedTargets, onClearSelection, onActionComplete }: Props = $props();

const targetsJson = $derived(JSON.stringify(selectedTargets));

let isQueueing = $state(false);
let isSettingPriority = $state(false);
let isMarkingExhausted = $state(false);
let isClearingState = $state(false);

let priorityDialogOpen = $state(false);
let priorityValue = $state(50);
let exhaustedDialogOpen = $state(false);
let clearStateDialogOpen = $state(false);

const isAnyLoading = $derived(
	isQueueing || isSettingPriority || isMarkingExhausted || isClearingState
);

function createEnhanceHandler(setLoading: (val: boolean) => void, closeDialog?: () => void) {
	return () => {
		setLoading(true);
		return async ({
			result,
			update
		}: {
			result: { type: string; data?: { message?: string; error?: string } };
			update: () => Promise<void>;
		}) => {
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
	<div class="sticky top-0 z-10 glass-elevated border-b border-glass-border/30 mb-4 rounded-xl">
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
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M6 18L18 6M6 6l12 12"
						/>
					</svg>
				</Button>
				<span class="text-sm font-medium">
					{selectedCount} item{selectedCount === 1 ? '' : 's'} selected
				</span>
			</div>

			<!-- Actions -->
			<div class="flex items-center gap-2">
				<!-- Queue for Search -->
				<form
					method="POST"
					action="?/bulkQueue"
					use:enhance={createEnhanceHandler((v) => (isQueueing = v))}
				>
					<input type="hidden" name="targets" value={targetsJson} />
					<input type="hidden" name="searchType" value="gap" />
					<Button type="submit" size="sm" disabled={isAnyLoading}>
						{#if isQueueing}
							<svg class="size-4 mr-1.5 animate-spin" fill="none" viewBox="0 0 24 24">
								<circle
									class="opacity-25"
									cx="12"
									cy="12"
									r="10"
									stroke="currentColor"
									stroke-width="4"
								></circle>
								<path
									class="opacity-75"
									fill="currentColor"
									d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
								></path>
							</svg>
						{:else}
							<svg class="size-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
								/>
							</svg>
						{/if}
						Queue for Search
					</Button>
				</form>

				<!-- Set Priority -->
				<AlertDialog.Root bind:open={priorityDialogOpen}>
					<AlertDialog.Trigger>
						{#snippet child({ props })}
							<Button {...props} variant="outline" size="sm" disabled={isAnyLoading}>
								<svg class="size-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"
									/>
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
									Set the search priority for {selectedCount} selected item{selectedCount === 1
										? ''
										: 's'}. Higher values (closer to 100) will be searched first.
								</AlertDialog.Description>
							</AlertDialog.Header>

							<div class="py-4">
								<label class="flex flex-col gap-2">
									<span class="text-sm font-medium">Priority (0-100)</span>
									<input type="range" min="0" max="100" bind:value={priorityValue} class="w-full" />
									<div class="flex justify-between text-xs text-muted-foreground">
										<span>Low (0)</span>
										<span class="font-medium text-foreground">{priorityValue}</span>
										<span>High (100)</span>
									</div>
								</label>
							</div>

							<AlertDialog.Footer>
								<AlertDialog.Cancel disabled={isSettingPriority}>Cancel</AlertDialog.Cancel>
								<form
									method="POST"
									action="?/bulkSetPriority"
									use:enhance={createEnhanceHandler(
										(v) => (isSettingPriority = v),
										() => (priorityDialogOpen = false)
									)}
								>
									<input type="hidden" name="targets" value={targetsJson} />
									<input type="hidden" name="priority" value={priorityValue} />
									<Button type="submit" disabled={isSettingPriority}>
										{#if isSettingPriority}
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

				<!-- More Actions Dropdown -->
				<DropdownMenu.Root>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<Button {...props} variant="outline" size="sm" disabled={isAnyLoading}>
								<svg class="size-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z"
									/>
								</svg>
								<span class="sr-only">More actions</span>
							</Button>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Portal>
						<DropdownMenu.Content align="end">
							<DropdownMenu.Item
								onclick={() => (exhaustedDialogOpen = true)}
								class="text-destructive focus:text-destructive"
							>
								<svg class="size-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
									/>
								</svg>
								Mark as Exhausted
							</DropdownMenu.Item>
							<DropdownMenu.Separator />
							<DropdownMenu.Item onclick={() => (clearStateDialogOpen = true)}>
								<svg class="size-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
									/>
								</svg>
								Clear Search State
							</DropdownMenu.Item>
						</DropdownMenu.Content>
					</DropdownMenu.Portal>
				</DropdownMenu.Root>
			</div>
		</div>
	</div>

	<!-- Mark Exhausted Confirmation Dialog -->
	<AlertDialog.Root bind:open={exhaustedDialogOpen}>
		<AlertDialog.Portal>
			<AlertDialog.Overlay />
			<AlertDialog.Content>
				<AlertDialog.Header>
					<AlertDialog.Title>Mark as Exhausted</AlertDialog.Title>
					<AlertDialog.Description>
						Are you sure you want to mark {selectedCount} item{selectedCount === 1 ? '' : 's'} as exhausted?
						This will stop all future automatic searches for these items until you manually clear the
						state.
					</AlertDialog.Description>
				</AlertDialog.Header>
				<AlertDialog.Footer>
					<AlertDialog.Cancel disabled={isMarkingExhausted}>Cancel</AlertDialog.Cancel>
					<form
						method="POST"
						action="?/bulkMarkExhausted"
						use:enhance={createEnhanceHandler(
							(v) => (isMarkingExhausted = v),
							() => (exhaustedDialogOpen = false)
						)}
					>
						<input type="hidden" name="targets" value={targetsJson} />
						<Button type="submit" variant="destructive" disabled={isMarkingExhausted}>
							{#if isMarkingExhausted}
								Marking...
							{:else}
								Mark as Exhausted
							{/if}
						</Button>
					</form>
				</AlertDialog.Footer>
			</AlertDialog.Content>
		</AlertDialog.Portal>
	</AlertDialog.Root>

	<!-- Clear State Confirmation Dialog -->
	<AlertDialog.Root bind:open={clearStateDialogOpen}>
		<AlertDialog.Portal>
			<AlertDialog.Overlay />
			<AlertDialog.Content>
				<AlertDialog.Header>
					<AlertDialog.Title>Clear Search State</AlertDialog.Title>
					<AlertDialog.Description>
						Are you sure you want to reset the search state for {selectedCount} item{selectedCount ===
						1
							? ''
							: 's'}? This will reset attempt counts, clear cooldowns, and make items eligible for
						searching again.
					</AlertDialog.Description>
				</AlertDialog.Header>
				<AlertDialog.Footer>
					<AlertDialog.Cancel disabled={isClearingState}>Cancel</AlertDialog.Cancel>
					<form
						method="POST"
						action="?/bulkClearState"
						use:enhance={createEnhanceHandler(
							(v) => (isClearingState = v),
							() => (clearStateDialogOpen = false)
						)}
					>
						<input type="hidden" name="targets" value={targetsJson} />
						<Button type="submit" disabled={isClearingState}>
							{#if isClearingState}
								Clearing...
							{:else}
								Clear State
							{/if}
						</Button>
					</form>
				</AlertDialog.Footer>
			</AlertDialog.Content>
		</AlertDialog.Portal>
	</AlertDialog.Root>
{/if}
