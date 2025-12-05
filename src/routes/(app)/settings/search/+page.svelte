<script lang="ts">
	/**
	 * Search behavior settings page.
	 *
	 * Requirements: 21.4
	 */
	import { enhance } from '$app/forms';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Separator } from '$lib/components/ui/separator';
	import {
		priorityWeightLabels,
		priorityWeightDescriptions,
		seasonPackLabels,
		seasonPackDescriptions,
		cooldownLabels,
		cooldownDescriptions,
		retryLabels,
		retryDescriptions
	} from '$lib/schemas/search-settings';
	import type { PageProps } from './$types';
	import SearchIcon from '@lucide/svelte/icons/search';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';

	let { data, form }: PageProps = $props();

	let isSubmitting = $state(false);
	let isResetting = $state(false);

	// Form state with initial values from loaded settings
	let jitter = $state(data.settings.cooldownConfig.jitter);

	// Update jitter when form is submitted with errors (preserve user's choice)
	$effect(() => {
		if (form && 'values' in form && form.values) {
			jitter = form.values.cooldownConfig.jitter;
		}
	});

	/**
	 * Get form value with fallback to loaded data.
	 */
	function getFormValue(
		formValue: number | undefined,
		settingsValue: number
	): number {
		return formValue ?? settingsValue;
	}

	/**
	 * Get nested form value for priority weights.
	 */
	function getPriorityValue(key: keyof typeof data.settings.priorityWeights): number {
		if (form && 'values' in form && form.values) {
			return form.values.priorityWeights[key];
		}
		return data.settings.priorityWeights[key];
	}

	/**
	 * Get nested form value for season pack thresholds.
	 */
	function getSeasonPackValue(key: keyof typeof data.settings.seasonPackThresholds): number {
		if (form && 'values' in form && form.values) {
			return form.values.seasonPackThresholds[key];
		}
		return data.settings.seasonPackThresholds[key];
	}

	/**
	 * Get nested form value for cooldown config.
	 */
	function getCooldownValue(key: 'baseDelayHours' | 'maxDelayHours' | 'multiplier'): number {
		if (form && 'values' in form && form.values) {
			return form.values.cooldownConfig[key];
		}
		return data.settings.cooldownConfig[key];
	}

	/**
	 * Get nested form value for retry config.
	 */
	function getRetryValue(key: keyof typeof data.settings.retryConfig): number {
		if (form && 'values' in form && form.values) {
			return form.values.retryConfig[key];
		}
		return data.settings.retryConfig[key];
	}
</script>

<svelte:head>
	<title>Search Behavior - Settings - Comradarr</title>
</svelte:head>

