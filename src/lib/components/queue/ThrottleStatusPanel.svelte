<script lang="ts">
import BanIcon from '@lucide/svelte/icons/ban';
import ClockIcon from '@lucide/svelte/icons/clock';
import GaugeIcon from '@lucide/svelte/icons/gauge';
import Loader2Icon from '@lucide/svelte/icons/loader-2';
import PauseCircleIcon from '@lucide/svelte/icons/pause-circle';
import ZapIcon from '@lucide/svelte/icons/zap';
import * as Card from '$lib/components/ui/card';
import { cn } from '$lib/utils.js';
import RateLimitHelpTooltip from './RateLimitHelpTooltip.svelte';
import type { SerializedThrottleInfo } from './types';

interface Props {
	throttleInfo: Record<number, SerializedThrottleInfo>;
	class?: string;
	style?: string;
}

let { throttleInfo, class: className = '', style = '' }: Props = $props();

const connectors = $derived(Object.values(throttleInfo));

let now = $state(Date.now());

$effect(() => {
	const interval = setInterval(() => {
		now = Date.now();
	}, 1000);
	return () => clearInterval(interval);
});

const typeColors: Record<string, { badge: string; accent: string }> = {
	sonarr: {
		badge:
			'bg-[oklch(var(--accent-sonarr)/0.15)] text-[oklch(var(--accent-sonarr))] border border-[oklch(var(--accent-sonarr)/0.3)]',
		accent: 'bg-[oklch(var(--accent-sonarr))]'
	},
	radarr: {
		badge:
			'bg-[oklch(var(--accent-radarr)/0.15)] text-[oklch(var(--accent-radarr))] border border-[oklch(var(--accent-radarr)/0.3)]',
		accent: 'bg-[oklch(var(--accent-radarr))]'
	},
	whisparr: {
		badge:
			'bg-[oklch(var(--accent-whisparr)/0.15)] text-[oklch(var(--accent-whisparr))] border border-[oklch(var(--accent-whisparr)/0.3)]',
		accent: 'bg-[oklch(var(--accent-whisparr))]'
	}
};

const defaultColors = {
	badge: 'bg-muted text-muted-foreground border border-border',
	accent: 'bg-primary'
};

type StatusType = 'searching' | 'ready' | 'at_limit' | 'paused' | 'daily_exhausted';

