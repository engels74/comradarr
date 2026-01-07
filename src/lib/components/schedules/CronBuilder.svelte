<script lang="ts">
import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';
import CalendarIcon from '@lucide/svelte/icons/calendar';
import ClockIcon from '@lucide/svelte/icons/clock';
import { Cron } from 'croner';
import { Input } from '$lib/components/ui/input';
import { Label } from '$lib/components/ui/label';
import { cn } from '$lib/utils.js';

type FrequencyMode = 'minutes' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'custom';

interface Props {
	value?: string;
	timezone?: string;
	disabled?: boolean;
	class?: string;
}

let {
	value = $bindable('0 3 * * *'),
	timezone = 'UTC',
	disabled = false,
	class: className
}: Props = $props();

let frequency = $state<FrequencyMode>('daily');
let minuteInterval = $state(15);
let atMinute = $state(0);
let atHour = $state(3);
let selectedDaysOfWeek = $state<number[]>([1]);
let selectedDaysOfMonth = $state<number[]>([1]);
let customExpression = $state('0 3 * * *');

const daysOfWeek = [
	{ value: 0, label: 'Sun' },
	{ value: 1, label: 'Mon' },
	{ value: 2, label: 'Tue' },
	{ value: 3, label: 'Wed' },
	{ value: 4, label: 'Thu' },
	{ value: 5, label: 'Fri' },
	{ value: 6, label: 'Sat' }
];

const minuteIntervals = [5, 10, 15, 20, 30, 60];

const hourOptions = Array.from({ length: 24 }, (_, i) => {
	const period = i >= 12 ? 'PM' : 'AM';
	const displayHour = i === 0 ? 12 : i > 12 ? i - 12 : i;
	return { value: i, label: `${displayHour}:00 ${period}` };
});

const minuteOptions = Array.from({ length: 60 }, (_, i) => ({
	value: i,
	label: i.toString().padStart(2, '0')
}));

const daysOfMonth = Array.from({ length: 31 }, (_, i) => i + 1);

const cronExpression = $derived.by(() => {
	switch (frequency) {
		case 'minutes':
			return `*/${minuteInterval} * * * *`;
		case 'hourly':
			return `${atMinute} * * * *`;
		case 'daily':
			return `${atMinute} ${atHour} * * *`;
		case 'weekly': {
			const days =
				selectedDaysOfWeek.length > 0 ? selectedDaysOfWeek.sort((a, b) => a - b).join(',') : '*';
			return `${atMinute} ${atHour} * * ${days}`;
		}
		case 'monthly': {
			const days =
				selectedDaysOfMonth.length > 0 ? selectedDaysOfMonth.sort((a, b) => a - b).join(',') : '*';
			return `${atMinute} ${atHour} ${days} * *`;
		}
		case 'custom':
			return customExpression;
	}
});

$effect(() => {
	value = cronExpression;
});

