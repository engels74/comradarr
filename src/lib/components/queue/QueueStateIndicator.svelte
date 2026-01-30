<script lang="ts">
import BanIcon from '@lucide/svelte/icons/ban';
import CheckCircleIcon from '@lucide/svelte/icons/check-circle';
import ClockIcon from '@lucide/svelte/icons/clock';
import PauseCircleIcon from '@lucide/svelte/icons/pause-circle';
import RadioIcon from '@lucide/svelte/icons/radio';
import TimerIcon from '@lucide/svelte/icons/timer';
import { enhance } from '$app/forms';
import { Button } from '$lib/components/ui/button';
import { cn } from '$lib/utils.js';
import type { GlobalQueueState, QueueSchedulerStatus, SerializedThrottleInfo } from './types';

interface StatusCounts {
	pending: number;
	queued: number;
	searching: number;
	cooldown: number;
	exhausted: number;
}

interface ConnectorPauseStatus {
	id: number;
	name: string;
	type: string;
	queuePaused: boolean;
	queueCount: number;
}

interface Props {
	statusCounts: StatusCounts;
	throttleInfo: Record<number, SerializedThrottleInfo>;
	schedulerStatus: QueueSchedulerStatus;
	pauseStatus: ConnectorPauseStatus[];
	class?: string;
	style?: string;
	onActionStart?: () => void;
	onActionComplete?: (message: string) => void;
}

let {
	statusCounts,
	throttleInfo,
	schedulerStatus,
	pauseStatus,
	class: className = '',
	style = '',
	onActionStart,
	onActionComplete
}: Props = $props();

const allPaused = $derived(pauseStatus.length > 0 && pauseStatus.every((c) => c.queuePaused));

let now = $state(Date.now());

$effect(() => {
	const interval = setInterval(() => {
		now = Date.now();
	}, 1000);
	return () => clearInterval(interval);
});

const total = $derived(
	statusCounts.pending +
		statusCounts.queued +
		statusCounts.searching +
		statusCounts.cooldown +
		statusCounts.exhausted
);

const connectorList = $derived(Object.values(throttleInfo));
const allExhausted = $derived(
	connectorList.length > 0 && connectorList.every((c) => c.pauseReason === 'daily_budget_exhausted')
);

function computeGlobalState(): GlobalQueueState {
	if (total === 0) return 'idle';
	if (allPaused) return 'paused';
	if (allExhausted) return 'throttled';
	if (statusCounts.searching > 0) return 'processing';
	if (statusCounts.queued > 0 || statusCounts.cooldown > 0) return 'waiting-rate';
	if (statusCounts.pending > 0) return 'waiting-sweep';
	return 'idle';
}

const globalState = $derived(computeGlobalState());

const activeConnectors = $derived(
	connectorList.filter((c) => c.searchingCount > 0).map((c) => `${c.name}: ${c.searchingCount}`)
);

const dispatchedCount = $derived(statusCounts.searching);

function getSecondsUntilSweep(): number | null {
	if (!schedulerStatus.sweep.nextRun) return null;
	const diff = new Date(schedulerStatus.sweep.nextRun).getTime() - now;
	return Math.max(0, Math.floor(diff / 1000));
}

const secondsUntilSweep = $derived(getSecondsUntilSweep());

function formatCountdown(seconds: number | null): { minutes: string; seconds: string } {
	if (seconds === null) return { minutes: '--', seconds: '--' };
	const mins = Math.floor(seconds / 60);
	const secs = seconds % 60;
	return {
		minutes: String(mins).padStart(2, '0'),
		seconds: String(secs).padStart(2, '0')
	};
}

const countdown = $derived(formatCountdown(secondsUntilSweep));

const sweepTimeFormatted = $derived.by(() => {
	if (!schedulerStatus.sweep.nextRun) return null;
	const diff = new Date(schedulerStatus.sweep.nextRun).getTime() - now;
	if (diff <= 0) return null;

	const seconds = Math.max(1, Math.floor(diff / 1000));
	if (seconds < 60) return `${seconds}s`;

	const minutes = Math.ceil(diff / 60000);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	return `${hours}h ${minutes % 60}m`;
});

const stateConfig = $derived.by(() => {
	switch (globalState) {
		case 'processing':
			return {
				icon: RadioIcon,
				label: 'SEARCHING',
				count: statusCounts.searching,
				colorClass: 'text-yellow-500',
				bgClass: 'bg-yellow-500/10',
				borderClass: 'ring-yellow-500/50',
				pulsing: true
			};
		case 'waiting-sweep':
			return {
				icon: ClockIcon,
				label: 'SCHEDULED',
				count: statusCounts.pending,
				colorClass: 'text-muted-foreground',
				bgClass: 'bg-muted/50',
				borderClass: 'ring-muted-foreground/30',
				pulsing: false
			};
		case 'waiting-rate':
			return {
				icon: TimerIcon,
				label: 'QUEUED',
				count: statusCounts.queued + statusCounts.cooldown,
				colorClass: 'text-primary',
				bgClass: 'bg-primary/10',
				borderClass: 'ring-primary/50',
				pulsing: false
			};
		case 'paused':
			return {
				icon: PauseCircleIcon,
				label: 'PAUSED',
				count: null,
				colorClass: 'text-warning',
				bgClass: 'bg-warning/10',
				borderClass: 'ring-warning/50',
				pulsing: false
			};
		case 'throttled':
			return {
				icon: BanIcon,
				label: 'THROTTLED',
				count: null,
				colorClass: 'text-destructive',
				bgClass: 'bg-destructive/10',
				borderClass: 'ring-destructive/50',
				pulsing: false
			};
		default:
			return {
				icon: CheckCircleIcon,
				label: 'IDLE',
				count: null,
				colorClass: 'text-success',
				bgClass: 'bg-success/10',
				borderClass: 'ring-success/30',
				pulsing: false
			};
	}
});

