<script lang="ts">
import BanIcon from '@lucide/svelte/icons/ban';
import PauseCircleIcon from '@lucide/svelte/icons/pause-circle';
import RadioIcon from '@lucide/svelte/icons/radio';
import * as Card from '$lib/components/ui/card';
import { cn } from '$lib/utils.js';
import RateLimitHelpTooltip from './RateLimitHelpTooltip.svelte';
import type { SerializedThrottleInfo } from './types';

interface Props {
	throttleInfo: Record<number, SerializedThrottleInfo>;
	pendingCount?: number;
	nextSweepRun?: string | null;
	class?: string;
	style?: string;
}

let {
	throttleInfo,
	pendingCount = 0,
	nextSweepRun = null,
	class: className = '',
	style = ''
}: Props = $props();

const connectors = $derived(Object.values(throttleInfo));

let now = $state(Date.now());

$effect(() => {
	const interval = setInterval(() => {
		now = Date.now();
	}, 1000);
	return () => clearInterval(interval);
});

const typeColors: Record<string, { badge: string; accent: string; capacityBar: string }> = {
	sonarr: {
		badge:
			'bg-[oklch(var(--accent-sonarr)/0.15)] text-[oklch(var(--accent-sonarr))] border border-[oklch(var(--accent-sonarr)/0.3)]',
		accent: 'bg-[oklch(var(--accent-sonarr))]',
		capacityBar: 'oklch(var(--accent-sonarr))'
	},
	radarr: {
		badge:
			'bg-[oklch(var(--accent-radarr)/0.15)] text-[oklch(var(--accent-radarr))] border border-[oklch(var(--accent-radarr)/0.3)]',
		accent: 'bg-[oklch(var(--accent-radarr))]',
		capacityBar: 'oklch(var(--accent-radarr))'
	},
	whisparr: {
		badge:
			'bg-[oklch(var(--accent-whisparr)/0.15)] text-[oklch(var(--accent-whisparr))] border border-[oklch(var(--accent-whisparr)/0.3)]',
		accent: 'bg-[oklch(var(--accent-whisparr))]',
		capacityBar: 'oklch(var(--accent-whisparr))'
	}
};

const defaultColors = {
	badge: 'bg-muted text-muted-foreground border border-border',
	accent: 'bg-primary',
	capacityBar: 'oklch(var(--primary))'
};

type ChannelState = 'transmitting' | 'standby' | 'cooldown' | 'offline' | 'exhausted';

interface ChannelStatus {
	state: ChannelState;
	countdownSeconds: number | null;
	countdownTotal: number;
	available: number;
}

function getChannelStatus(info: SerializedThrottleInfo, currentTime: number): ChannelStatus {
	const available = Math.max(0, info.requestsPerMinute - info.requestsThisMinute);

	if (info.pauseReason === 'daily_budget_exhausted') {
		return { state: 'exhausted', countdownSeconds: null, countdownTotal: 60, available: 0 };
	}

	if (info.isPaused) {
		return { state: 'offline', countdownSeconds: null, countdownTotal: 60, available };
	}

	if (info.searchingCount > 0) {
		return { state: 'transmitting', countdownSeconds: null, countdownTotal: 60, available };
	}

	if (info.requestsThisMinute >= info.requestsPerMinute && info.minuteWindowExpiry) {
		const remaining = Math.max(
			0,
			Math.ceil((new Date(info.minuteWindowExpiry).getTime() - currentTime) / 1000)
		);
		if (remaining > 0) {
			return { state: 'cooldown', countdownSeconds: remaining, countdownTotal: 60, available: 0 };
		}
	}

	return { state: 'standby', countdownSeconds: null, countdownTotal: 60, available };
}

function getDailyProgress(info: SerializedThrottleInfo): number | null {
	if (!info.dailyBudget) return null;
	return Math.min((info.requestsToday / info.dailyBudget) * 100, 100);
}

function getCapacityPercentage(info: SerializedThrottleInfo): number {
	if (info.requestsPerMinute === 0) return 0;
	const available = Math.max(0, info.requestsPerMinute - info.requestsThisMinute);
	return (available / info.requestsPerMinute) * 100;
}