function parseIncomingValue(val: string): void {
	const parts = val.trim().split(/\s+/);
	if (parts.length !== 5) {
		frequency = 'custom';
		customExpression = val;
		return;
	}

	const [minute, hour, dayOfMonth, month, dayOfWeek] = parts as [
		string,
		string,
		string,
		string,
		string
	];

	// Pattern: */N * * * * (every N minutes)
	const minuteMatch = minute.match(/^\*\/(\d+)$/);
	if (minuteMatch && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
		frequency = 'minutes';
		minuteInterval = parseInt(minuteMatch[1]!, 10);
		return;
	}

	// Pattern: N * * * * (hourly)
	if (
		/^\d+$/.test(minute) &&
		hour === '*' &&
		dayOfMonth === '*' &&
		month === '*' &&
		dayOfWeek === '*'
	) {
		frequency = 'hourly';
		atMinute = parseInt(minute, 10);
		return;
	}

	// Pattern: N N * * * (daily)
	if (
		/^\d+$/.test(minute) &&
		/^\d+$/.test(hour) &&
		dayOfMonth === '*' &&
		month === '*' &&
		dayOfWeek === '*'
	) {
		frequency = 'daily';
		atMinute = parseInt(minute, 10);
		atHour = parseInt(hour, 10);
		return;
	}

	// Pattern: N N * * days (weekly)
	if (
		/^\d+$/.test(minute) &&
		/^\d+$/.test(hour) &&
		dayOfMonth === '*' &&
		month === '*' &&
		dayOfWeek !== '*'
	) {
		frequency = 'weekly';
		atMinute = parseInt(minute, 10);
		atHour = parseInt(hour, 10);
		selectedDaysOfWeek = dayOfWeek
			.split(',')
			.map((d) => parseInt(d, 10))
			.filter((d) => !Number.isNaN(d));
		return;
	}

	// Pattern: N N days * * (monthly)
	if (
		/^\d+$/.test(minute) &&
		/^\d+$/.test(hour) &&
		dayOfMonth !== '*' &&
		month === '*' &&
		dayOfWeek === '*'
	) {
		frequency = 'monthly';
		atMinute = parseInt(minute, 10);
		atHour = parseInt(hour, 10);
		selectedDaysOfMonth = dayOfMonth
			.split(',')
			.map((d) => parseInt(d, 10))
			.filter((d) => !Number.isNaN(d));
		return;
	}

	frequency = 'custom';
	customExpression = val;
}

if (value) {
	parseIncomingValue(value);
}

const validation = $derived.by(() => {
	try {
		const cron = new Cron(cronExpression, { timezone });
		const nextRuns: Date[] = [];
		let next = cron.nextRun();
		for (let i = 0; i < 3 && next; i++) {
			nextRuns.push(next);
			next = cron.nextRun(new Date(next.getTime() + 1000));
		}
		return { valid: true, nextRuns, error: null };
	} catch (err) {
		return {
			valid: false,
			nextRuns: [],
			error: err instanceof Error ? err.message : 'Invalid expression'
		};
	}
});

const description = $derived.by(() => {
	switch (frequency) {
		case 'minutes':
			return `Every ${minuteInterval} minutes`;
		case 'hourly': {
			const minStr = atMinute.toString().padStart(2, '0');
			return `Every hour at :${minStr}`;
		}
		case 'daily': {
			const period = atHour >= 12 ? 'PM' : 'AM';
			const displayHour = atHour === 0 ? 12 : atHour > 12 ? atHour - 12 : atHour;
			const minStr = atMinute.toString().padStart(2, '0');
			return `Daily at ${displayHour}:${minStr} ${period}`;
		}
		case 'weekly': {
			const period = atHour >= 12 ? 'PM' : 'AM';
			const displayHour = atHour === 0 ? 12 : atHour > 12 ? atHour - 12 : atHour;
			const minStr = atMinute.toString().padStart(2, '0');
			const dayNames = selectedDaysOfWeek.map((d) => daysOfWeek[d]?.label ?? '').join(', ');
			return `Every ${dayNames || 'day'} at ${displayHour}:${minStr} ${period}`;
		}
		case 'monthly': {
			const period = atHour >= 12 ? 'PM' : 'AM';
			const displayHour = atHour === 0 ? 12 : atHour > 12 ? atHour - 12 : atHour;
			const minStr = atMinute.toString().padStart(2, '0');
			const dayStr =
				selectedDaysOfMonth.length > 0
					? selectedDaysOfMonth.map((d) => getOrdinal(d)).join(', ')
					: 'every day';
			return `On the ${dayStr} of each month at ${displayHour}:${minStr} ${period}`;
		}
		case 'custom':
			return getCronDescription(customExpression);
	}
});

function getOrdinal(n: number): string {
	const s = ['th', 'st', 'nd', 'rd'];
	const v = n % 100;
	return n + (s[(v - 20) % 10] || s[v] || s[0])!;
}

