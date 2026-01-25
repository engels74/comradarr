<script lang="ts">
import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
import { untrack } from 'svelte';
import { enhance } from '$app/forms';
import { Button } from '$lib/components/ui/button';
import * as Card from '$lib/components/ui/card';
import { Checkbox } from '$lib/components/ui/checkbox';
import { Input } from '$lib/components/ui/input';
import { Label } from '$lib/components/ui/label';
import { Separator } from '$lib/components/ui/separator';
import { toastStore } from '$lib/components/ui/toast';
import {
	cooldownDescriptions,
	cooldownLabels,
	priorityWeightDescriptions,
	priorityWeightLabels,
	retryDescriptions,
	retryLabels,
	seasonPackDescriptions,
	seasonPackLabels
} from '$lib/schemas/search-settings';
import type { SearchSettings } from '$lib/server/db/queries/settings';

interface Props {
	data: SearchSettings;
	form: Record<string, unknown> | null;
	accentColor: string;
}

let { data, form, accentColor }: Props = $props();

let isSubmitting = $state(false);
let isResetting = $state(false);
let jitter = $state(untrack(() => data.cooldownConfig.jitter));

$effect(() => {
	if (form && form.action === 'searchUpdate' && 'values' in form && form.values) {
		const values = form.values as { cooldownConfig: { jitter: boolean } };
		jitter = values.cooldownConfig.jitter;
	}
});

function getPriorityValue(key: keyof typeof data.priorityWeights): number {
	if (form && form.action === 'searchUpdate' && 'values' in form && form.values) {
		const values = form.values as { priorityWeights: typeof data.priorityWeights };
		return values.priorityWeights[key];
	}
	return data.priorityWeights[key];
}

function getSeasonPackValue(key: keyof typeof data.seasonPackThresholds): number {
	if (form && form.action === 'searchUpdate' && 'values' in form && form.values) {
		const values = form.values as { seasonPackThresholds: typeof data.seasonPackThresholds };
		return values.seasonPackThresholds[key];
	}
	return data.seasonPackThresholds[key];
}

function getCooldownValue(key: 'baseDelayHours' | 'maxDelayHours' | 'multiplier'): number {
	if (form && form.action === 'searchUpdate' && 'values' in form && form.values) {
		const values = form.values as { cooldownConfig: typeof data.cooldownConfig };
		return values.cooldownConfig[key];
	}
	return data.cooldownConfig[key];
}

function getRetryValue(key: keyof typeof data.retryConfig): number {
	if (form && form.action === 'searchUpdate' && 'values' in form && form.values) {
		const values = form.values as { retryConfig: typeof data.retryConfig };
		return values.retryConfig[key];
	}
	return data.retryConfig[key];
}
</script>

<form
	method="POST"
	action="?/searchUpdate"
	use:enhance={() => {
		isSubmitting = true;
		return async ({ result, update }) => {
			await update();
			isSubmitting = false;
			if (result.type === 'success' && result.data?.success) {
				toastStore.success(
					(result.data.message as string) || 'Search settings saved successfully'
				);
			}
		};
	}}