function getStatus(
	info: SerializedThrottleInfo,
	currentTime: number
): {
	type: StatusType;
	label: string;
	color: string;
	icon: typeof ZapIcon;
} {
	if (info.searchingCount > 0) {
		return {
			type: 'searching',
			label: `${info.searchingCount} searching`,
			color: 'text-yellow-600 dark:text-yellow-400',
			icon: Loader2Icon
		};
	}
	if (info.isPaused) {
		return { type: 'paused', label: 'Paused', color: 'text-warning', icon: PauseCircleIcon };
	}
	if (info.dailyBudget && info.requestsToday >= info.dailyBudget) {
		return {
			type: 'daily_exhausted',
			label: 'Daily Limit',
			color: 'text-destructive',
			icon: BanIcon
		};
	}
	if (info.requestsThisMinute >= info.requestsPerMinute && info.minuteWindowExpiry) {
		const remaining = Math.max(
			0,
			Math.ceil((new Date(info.minuteWindowExpiry).getTime() - currentTime) / 1000)
		);
		if (remaining > 0) {
			return {
				type: 'at_limit',
				label: `Resets in ${remaining}s`,
				color: 'text-warning',
				icon: ClockIcon
			};
		}
	}
	return { type: 'ready', label: 'Ready', color: 'text-success', icon: ZapIcon };
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

function getNextSearchIndicator(info: SerializedThrottleInfo, currentTime: number): string | null {
	if (info.searchingCount > 0) return null;
	if (info.isPaused) return null;
	if (info.dailyBudget && info.requestsToday >= info.dailyBudget) {
		return 'Resets at midnight';
	}
	if (info.requestsThisMinute >= info.requestsPerMinute && info.minuteWindowExpiry) {
		const remaining = Math.max(
			0,
			Math.ceil((new Date(info.minuteWindowExpiry).getTime() - currentTime) / 1000)
		);
		if (remaining > 0) {
			return `in ${remaining}s`;
		}
	}
	if (info.queuedCount > 0) {
		return 'Now';
	}
	return null;
}

function getMinuteProgress(info: SerializedThrottleInfo): number {
	if (info.requestsPerMinute === 0) return 0;
	return Math.min((info.requestsThisMinute / info.requestsPerMinute) * 100, 100);
}

function getDailyProgress(info: SerializedThrottleInfo): number | null {
	if (!info.dailyBudget) return null;
	return Math.min((info.requestsToday / info.dailyBudget) * 100, 100);
}
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
				{@const status = getStatus(connector, now)}
				{@const StatusIcon = status.icon}
				{@const colors = typeColors[connector.type] ?? defaultColors}
				{@const minuteProgress = getMinuteProgress(connector)}
				{@const dailyProgress = getDailyProgress(connector)}
				{@const pauseTime = formatPauseTime(connector.pausedUntil, now)}
				{@const nextSearch = getNextSearchIndicator(connector, now)}

				<Card.Root
					variant="glass"
					class={cn(
						'p-4 transition-all duration-300',
						status.type === 'searching' && 'ring-2 ring-yellow-500/50 ring-offset-1 ring-offset-background'
					)}
				>
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
						<div class="flex items-center gap-1.5 flex-shrink-0">
							<StatusIcon
								class={cn(
									'h-4 w-4',
									status.color,
									status.type === 'searching' && 'animate-spin'
								)}
							/>
							<span class={cn('text-xs font-medium', status.color)}>
								{status.label}
								{#if pauseTime && status.type === 'paused'}
									<span class="text-muted-foreground">({pauseTime})</span>
								{/if}
							</span>
						</div>
					</div>

					<div class="space-y-3">
						<div>
							<div class="flex items-center justify-between text-xs mb-1">
								<span class="text-muted-foreground">Requests/min</span>
								<span class="font-mono">
									{connector.requestsThisMinute}/{connector.requestsPerMinute}
								</span>
							</div>
							<div class="h-1.5 bg-muted rounded-full overflow-hidden">
								<div
									class={cn(
										'h-full transition-all duration-300',
										minuteProgress >= 100 ? 'bg-warning' : 'bg-primary'
									)}
									style="width: {minuteProgress}%"
								></div>
							</div>
						</div>

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

						<div class="flex items-center justify-between text-xs pt-1 border-t border-glass-border/30">
							<span class="text-muted-foreground">Queue</span>
							<span>
								{#if connector.searchingCount > 0}
									<span class="text-yellow-600 dark:text-yellow-400 font-medium">
										{connector.searchingCount} searching
									</span>
									{#if connector.queuedCount > 0}
										<span class="text-muted-foreground">, </span>
									{/if}
								{/if}
								{#if connector.queuedCount > 0}
									<span>{connector.queuedCount} waiting</span>
								{/if}
								{#if connector.searchingCount === 0 && connector.queuedCount === 0}
									<span class="text-muted-foreground">Empty</span>
								{/if}
							</span>
						</div>

						{#if nextSearch}
							<div class="flex items-center justify-between text-xs">
								<span class="text-muted-foreground">Next search</span>
								<span class={cn(
									'font-medium',
									nextSearch === 'Now' && 'text-success',
									nextSearch.startsWith('in ') && 'text-warning',
									nextSearch.startsWith('Resets') && 'text-destructive'
								)}>
									{nextSearch}
								</span>
							</div>
						{/if}
					</div>
				</Card.Root>
			{/each}
		</div>
	</div>
{/if}