function getCronDescription(cron: string): string {
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

	const minuteMatch = cron.match(/^\*\/(\d+) \* \* \* \*$/);
	if (minuteMatch) {
		return `Every ${minuteMatch[1]} minutes`;
	}

	return cron;
}

function formatNextRun(date: Date): string {
	const now = new Date();
	const diffMs = date.getTime() - now.getTime();
	const diffMins = Math.floor(diffMs / 60000);

	if (diffMins < 1) return 'in < 1 min';
	if (diffMins < 60) return `in ${diffMins} min`;

	const diffHours = Math.floor(diffMins / 60);
	if (diffHours < 24) return `in ${diffHours} hr`;

	const diffDays = Math.floor(diffHours / 24);
	if (diffDays < 7) return `in ${diffDays} day${diffDays > 1 ? 's' : ''}`;

	return date.toLocaleDateString();
}

function toggleDay(day: number, arr: number[]): number[] {
	if (arr.includes(day)) {
		return arr.filter((d) => d !== day);
	}
	return [...arr, day];
}

function toggleDayOfWeek(day: number): void {
	selectedDaysOfWeek = toggleDay(day, selectedDaysOfWeek);
}

function toggleDayOfMonth(day: number): void {
	selectedDaysOfMonth = toggleDay(day, selectedDaysOfMonth);
}

const selectClass =
	'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm';
</script>