<div class="container mx-auto p-6 max-w-3xl">
	<!-- Page Header -->
	<div class="mb-6">
		<div class="flex items-center gap-3">
			<SearchIcon class="h-8 w-8 text-muted-foreground" />
			<div>
				<h1 class="text-3xl font-bold">Search Behavior</h1>
				<p class="text-muted-foreground mt-1">
					Configure priority weights, season pack thresholds, and retry settings
				</p>
			</div>
		</div>
	</div>

	<form
		method="POST"
		action="?/update"
		use:enhance={() => {
			isSubmitting = true;
			return async ({ update }) => {
				await update();
				isSubmitting = false;
			};
		}}
	>
		<div class="grid gap-6">
			<!-- Success Message -->
			{#if form?.success}
				<div
					class="bg-green-500/15 text-green-600 dark:text-green-400 rounded-md border border-green-500/20 p-3 text-sm"
					role="status"
				>
					{form.message}
				</div>
			{/if}

			<!-- Error Message -->
			{#if form?.error}
				<div
					class="bg-destructive/15 text-destructive rounded-md border border-destructive/20 p-3 text-sm"
					role="alert"
				>
					{form.error}
				</div>
			{/if}

			<!-- Priority Weights Card -->
			<Card.Root>
				<Card.Header>
					<Card.Title class="text-xl">Priority Weights</Card.Title>
					<Card.Description>
						Configure how search requests are prioritized in the queue. Higher weights increase the
						impact of each factor on the final priority score.
					</Card.Description>
				</Card.Header>
				<Card.Content>
					<div class="grid gap-4 sm:grid-cols-2">
						<!-- Content Age -->
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
							<p class="text-xs text-muted-foreground">
								{priorityWeightDescriptions.contentAge}
							</p>
						</div>

						<!-- Missing Duration -->
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

						<!-- User Priority -->
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
							<p class="text-xs text-muted-foreground">
								{priorityWeightDescriptions.userPriority}
							</p>
						</div>

						<!-- Failure Penalty -->
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

						<!-- Gap Bonus -->
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
							<p class="text-xs text-muted-foreground">
								{priorityWeightDescriptions.gapBonus}
							</p>
						</div>
					</div>
				</Card.Content>
			</Card.Root>

			<!-- Season Pack Thresholds Card -->
			<Card.Root>
				<Card.Header>
					<Card.Title class="text-xl">Season Pack Thresholds</Card.Title>
					<Card.Description>
						Configure when to use season pack searches instead of individual episode searches.
						Season packs are more efficient but may not be available for all content.
					</Card.Description>
				</Card.Header>
				<Card.Content>
					<div class="grid gap-4 sm:grid-cols-2">
						<!-- Min Missing Percent -->
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

						<!-- Min Missing Count -->
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
							<p class="text-xs text-muted-foreground">
								{seasonPackDescriptions.minMissingCount}
							</p>
						</div>
					</div>
				</Card.Content>
			</Card.Root>

			<!-- Cooldown Configuration Card -->
			<Card.Root>
				<Card.Header>
					<Card.Title class="text-xl">Cooldown Configuration</Card.Title>
					<Card.Description>
						Configure the exponential backoff behavior for failed searches. After each failure, the
						cooldown period increases by the multiplier until reaching the maximum delay.
					</Card.Description>
				</Card.Header>
				<Card.Content>
					<div class="grid gap-4 sm:grid-cols-2">
						<!-- Base Delay Hours -->
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
							<p class="text-xs text-muted-foreground">
								{cooldownDescriptions.baseDelayHours}
							</p>
						</div>

						<!-- Max Delay Hours -->
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
							<p class="text-xs text-muted-foreground">
								{cooldownDescriptions.maxDelayHours}
							</p>
						</div>

						<!-- Multiplier -->
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
							<p class="text-xs text-muted-foreground">
								{cooldownDescriptions.multiplier}
							</p>
						</div>

						<!-- Jitter -->
						<div class="grid gap-2">
							<div class="flex items-center space-x-3 pt-6">
								<Checkbox
									id="jitter"
									name="jitter"
									bind:checked={jitter}
									disabled={isSubmitting}
								/>
								<Label for="jitter" class="text-sm font-medium cursor-pointer">
									{cooldownLabels.jitter}
								</Label>
							</div>
							<p class="text-xs text-muted-foreground">
								{cooldownDescriptions.jitter}
							</p>
						</div>
					</div>
				</Card.Content>
			</Card.Root>

			<!-- Retry Configuration Card -->
			<Card.Root>
				<Card.Header>
					<Card.Title class="text-xl">Retry Configuration</Card.Title>
					<Card.Description>
						Configure the maximum number of search attempts before an item is marked as exhausted.
						Exhausted items will not be retried automatically.
					</Card.Description>
				</Card.Header>
				<Card.Content>
					<div class="grid gap-4">
						<!-- Max Attempts -->
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
							<p class="text-xs text-muted-foreground">
								{retryDescriptions.maxAttempts}
							</p>
						</div>
					</div>
				</Card.Content>
			</Card.Root>

			<!-- Actions -->
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

	<!-- Reset to Defaults -->
	<Card.Root>
		<Card.Header>
			<Card.Title class="text-lg">Reset to Defaults</Card.Title>
			<Card.Description>
				Reset all search behavior settings to their default values. This cannot be undone.
			</Card.Description>
		</Card.Header>
		<Card.Content>
			<form
				method="POST"
				action="?/reset"
				use:enhance={() => {
					isResetting = true;
					return async ({ update }) => {
						await update();
						isResetting = false;
						// Reset jitter state to default after successful reset
						jitter = true;
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
</div>
