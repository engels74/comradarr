<script lang="ts">
import CalendarIcon from '@lucide/svelte/icons/calendar';
import ClockIcon from '@lucide/svelte/icons/clock';
import GlobeIcon from '@lucide/svelte/icons/globe';
import { enhance } from '$app/forms';
import { Button } from '$lib/components/ui/button';
import * as Card from '$lib/components/ui/card';
import type { ScheduleWithRelations } from '$lib/server/db/queries/schedules';
import { cn } from '$lib/utils.js';

interface Props {
	schedule: ScheduleWithRelations;
	class?: string;
}

let { schedule, class: className }: Props = $props();

/**
 * Sweep type badge colors
 */
const typeColors: Record<string, string> = {
	incremental: 'bg-blue-500/15 text-blue-500 border border-blue-500/30',
	full_reconciliation: 'bg-purple-500/15 text-purple-500 border border-purple-500/30'
};

const typeColor = $derived(typeColors[schedule.sweepType] ?? 'bg-gray-500/10 text-gray-600');

/**
 * Format sweep type for display
 */
const formattedType = $derived(
	schedule.sweepType === 'incremental' ? 'Incremental Sync' : 'Full Reconciliation'
);

/**
 * Format cron expression to human-readable (simplified)
 */
function getCronDescription(cron: string): string {
	// Simple patterns - could use a library like cronstrue for full parsing
	if (cron === '*/15 * * * *') return 'Every 15 minutes';
	if (cron === '*/5 * * * *') return 'Every 5 minutes';
	if (cron === '*/30 * * * *') return 'Every 30 minutes';
	if (cron === '0 * * * *') return 'Every hour';
	if (cron === '0 */2 * * *') return 'Every 2 hours';
	if (cron === '0 */4 * * *') return 'Every 4 hours';
	if (cron === '0 */6 * * *') return 'Every 6 hours';
	if (cron === '0 */12 * * *') return 'Every 12 hours';
	if (cron === '0 0 * * *') return 'Daily at midnight';
	if (cron === '0 3 * * *') return 'Daily at 3:00 AM';
	if (cron === '0 4 * * *') return 'Daily at 4:00 AM';

	// Parse daily patterns like "0 5 * * *" -> "Daily at 5:00 AM"
	const dailyMatch = cron.match(/^(\d+) (\d+) \* \* \*$/);
	if (dailyMatch) {
		const [, minute, hour] = dailyMatch;
		const h = parseInt(hour!, 10);
		const m = parseInt(minute!, 10);
		const period = h >= 12 ? 'PM' : 'AM';
		const displayHour = h === 0 ? 12 : h > 12 ? h - 12 : h;
		const displayMin = m.toString().padStart(2, '0');
		return `Daily at ${displayHour}:${displayMin} ${period}`;
	}

	// Parse every N minutes patterns like "*/10 * * * *" -> "Every 10 minutes"
	const minuteMatch = cron.match(/^\*\/(\d+) \* \* \* \*$/);
	if (minuteMatch) {
		return `Every ${minuteMatch[1]} minutes`;
	}

	return cron; // Fallback to raw expression
}

const cronDescription = $derived(getCronDescription(schedule.cronExpression));

/**
 * Format next run time as relative
 */
function getNextRunFormatted(): string {
	if (!schedule.nextRunAt) return 'Not scheduled';
	const date = new Date(schedule.nextRunAt);
	const now = new Date();
	const diffMs = date.getTime() - now.getTime();

	if (diffMs < 0) return 'Overdue';

	const diffMins = Math.floor(diffMs / 60000);
	if (diffMins < 1) return 'in < 1 min';
	if (diffMins < 60) return `in ${diffMins} min`;

	const diffHours = Math.floor(diffMins / 60);
	if (diffHours < 24) return `in ${diffHours} hr`;

	const diffDays = Math.floor(diffHours / 24);
	return `in ${diffDays} day${diffDays > 1 ? 's' : ''}`;
}

const nextRunFormatted = $derived(getNextRunFormatted());
</script>

<Card.Root variant="glass" class={cn('relative transition-all duration-300 hover:shadow-lg', className)}>
	<Card.Header class="pb-3">
		<div class="flex items-start justify-between gap-2">
			<div class="space-y-1">
				<Card.Title class="text-lg font-display">
					<a
						href="/schedules/{schedule.id}"
						class="hover:underline hover:text-primary transition-colors"
					>
						{schedule.name}
					</a>
				</Card.Title>
				<div class="flex items-center gap-2 flex-wrap">
					<span
						class={cn(
							'inline-flex items-center rounded-md px-2 py-1 text-xs font-medium',
							typeColor
						)}
					>
						{formattedType}
					</span>
					{#if schedule.connector}
						<span
							class="inline-flex items-center rounded-lg px-2 py-1 text-xs font-medium bg-glass/50 border border-glass-border/30 text-muted-foreground"
						>
							{schedule.connector.name}
						</span>
					{:else}
						<span
							class="inline-flex items-center rounded-lg px-2 py-1 text-xs font-medium bg-green-500/15 text-green-500 border border-green-500/30"
						>
							All Connectors
						</span>
					{/if}
				</div>
			</div>
			<!-- Enable/Disable Toggle -->
			<form method="POST" action="?/toggle" use:enhance>
				<input type="hidden" name="id" value={schedule.id} />
				<input type="hidden" name="enabled" value={!schedule.enabled} />
				<Button
					type="submit"
					variant={schedule.enabled ? 'outline' : 'secondary'}
					size="sm"
					class={cn(
						schedule.enabled
							? 'text-green-600 hover:text-green-700 dark:text-green-400'
							: 'text-muted-foreground'
					)}
				>
					{schedule.enabled ? 'Enabled' : 'Disabled'}
				</Button>
			</form>
		</div>
	</Card.Header>
	<Card.Content class="space-y-3">
		<!-- Cron Expression -->
		<div class="flex items-center gap-2 text-sm">
			<ClockIcon class="h-4 w-4 text-muted-foreground" />
			<span class="text-muted-foreground">{cronDescription}</span>
		</div>

		<!-- Timezone -->
		<div class="flex items-center gap-2 text-sm">
			<GlobeIcon class="h-4 w-4 text-muted-foreground" />
			<span class="text-muted-foreground">{schedule.timezone}</span>
		</div>

		<!-- Next Run -->
		<div class="flex items-center gap-2 text-sm">
			<CalendarIcon class="h-4 w-4 text-muted-foreground" />
			<span class="font-medium text-foreground">Next run:</span>
			<span class="text-muted-foreground">{nextRunFormatted}</span>
		</div>

		<!-- Last Run -->
		{#if schedule.lastRunAt}
			<div class="text-xs text-muted-foreground">
				Last run: {new Date(schedule.lastRunAt).toLocaleString()}
			</div>
		{:else}
			<div class="text-xs text-muted-foreground">Never run</div>
		{/if}
	</Card.Content>
</Card.Root>
