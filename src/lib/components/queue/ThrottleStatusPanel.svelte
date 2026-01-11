<script lang="ts">
import GaugeIcon from '@lucide/svelte/icons/gauge';
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

function getStatus(info: SerializedThrottleInfo): {
	label: string;
	color: string;
	icon: typeof ZapIcon;
} {
	if (info.isPaused) {
		return { label: 'Paused', color: 'text-warning', icon: PauseCircleIcon };
	}
	if (info.dailyBudget && info.requestsToday >= info.dailyBudget) {
		return { label: 'Daily Limit', color: 'text-destructive', icon: PauseCircleIcon };
	}
	if (info.requestsThisMinute >= info.requestsPerMinute) {
		return { label: 'At Limit', color: 'text-warning', icon: GaugeIcon };
	}
	return { label: 'Active', color: 'text-success', icon: ZapIcon };
}

function formatPauseTime(pausedUntil: string | null): string {
	if (!pausedUntil) return '';
	const until = new Date(pausedUntil);
	const now = Date.now();
	const diff = until.getTime() - now;
	if (diff <= 0) return '';

	const minutes = Math.ceil(diff / 60000);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	return `${hours}h ${minutes % 60}m`;
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
				{@const status = getStatus(connector)}
				{@const StatusIcon = status.icon}
				{@const colors = typeColors[connector.type] ?? defaultColors}
				{@const minuteProgress = getMinuteProgress(connector)}
				{@const dailyProgress = getDailyProgress(connector)}
				{@const pauseTime = formatPauseTime(connector.pausedUntil)}

				<Card.Root variant="glass" class="p-4">
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
							<StatusIcon class={cn('h-4 w-4', status.color)} />
							<span class={cn('text-xs font-medium', status.color)}>
								{status.label}
								{#if pauseTime}
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
					</div>
				</Card.Root>
			{/each}
		</div>
	</div>
{/if}