function formatPauseTime(pausedUntil: string | null, currentTime: number): string {
	if (!pausedUntil) return '';
	const until = new Date(pausedUntil);
	const diff = until.getTime() - currentTime;
	if (diff <= 0) return '';

	const minutes = Math.ceil(diff / 60000);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	return `${hours}h ${minutes % 60}m`;
}

function formatSweepTime(nextRun: string | null, currentTime: number): string | null {
	if (!nextRun) return null;
	const diff = new Date(nextRun).getTime() - currentTime;
	if (diff <= 0) return null;

	const minutes = Math.ceil(diff / 60000);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	return `${hours}h ${minutes % 60}m`;
}

const sweepTimeFormatted = $derived(formatSweepTime(nextSweepRun, now));
</script>

{#if connectors.length > 0}
	<div class={cn('', className)} {style}>
		<div class="flex items-center justify-between mb-4">
			<div>
				<h2 class="font-display text-lg font-semibold tracking-tight">Rate Limiting Status</h2>
				<p class="text-sm text-muted-foreground">Per-connector API request limits</p>
			</div>
			<RateLimitHelpTooltip />
		</div>

		<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
			{#each connectors as connector (connector.connectorId)}
				{@const status = getChannelStatus(connector, now)}
				{@const colors = typeColors[connector.type] ?? defaultColors}
				{@const capacityPct = getCapacityPercentage(connector)}
				{@const dailyProgress = getDailyProgress(connector)}
				{@const pauseTime = formatPauseTime(connector.pausedUntil, now)}
				{@const available = status.available}

				<Card.Root
					variant="glass"
					class={cn(
						'p-4 transition-all duration-300',
						status.state === 'transmitting' && 'ring-2 ring-yellow-500/50 ring-offset-1 ring-offset-background'
					)}
				>
					<!-- Header: Type badge + Name + Status indicator -->
					<div class="flex items-center justify-between mb-3">
						<div class="flex items-center gap-2 min-w-0">
							<span
								class={cn('rounded-md px-2 py-0.5 text-xs font-medium capitalize', colors.badge)}
							>
								{connector.type}
							</span>
							<span class="font-medium text-sm truncate" title={connector.name}>
								{connector.name}
							</span>
						</div>

						<!-- Status indicator -->
						<div class="flex items-center gap-2 flex-shrink-0">
							{#if status.state === 'transmitting'}
								<!-- Pulsing radio icon with ping animation -->
								<div class="relative">
									<RadioIcon class="h-4 w-4 text-yellow-500" />
									<span class="absolute inset-0 animate-ping rounded-full bg-yellow-500/30"></span>
								</div>
								<span class="text-xs font-medium text-yellow-600 dark:text-yellow-400">
									Searching
								</span>
							{:else if status.state === 'standby'}
								<!-- Green dot + available count -->
								<span class="relative flex h-2.5 w-2.5">
									<span class="absolute inline-flex h-full w-full rounded-full bg-success opacity-75"></span>
									<span class="relative inline-flex rounded-full h-2.5 w-2.5 bg-success"></span>
								</span>
								<span class="text-xs font-medium text-success">
									{available}/{connector.requestsPerMinute}
								</span>
							{:else if status.state === 'cooldown'}
								<!-- Circular countdown timer -->
								<div class="relative h-7 w-7">
									<svg class="h-7 w-7 -rotate-90" viewBox="0 0 28 28">
										<!-- Background circle -->
										<circle
											cx="14"
											cy="14"
											r="11"
											fill="none"
											stroke="currentColor"
											stroke-width="2.5"
											class="text-muted/30"
										/>
										<!-- Progress arc -->
										<circle
											cx="14"
											cy="14"
											r="11"
											fill="none"
											stroke="currentColor"
											stroke-width="2.5"
											stroke-linecap="round"
											class="text-warning transition-[stroke-dashoffset] duration-1000 ease-linear"
											stroke-dasharray={2 * Math.PI * 11}
											stroke-dashoffset={2 * Math.PI * 11 * Math.min(Math.max(status.countdownSeconds ?? 0, 0), status.countdownTotal) / status.countdownTotal}
										/>
									</svg>
									<span class="absolute inset-0 flex items-center justify-center text-[10px] font-mono font-medium text-warning">
										{status.countdownSeconds}
									</span>
								</div>
							{:else if status.state === 'exhausted'}
								<!-- Ban icon -->
								<BanIcon class="h-4 w-4 text-destructive" />
								<span class="text-xs font-medium text-destructive">Daily Limit</span>
							{:else if status.state === 'offline'}
								<!-- Pause icon -->
								<PauseCircleIcon class="h-4 w-4 text-warning" />
								<span class="text-xs font-medium text-warning">
									Paused
									{#if pauseTime}
										<span class="text-muted-foreground">({pauseTime})</span>
									{/if}
								</span>
							{/if}
						</div>
					</div>

					<div class="space-y-3">
						<!-- Capacity bar (inverted: full = available) -->
						<div>
							<div class="flex items-center justify-between text-xs mb-1.5">
								<span class="text-muted-foreground">Capacity</span>
								{#if status.state === 'cooldown' && status.countdownSeconds !== null}
									<span class="text-warning font-medium">
										refills in {status.countdownSeconds}s
									</span>
								{:else}
									<span class="font-mono">
										{available}/{connector.requestsPerMinute}
									</span>
								{/if}
							</div>
							<!-- Bar with tick marks for limits <= 10 -->
							<div class="relative h-2 bg-muted rounded-full overflow-hidden">
								<div
									class="h-full transition-all duration-300 rounded-full"
									style="width: {capacityPct}%; background: {colors.capacityBar}"
								></div>
								<!-- Tick marks for small limits -->
								{#if connector.requestsPerMinute <= 10 && connector.requestsPerMinute > 1}
									<div class="absolute inset-0 flex">
										{#each Array(connector.requestsPerMinute - 1) as _, i}
											<div
												class="h-full border-r border-background/50"
												style="width: {100 / connector.requestsPerMinute}%"
											></div>
										{/each}
									</div>
								{/if}
							</div>
						</div>

						<!-- Daily budget -->
						{#if dailyProgress !== null}
							<div>
								<div class="flex items-center justify-between text-xs mb-1">
									<span class="text-muted-foreground">Daily budget</span>
									<span class="font-mono">
										{connector.requestsToday.toLocaleString()}/{connector.dailyBudget?.toLocaleString()}
									</span>
								</div>
								<div class="h-1.5 bg-muted rounded-full overflow-hidden">
									<div
										class={cn(
											'h-full transition-all duration-300',
											dailyProgress >= 100 && 'bg-destructive',
											dailyProgress >= 80 && dailyProgress < 100 && 'bg-warning',
											dailyProgress < 80 && 'bg-success'
										)}
										style="width: {dailyProgress}%"
									></div>
								</div>
							</div>
						{:else}
							<div class="flex items-center justify-between text-xs">
								<span class="text-muted-foreground">Daily budget</span>
								<span class="text-muted-foreground">Unlimited</span>
							</div>
						{/if}

						<!-- Queue status -->
						<div class="flex items-center justify-between text-xs pt-1 border-t border-glass-border/30">
							<span class="text-muted-foreground">Queue</span>
							<div class="flex items-center gap-2">
								{#if pendingCount > 0 && connector.searchingCount === 0 && connector.queuedCount === 0 && sweepTimeFormatted}
									<span class="text-muted-foreground/80 text-[10px]">
										{pendingCount} pending → {sweepTimeFormatted}
									</span>
								{/if}
								<span>
									{#if connector.searchingCount > 0}
										<span class="text-yellow-600 dark:text-yellow-400 font-medium">
											{connector.searchingCount} active
										</span>
										{#if connector.queuedCount > 0}
											<span class="text-muted-foreground"> · </span>
										{/if}
									{/if}
									{#if connector.queuedCount > 0}
										<span class="text-muted-foreground">{connector.queuedCount} waiting</span>
									{/if}
									{#if connector.searchingCount === 0 && connector.queuedCount === 0}
										<span class="text-muted-foreground italic">idle</span>
									{/if}
								</span>
							</div>
						</div>
					</div>
				</Card.Root>
			{/each}
		</div>
	</div>
{/if}
