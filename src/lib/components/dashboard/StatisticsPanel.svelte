<script lang="ts">
import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';
import ArrowUpCircleIcon from '@lucide/svelte/icons/arrow-up-circle';
import CheckCircle2Icon from '@lucide/svelte/icons/check-circle-2';
import ListTodoIcon from '@lucide/svelte/icons/list-todo';
import TargetIcon from '@lucide/svelte/icons/target';
import * as Card from '$lib/components/ui/card';
import type { ContentStatusCounts } from '$lib/server/db/queries/content';
import type { TodaySearchStats } from '$lib/server/db/queries/queue';

interface Props {
	contentStats: ContentStatusCounts;
	todayStats: TodaySearchStats;
	class?: string;
}

let { contentStats, todayStats, class: className = '' }: Props = $props();

// Determine success rate styling based on percentage
const successRateColors = $derived(() => {
	if (todayStats.completedToday === 0)
		return { bg: 'bg-muted/50', text: 'text-muted-foreground', glow: '' };
	if (todayStats.successRate >= 70)
		return {
			bg: 'bg-success/15',
			text: 'text-success',
			glow: 'shadow-[0_0_15px_oklch(var(--success)/0.3)]'
		};
	if (todayStats.successRate >= 40)
		return {
			bg: 'bg-warning/15',
			text: 'text-warning',
			glow: 'shadow-[0_0_15px_oklch(var(--warning)/0.3)]'
		};
	return {
		bg: 'bg-destructive/15',
		text: 'text-destructive',
		glow: 'shadow-[0_0_15px_oklch(var(--destructive)/0.3)]'
	};
});

interface StatCard {
	value: number | string;
	label: string;
	icon: typeof AlertCircleIcon;
	bgColor: string;
	textColor: string;
	glowColor?: string;
}

const stats: StatCard[] = $derived([
	{
		value: contentStats.missing,
		label: 'Total Gaps',
		icon: AlertCircleIcon,
		bgColor: 'bg-destructive/15',
		textColor: 'text-destructive',
		glowColor: contentStats.missing > 0 ? 'shadow-[0_0_15px_oklch(var(--destructive)/0.25)]' : ''
	},
	{
		value: contentStats.upgrade,
		label: 'Upgrades',
		icon: ArrowUpCircleIcon,
		bgColor: 'bg-warning/15',
		textColor: 'text-warning',
		glowColor: contentStats.upgrade > 0 ? 'shadow-[0_0_15px_oklch(var(--warning)/0.25)]' : ''
	},
	{
		value: contentStats.queued,
		label: 'In Queue',
		icon: ListTodoIcon,
		bgColor: 'bg-[oklch(var(--accent-sonarr)/0.15)]',
		textColor: 'text-[oklch(var(--accent-sonarr))]',
		glowColor: contentStats.queued > 0 ? 'shadow-[0_0_15px_oklch(var(--accent-sonarr)/0.25)]' : ''
	},
	{
		value: todayStats.completedToday,
		label: 'Today',
		icon: CheckCircle2Icon,
		bgColor: 'bg-success/15',
		textColor: 'text-success',
		glowColor: todayStats.completedToday > 0 ? 'shadow-[0_0_15px_oklch(var(--success)/0.25)]' : ''
	},
	{
		value: `${todayStats.successRate}%`,
		label: 'Success',
		icon: TargetIcon,
		bgColor: successRateColors().bg,
		textColor: successRateColors().text,
		glowColor: successRateColors().glow
	}
]);
</script>

<div class={className}>
	<div class="mb-5">
		<h2 class="font-display text-xl font-semibold tracking-tight">Statistics</h2>
		<p class="text-sm text-muted-foreground mt-1">Current library status at a glance</p>
	</div>

	<div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
		{#each stats as stat, i}
			{@const Icon = stat.icon}
			<Card.Root variant="glass" class="p-4 py-5 transition-all duration-300 hover:scale-[1.02] {stat.glowColor}">
				<div class="flex items-center gap-3">
					<div class="p-2.5 rounded-xl {stat.bgColor} transition-transform duration-200">
						<Icon class="h-5 w-5 {stat.textColor}" />
					</div>
					<div>
						<p class="text-2xl font-display font-bold tracking-tight">{stat.value}</p>
						<p class="text-sm text-muted-foreground">{stat.label}</p>
					</div>
				</div>
			</Card.Root>
		{/each}
	</div>
</div>
