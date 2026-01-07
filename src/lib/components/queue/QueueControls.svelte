<script lang="ts">
import { enhance } from '$app/forms';
import { invalidateAll } from '$app/navigation';
import * as AlertDialog from '$lib/components/ui/alert-dialog';
import { Badge } from '$lib/components/ui/badge';
import { Button } from '$lib/components/ui/button';
import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
import type { ConnectorPauseStatus } from '$lib/server/db/queries/queue';

interface Props {
	pauseStatus: ConnectorPauseStatus[];
	onActionStart?: (() => void) | undefined;
	onActionComplete?: ((message: string) => void) | undefined;
}

let { pauseStatus, onActionStart, onActionComplete }: Props = $props();

let isPausing = $state(false);
let isResuming = $state(false);
let isClearing = $state(false);
let clearDialogOpen = $state(false);

const isAnyLoading = $derived(isPausing || isResuming || isClearing);
const anyPaused = $derived(pauseStatus.some((c) => c.queuePaused));
const allPaused = $derived(pauseStatus.length > 0 && pauseStatus.every((c) => c.queuePaused));
const pausedCount = $derived(pauseStatus.filter((c) => c.queuePaused).length);
const totalQueueCount = $derived(pauseStatus.reduce((sum, c) => sum + c.queueCount, 0));

function createEnhanceHandler(setLoading: (val: boolean) => void, closeDialog?: () => void) {
	return () => {
		setLoading(true);
		onActionStart?.(); // Pause polling during form submission
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
				await invalidateAll();
			} else if (result.type === 'failure' && result.data?.error) {
				onActionComplete?.(`Error: ${result.data.error}`);
			}

			await update();
		};
	};
}

const typeColors: Record<string, string> = {
	sonarr: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
	radarr: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
	whisparr: 'bg-purple-500/10 text-purple-600 dark:text-purple-400'
};
</script>

<div class="flex items-center gap-2">
	<!-- Global Pause/Resume Button -->
	{#if allPaused}
		<form
			method="POST"
			action="?/resumeQueue"
			use:enhance={createEnhanceHandler((v) => (isResuming = v))}
		>
			<input type="hidden" name="connectorIds" value="" />
			<Button type="submit" variant="default" size="sm" disabled={isAnyLoading}>
				{#if isResuming}
					<svg class="size-4 mr-1.5 animate-spin" fill="none" viewBox="0 0 24 24">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"
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
							d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
						/>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
						/>
					</svg>
				{/if}
				Resume All
			</Button>
		</form>
	{:else}
		<form
			method="POST"
			action="?/pauseQueue"
			use:enhance={createEnhanceHandler((v) => (isPausing = v))}
		>
			<input type="hidden" name="connectorIds" value="" />
			<Button type="submit" variant="outline" size="sm" disabled={isAnyLoading}>
				{#if isPausing}
					<svg class="size-4 mr-1.5 animate-spin" fill="none" viewBox="0 0 24 24">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"
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
							d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z"
						/>
					</svg>
				{/if}
				Pause All
			</Button>
		</form>
	{/if}

	<!-- Per-Connector Dropdown -->
	{#if pauseStatus.length > 1}
		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<Button {...props} variant="outline" size="sm" disabled={isAnyLoading}>
						<svg class="size-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M19 9l-7 7-7-7"
							/>
						</svg>
						Connectors
						{#if anyPaused}
							<Badge variant="secondary" class="ml-1.5 text-xs">
								{pausedCount} paused
							</Badge>
						{/if}
					</Button>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Portal>
				<DropdownMenu.Content align="end" class="w-56">
					<DropdownMenu.Label>Connector Status</DropdownMenu.Label>
					<DropdownMenu.Separator />
					{#each pauseStatus as connector}
						<DropdownMenu.Sub>
							<DropdownMenu.SubTrigger>
								<div class="flex items-center gap-2 w-full">
									<span
										class={`rounded px-1.5 py-0.5 text-xs font-medium ${typeColors[connector.type] ?? 'bg-gray-500/10 text-gray-600'}`}
									>
										{connector.type}
									</span>
									<span class="flex-1 truncate">{connector.name}</span>
									{#if connector.queuePaused}
										<Badge variant="secondary" class="text-xs">Paused</Badge>
									{:else}
										<Badge variant="outline" class="text-xs">{connector.queueCount}</Badge>
									{/if}
								</div>
							</DropdownMenu.SubTrigger>
							<DropdownMenu.SubContent>
								{#if connector.queuePaused}
									<form
										method="POST"
										action="?/resumeQueue"
										use:enhance={createEnhanceHandler((v) => (isResuming = v))}
									>
										<input
											type="hidden"
											name="connectorIds"
											value={JSON.stringify([connector.id])}
										/>
										<DropdownMenu.Item>
											<button
												type="submit"
												class="flex items-center gap-2 w-full"
												disabled={isAnyLoading}
											>
												<svg class="size-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
													<path
														stroke-linecap="round"
														stroke-linejoin="round"
														stroke-width="2"
														d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
													/>
												</svg>
												Resume
											</button>
										</DropdownMenu.Item>
									</form>
								{:else}
									<form
										method="POST"
										action="?/pauseQueue"
										use:enhance={createEnhanceHandler((v) => (isPausing = v))}
									>
										<input
											type="hidden"
											name="connectorIds"
											value={JSON.stringify([connector.id])}
										/>
										<DropdownMenu.Item>
											<button
												type="submit"
												class="flex items-center gap-2 w-full"
												disabled={isAnyLoading}
											>
												<svg class="size-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
													<path
														stroke-linecap="round"
														stroke-linejoin="round"
														stroke-width="2"
														d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z"
													/>
												</svg>
												Pause
											</button>
										</DropdownMenu.Item>
									</form>
								{/if}
							</DropdownMenu.SubContent>
						</DropdownMenu.Sub>
					{/each}
				</DropdownMenu.Content>
			</DropdownMenu.Portal>
		</DropdownMenu.Root>
	{/if}

	<!-- Clear Queue -->
	<AlertDialog.Root bind:open={clearDialogOpen}>
		<AlertDialog.Trigger>
			{#snippet child({ props })}
				<Button
					{...props}
					variant="outline"
					size="sm"
					disabled={isAnyLoading || totalQueueCount === 0}
				>
					<svg class="size-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
						/>
					</svg>
					Clear Queue
				</Button>
			{/snippet}
		</AlertDialog.Trigger>
		<AlertDialog.Portal>
			<AlertDialog.Overlay />
			<AlertDialog.Content>
				<AlertDialog.Header>
					<AlertDialog.Title>Clear Queue</AlertDialog.Title>
					<AlertDialog.Description>
						Are you sure you want to clear {totalQueueCount} item{totalQueueCount !== 1 ? 's' : ''} from
						the queue? Items will be reset to pending state and can be re-queued later.
					</AlertDialog.Description>
				</AlertDialog.Header>
				<AlertDialog.Footer>
					<AlertDialog.Cancel disabled={isClearing}>Cancel</AlertDialog.Cancel>
					<form
						method="POST"
						action="?/clearQueue"
						use:enhance={createEnhanceHandler(
							(v) => (isClearing = v),
							() => (clearDialogOpen = false)
						)}
					>
						<input type="hidden" name="connectorIds" value="" />
						<Button type="submit" variant="destructive" disabled={isClearing}>
							{#if isClearing}
								Clearing...
							{:else}
								Clear Queue
							{/if}
						</Button>
					</form>
				</AlertDialog.Footer>
			</AlertDialog.Content>
		</AlertDialog.Portal>
	</AlertDialog.Root>
</div>