>
	<div class="grid gap-6">
		{#if form?.action === 'searchUpdate' && form?.error}
			<div
				class="bg-destructive/15 text-destructive rounded-md border border-destructive/20 p-3 text-sm"
				role="alert"
			>
				{form.error}
			</div>
		{/if}

		<Card.Root variant="glass" class="relative overflow-hidden">
			<div
				class="absolute top-0 left-0 right-0 h-px opacity-60"
				style="background: linear-gradient(to right, transparent, {accentColor}, transparent);"
			></div>
			<Card.Header>
				<Card.Title class="text-xl font-display">Priority Weights</Card.Title>
				<Card.Description>
					Configure how search requests are prioritized in the queue. Higher weights increase the
					impact of each factor on the final priority score.
				</Card.Description>
			</Card.Header>
			<Card.Content>
				<div class="grid gap-4 sm:grid-cols-2">
					<div class="grid gap-2">
						<Label for="contentAge">{priorityWeightLabels.contentAge}</Label>
						<Input
							id="contentAge"
							name="contentAge"
							type="number"
							min="0"
							max="100"
							step="1"
							required
							disabled={isSubmitting}
							value={getPriorityValue('contentAge')}
						/>
						<p class="text-xs text-muted-foreground">{priorityWeightDescriptions.contentAge}</p>
					</div>

					<div class="grid gap-2">
						<Label for="missingDuration">{priorityWeightLabels.missingDuration}</Label>
						<Input
							id="missingDuration"
							name="missingDuration"
							type="number"
							min="0"
							max="100"
							step="1"
							required
							disabled={isSubmitting}
							value={getPriorityValue('missingDuration')}
						/>
						<p class="text-xs text-muted-foreground">
							{priorityWeightDescriptions.missingDuration}
						</p>
					</div>

					<div class="grid gap-2">
						<Label for="userPriority">{priorityWeightLabels.userPriority}</Label>
						<Input
							id="userPriority"
							name="userPriority"
							type="number"
							min="0"
							max="100"
							step="1"
							required
							disabled={isSubmitting}
							value={getPriorityValue('userPriority')}
						/>
						<p class="text-xs text-muted-foreground">{priorityWeightDescriptions.userPriority}</p>
					</div>

					<div class="grid gap-2">
						<Label for="failurePenalty">{priorityWeightLabels.failurePenalty}</Label>
						<Input
							id="failurePenalty"
							name="failurePenalty"
							type="number"
							min="0"
							max="100"
							step="1"
							required
							disabled={isSubmitting}
							value={getPriorityValue('failurePenalty')}
						/>
						<p class="text-xs text-muted-foreground">
							{priorityWeightDescriptions.failurePenalty}
						</p>
					</div>

					<div class="grid gap-2 sm:col-span-2">
						<Label for="gapBonus">{priorityWeightLabels.gapBonus}</Label>
						<Input
							id="gapBonus"
							name="gapBonus"
							type="number"
							min="0"
							max="100"
							step="1"
							required
							disabled={isSubmitting}
							value={getPriorityValue('gapBonus')}
						/>
						<p class="text-xs text-muted-foreground">{priorityWeightDescriptions.gapBonus}</p>
					</div>
				</div>
			</Card.Content>
		</Card.Root>

		<Card.Root variant="glass" class="relative overflow-hidden">
			<div
				class="absolute top-0 left-0 right-0 h-px opacity-60"
				style="background: linear-gradient(to right, transparent, {accentColor}, transparent);"
			></div>
			<Card.Header>
				<Card.Title class="text-xl font-display">Season Pack Thresholds</Card.Title>
				<Card.Description>
					Configure when to use season pack searches instead of individual episode searches. Season
					packs are more efficient but may not be available for all content.
				</Card.Description>
			</Card.Header>
			<Card.Content>
				<div class="grid gap-4 sm:grid-cols-2">
					<div class="grid gap-2">
						<Label for="minMissingPercent">{seasonPackLabels.minMissingPercent}</Label>
						<Input
							id="minMissingPercent"
							name="minMissingPercent"
							type="number"
							min="0"
							max="100"
							step="1"
							required
							disabled={isSubmitting}
							value={getSeasonPackValue('minMissingPercent')}
						/>
						<p class="text-xs text-muted-foreground">
							{seasonPackDescriptions.minMissingPercent}
						</p>
					</div>

					<div class="grid gap-2">
						<Label for="minMissingCount">{seasonPackLabels.minMissingCount}</Label>
						<Input
							id="minMissingCount"
							name="minMissingCount"
							type="number"
							min="1"
							max="100"
							step="1"
							required
							disabled={isSubmitting}
							value={getSeasonPackValue('minMissingCount')}
						/>
						<p class="text-xs text-muted-foreground">{seasonPackDescriptions.minMissingCount}</p>
					</div>
				</div>
			</Card.Content>
		</Card.Root>

		<Card.Root variant="glass" class="relative overflow-hidden">
			<div
				class="absolute top-0 left-0 right-0 h-px opacity-60"
				style="background: linear-gradient(to right, transparent, {accentColor}, transparent);"
			></div>
			<Card.Header>
				<Card.Title class="text-xl font-display">Cooldown Configuration</Card.Title>
				<Card.Description>
					Configure the exponential backoff behavior for failed searches. After each failure, the
					cooldown period increases by the multiplier until reaching the maximum delay.
				</Card.Description>
			</Card.Header>
			<Card.Content>
				<div class="grid gap-4 sm:grid-cols-2">
					<div class="grid gap-2">
						<Label for="baseDelayHours">{cooldownLabels.baseDelayHours}</Label>
						<Input
							id="baseDelayHours"
							name="baseDelayHours"
							type="number"
							min="0.5"
							max="48"
							step="0.5"
							required
							disabled={isSubmitting}
							value={getCooldownValue('baseDelayHours')}
						/>
						<p class="text-xs text-muted-foreground">{cooldownDescriptions.baseDelayHours}</p>
					</div>

					<div class="grid gap-2">
						<Label for="maxDelayHours">{cooldownLabels.maxDelayHours}</Label>
						<Input
							id="maxDelayHours"
							name="maxDelayHours"
							type="number"
							min="1"
							max="168"
							step="1"
							required
							disabled={isSubmitting}
							value={getCooldownValue('maxDelayHours')}
						/>
						<p class="text-xs text-muted-foreground">{cooldownDescriptions.maxDelayHours}</p>
					</div>

					<div class="grid gap-2">
						<Label for="multiplier">{cooldownLabels.multiplier}</Label>
						<Input
							id="multiplier"
							name="multiplier"
							type="number"
							min="1"
							max="5"
							step="0.1"
							required
							disabled={isSubmitting}
							value={getCooldownValue('multiplier')}
						/>
						<p class="text-xs text-muted-foreground">{cooldownDescriptions.multiplier}</p>
					</div>

					<div class="grid gap-2">
						<div class="flex items-center space-x-3 pt-6">
							<Checkbox id="jitter" name="jitter" bind:checked={jitter} disabled={isSubmitting} />
							<Label for="jitter" class="text-sm font-medium cursor-pointer">
								{cooldownLabels.jitter}
							</Label>
						</div>
						<p class="text-xs text-muted-foreground">{cooldownDescriptions.jitter}</p>
					</div>
				</div>
			</Card.Content>
		</Card.Root>

		<Card.Root variant="glass" class="relative overflow-hidden">
			<div
				class="absolute top-0 left-0 right-0 h-px opacity-60"
				style="background: linear-gradient(to right, transparent, {accentColor}, transparent);"
			></div>
			<Card.Header>
				<Card.Title class="text-xl font-display">Retry Configuration</Card.Title>
				<Card.Description>
					Configure the maximum number of search attempts before an item is marked as exhausted.
					Exhausted items will not be retried automatically.
				</Card.Description>
			</Card.Header>
			<Card.Content>
				<div class="grid gap-4">
					<div class="grid gap-2 max-w-xs">
						<Label for="maxAttempts">{retryLabels.maxAttempts}</Label>
						<Input
							id="maxAttempts"
							name="maxAttempts"
							type="number"
							min="1"
							max="20"
							step="1"
							required
							disabled={isSubmitting}
							value={getRetryValue('maxAttempts')}
						/>
						<p class="text-xs text-muted-foreground">{retryDescriptions.maxAttempts}</p>
					</div>
				</div>
			</Card.Content>
		</Card.Root>

		<div class="flex gap-3 pt-2">
			<Button type="submit" disabled={isSubmitting || isResetting}>
				{#if isSubmitting}
					Saving...
				{:else}
					Save Settings
				{/if}
			</Button>
		</div>
	</div>
</form>

<Separator class="my-6" />

<Card.Root variant="glass" class="relative overflow-hidden">
	<div
		class="absolute top-0 left-0 right-0 h-px opacity-60"
		style="background: linear-gradient(to right, transparent, {accentColor}, transparent);"
	></div>
	<Card.Header>
		<Card.Title class="text-lg font-display">Reset to Defaults</Card.Title>
		<Card.Description>
			Reset all search behavior settings to their default values. This cannot be undone.
		</Card.Description>
	</Card.Header>
	<Card.Content>
		<form
			method="POST"
			action="?/searchReset"
			use:enhance={() => {
				isResetting = true;
				return async ({ result, update }) => {
					await update();
					isResetting = false;
					if (result.type === 'success' && result.data?.success) {
						toastStore.success((result.data.message as string) || 'Settings reset to defaults');
						jitter = true;
					}
				};
			}}
		>
			<Button type="submit" variant="outline" disabled={isSubmitting || isResetting}>
				<RotateCcwIcon class="h-4 w-4 mr-2" />
				{#if isResetting}
					Resetting...
				{:else}
					Reset to Defaults
				{/if}
			</Button>
		</form>
	</Card.Content>
</Card.Root>