<div class={cn('space-y-4', className)}>
	<!-- Frequency Mode Selection -->
	<div class="grid gap-2">
		<Label for="frequency">Frequency</Label>
		<select id="frequency" bind:value={frequency} {disabled} class={selectClass}>
			<option value="minutes">Every N Minutes</option>
			<option value="hourly">Hourly</option>
			<option value="daily">Daily</option>
			<option value="weekly">Weekly</option>
			<option value="monthly">Monthly</option>
			<option value="custom">Custom Expression</option>
		</select>
	</div>

	<!-- Dynamic Fields Based on Frequency -->
	{#if frequency === 'minutes'}
		<div class="grid gap-2">
			<Label for="minuteInterval">Run every</Label>
			<select id="minuteInterval" bind:value={minuteInterval} {disabled} class={selectClass}>
				{#each minuteIntervals as interval}
					<option value={interval}>{interval} minutes</option>
				{/each}
			</select>
		</div>
	{:else if frequency === 'hourly'}
		<div class="grid gap-2">
			<Label for="atMinute">At minute</Label>
			<select id="atMinute" bind:value={atMinute} {disabled} class={selectClass}>
				{#each minuteOptions as opt}
					<option value={opt.value}>:{opt.label}</option>
				{/each}
			</select>
		</div>
	{:else if frequency === 'daily'}
		<div class="grid grid-cols-2 gap-4">
			<div class="grid gap-2">
				<Label for="atHour">Hour</Label>
				<select id="atHour" bind:value={atHour} {disabled} class={selectClass}>
					{#each hourOptions as opt}
						<option value={opt.value}>{opt.label}</option>
					{/each}
				</select>
			</div>
			<div class="grid gap-2">
				<Label for="atMinuteDaily">Minute</Label>
				<select id="atMinuteDaily" bind:value={atMinute} {disabled} class={selectClass}>
					{#each minuteOptions as opt}
						<option value={opt.value}>:{opt.label}</option>
					{/each}
				</select>
			</div>
		</div>
	{:else if frequency === 'weekly'}
		<div class="space-y-4">
			<div class="grid gap-2">
				<Label>Days of Week</Label>
				<div class="flex flex-wrap gap-2">
					{#each daysOfWeek as day}
						<button
							type="button"
							{disabled}
							onclick={() => toggleDayOfWeek(day.value)}
							class={cn(
								'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
								selectedDaysOfWeek.includes(day.value)
									? 'bg-primary text-primary-foreground'
									: 'bg-muted text-muted-foreground hover:bg-muted/80',
								disabled && 'opacity-50 cursor-not-allowed'
							)}
						>
							{day.label}
						</button>
					{/each}
				</div>
			</div>
			<div class="grid grid-cols-2 gap-4">
				<div class="grid gap-2">
					<Label for="atHourWeekly">Hour</Label>
					<select id="atHourWeekly" bind:value={atHour} {disabled} class={selectClass}>
						{#each hourOptions as opt}
							<option value={opt.value}>{opt.label}</option>
						{/each}
					</select>
				</div>
				<div class="grid gap-2">
					<Label for="atMinuteWeekly">Minute</Label>
					<select id="atMinuteWeekly" bind:value={atMinute} {disabled} class={selectClass}>
						{#each minuteOptions as opt}
							<option value={opt.value}>:{opt.label}</option>
						{/each}
					</select>
				</div>
			</div>
		</div>
	{:else if frequency === 'monthly'}
		<div class="space-y-4">
			<div class="grid gap-2">
				<Label>Days of Month</Label>
				<div class="grid grid-cols-7 gap-1.5">
					{#each daysOfMonth as day}
						<button
							type="button"
							{disabled}
							onclick={() => toggleDayOfMonth(day)}
							class={cn(
								'p-1.5 rounded text-sm font-medium transition-colors',
								selectedDaysOfMonth.includes(day)
									? 'bg-primary text-primary-foreground'
									: 'bg-muted text-muted-foreground hover:bg-muted/80',
								disabled && 'opacity-50 cursor-not-allowed'
							)}
						>
							{day}
						</button>
					{/each}
				</div>
			</div>
			<div class="grid grid-cols-2 gap-4">
				<div class="grid gap-2">
					<Label for="atHourMonthly">Hour</Label>
					<select id="atHourMonthly" bind:value={atHour} {disabled} class={selectClass}>
						{#each hourOptions as opt}
							<option value={opt.value}>{opt.label}</option>
						{/each}
					</select>
				</div>
				<div class="grid gap-2">
					<Label for="atMinuteMonthly">Minute</Label>
					<select id="atMinuteMonthly" bind:value={atMinute} {disabled} class={selectClass}>
						{#each minuteOptions as opt}
							<option value={opt.value}>:{opt.label}</option>
						{/each}
					</select>
				</div>
			</div>
		</div>
	{:else if frequency === 'custom'}
		<div class="grid gap-2">
			<Label for="customExpression">Cron Expression</Label>
			<Input
				id="customExpression"
				type="text"
				bind:value={customExpression}
				{disabled}
				placeholder="* * * * *"
			/>
			<p class="text-xs text-muted-foreground">
				Standard 5-field format: minute hour day month weekday
			</p>
		</div>
	{/if}

	<!-- Expression Preview -->
	<div class="rounded-md border bg-muted/50 p-3 space-y-2">
		<!-- Human-readable description -->
		<div class="flex items-center gap-2">
			<ClockIcon class="h-4 w-4 text-muted-foreground flex-shrink-0" />
			<span class="text-sm font-medium">{description}</span>
		</div>

		<!-- Cron expression display -->
		<div class="flex items-center gap-2">
			<code class="text-xs bg-background px-2 py-1 rounded border font-mono">{cronExpression}</code>
			<span class="text-xs text-muted-foreground">({timezone})</span>
		</div>

		<!-- Validation status -->
		{#if !validation.valid}
			<div class="flex items-center gap-2 text-destructive">
				<AlertCircleIcon class="h-4 w-4 flex-shrink-0" />
				<span class="text-sm">{validation.error}</span>
			</div>
		{:else if validation.nextRuns.length > 0}
			<div class="space-y-1">
				<div class="flex items-center gap-2 text-muted-foreground">
					<CalendarIcon class="h-4 w-4 flex-shrink-0" />
					<span class="text-xs font-medium">Next runs:</span>
				</div>
				<ul class="text-xs text-muted-foreground space-y-0.5 ml-6">
					{#each validation.nextRuns as nextRun}
						<li>
							{nextRun.toLocaleString()} ({formatNextRun(nextRun)})
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	</div>
</div>