const progressPercent = $derived(total > 0 ? (dispatchedCount / total) * 100 : 0);
const showTriggerButton = $derived(globalState === 'waiting-sweep' && statusCounts.pending > 0);
const showCountdown = $derived(
	(globalState === 'waiting-sweep' || globalState === 'waiting-rate') && secondsUntilSweep !== null
);

let isTriggering = $state(false);
</script>

<div
	class={cn(
		'glass-panel p-4 transition-all duration-300',
		stateConfig.pulsing && 'ring-2 ring-offset-1 ring-offset-background',
		stateConfig.pulsing && stateConfig.borderClass,
		className
	)}
	{style}
>
	<div class="flex items-center justify-between gap-4">
		<!-- Left: Status info -->
		<div class="flex-1 min-w-0">
			<div class="flex items-center gap-3">
				<!-- Status icon -->
				<div class={cn('relative flex-shrink-0', stateConfig.colorClass)}>
					<stateConfig.icon class="h-5 w-5" />
					{#if stateConfig.pulsing}
						<span class="absolute inset-0 animate-ping rounded-full bg-yellow-500/30"></span>
					{/if}
				</div>

				<!-- Status text -->
				<div class="min-w-0">
					<div class="flex items-center gap-2 flex-wrap">
						<span class={cn('font-display font-semibold tracking-wide', stateConfig.colorClass)}>
							{stateConfig.label}
						</span>
						{#if stateConfig.count !== null}
							<span class="text-muted-foreground">
								· {stateConfig.count} item{stateConfig.count !== 1 ? 's' : ''}
							</span>
						{/if}
					</div>

					{#if globalState === 'processing' && activeConnectors.length > 0}
						<p class="text-sm text-muted-foreground truncate">
							{activeConnectors.join(' · ')}
						</p>
					{:else if globalState === 'waiting-sweep'}
						<p class="text-sm text-muted-foreground">
							Pending items will be enqueued on next sweep
						</p>
					{:else if globalState === 'waiting-rate'}
						<p class="text-sm text-muted-foreground">
							Waiting for rate limit capacity
						</p>
					{:else if globalState === 'paused'}
						<p class="text-sm text-muted-foreground">
							Queue processing is paused
						</p>
					{:else if globalState === 'throttled'}
						<p class="text-sm text-muted-foreground">
							Daily budget exhausted for all connectors
						</p>
					{:else if globalState === 'idle'}
						<p class="text-sm text-muted-foreground">
							{#if sweepTimeFormatted}
								Next sweep in <span class="font-mono tabular-nums">{sweepTimeFormatted}</span>
							{:else}
								No items in queue
							{/if}
						</p>
					{/if}
				</div>
			</div>

			<!-- Progress mini-bar -->
			{#if total > 0 && globalState !== 'idle'}
				<div class="mt-3">
					<div class="flex items-center justify-between text-xs text-muted-foreground mb-1">
						<span>Progress</span>
						<span class="font-mono">{dispatchedCount}/{total} dispatching</span>
					</div>
					<div class="h-1.5 bg-muted rounded-full overflow-hidden">
						<div
							class={cn(
								'h-full transition-all duration-300 rounded-full',
								globalState === 'processing' && 'bg-yellow-500',
								globalState === 'waiting-rate' && 'bg-primary',
								globalState === 'waiting-sweep' && 'bg-muted-foreground',
								globalState === 'paused' && 'bg-warning',
								globalState === 'throttled' && 'bg-destructive'
							)}
							style="width: {progressPercent}%"
						></div>
					</div>
				</div>
			{/if}
		</div>

		<!-- Right: Countdown + Action -->
		<div class="flex items-center gap-3 flex-shrink-0">
			{#if showCountdown}
				<div class="text-center">
					<div class="font-mono text-2xl font-medium tabular-nums text-foreground">
						{countdown.minutes}:{countdown.seconds}
					</div>
					<div class="text-xs text-muted-foreground">next sweep</div>
				</div>
			{/if}

			{#if showTriggerButton}
				<form
					method="POST"
					action="?/triggerSweep"
					use:enhance={() => {
						isTriggering = true;
						onActionStart?.();
						return async ({ result, update }) => {
							isTriggering = false;
							if (result.type === 'success' && result.data) {
								const data = result.data as { message?: string };
								onActionComplete?.(data.message ?? 'Sweep triggered');
							} else if (result.type === 'failure' && result.data) {
								const data = result.data as { error?: string };
								onActionComplete?.(data.error ?? 'Sweep failed');
							} else if (result.type === 'error') {
								onActionComplete?.('An error occurred');
							}
							await update();
						};
					}}
				>
					<Button
						type="submit"
						variant="secondary"
						size="sm"
						class="gap-1.5"
						disabled={isTriggering || schedulerStatus.sweep.isRunning}
					>
						<ClockIcon class="h-3.5 w-3.5" />
						{isTriggering ? 'Triggering...' : 'Trigger Now'}
					</Button>
				</form>
			{/if}
		</div>
	</div>
</div>
