<script lang="ts">
	/**
	 * Edit schedule form page.
	 */
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import { toastStore } from '$lib/components/ui/toast';
	import { CronBuilder } from '$lib/components/schedules';
	import { sweepTypes, timezoneOptions } from '$lib/schemas/schedules';
	import type { PageProps } from './$types';
	import TrashIcon from '@lucide/svelte/icons/trash-2';

	// Type for form values returned from update action
	interface UpdateFormValues {
		error: string;
		name: string;
		sweepType: string;
		cronExpression: string;
		timezone: string;
		connectorId: string;
		throttleProfileId: string;
	}

	let { data, form }: PageProps = $props();

	let isSubmitting = $state(false);
	let isDeleting = $state(false);
	let showDeleteConfirm = $state(false);

	// Extract form values with proper type narrowing (form may come from update or delete action)
	function isUpdateFormValues(f: typeof form): f is UpdateFormValues {
		return f !== null && 'name' in f;
	}
	const formValues = $derived(isUpdateFormValues(form) ? form : null);

	// Form state (pre-populated from schedule data, updated via two-way binding)
	// Use untrack to explicitly capture initial values without reactive tracking
	let cronExpression = $state(untrack(() => data.schedule.cronExpression));
	let timezone = $state(untrack(() => data.schedule.timezone));

	// Update state when form values change (after form submission with errors)
	$effect(() => {
		if (formValues?.cronExpression) {
			cronExpression = formValues.cronExpression;
		}
		if (formValues?.timezone) {
			timezone = formValues.timezone;
		}
	});

	const isLoading = $derived(isSubmitting || isDeleting);

	// Select styling
	const selectClass =
		'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm';

	/**
	 * Format sweep type for display.
	 */
	function formatSweepType(type: string): string {
		return type === 'incremental' ? 'Incremental Sync' : 'Full Reconciliation';
	}

	/**
	 * Get current form value with fallback to schedule data.
	 */
	function getFormValue<T>(formValue: T | undefined, scheduleValue: T): T {
		return formValue !== undefined ? formValue : scheduleValue;
	}
</script>

<svelte:head>
	<title>Edit Schedule - {data.schedule.name} - Comradarr</title>
</svelte:head>

<div class="container mx-auto p-6 max-w-2xl">
	<div class="mb-6">
		<a href="/schedules" class="text-sm text-muted-foreground hover:text-foreground">
			&larr; Back to Schedules
		</a>
	</div>

	<Card.Root>
		<Card.Header>
			<div class="flex items-start justify-between">
				<div>
					<Card.Title class="text-2xl font-bold">Edit Schedule</Card.Title>
					<Card.Description>
						Update the schedule configuration for "{data.schedule.name}".
					</Card.Description>
				</div>
				<!-- Delete Button -->
				<Button
					variant="destructive"
					size="sm"
					disabled={isLoading}
					onclick={() => (showDeleteConfirm = true)}
				>
					<TrashIcon class="h-4 w-4 mr-1" />
					Delete
				</Button>
			</div>
		</Card.Header>
		<Card.Content>
			<!-- Delete Confirmation Dialog -->
			{#if showDeleteConfirm}
				<div
					class="mb-6 bg-destructive/15 text-destructive rounded-md border border-destructive/20 p-4"
					role="alert"
				>
					<p class="font-medium mb-2">Delete this schedule?</p>
					<p class="text-sm mb-4">
						This will permanently delete the schedule "{data.schedule.name}". This action cannot be
						undone.
					</p>
					<div class="flex gap-2">
						<form
							method="POST"
							action="?/delete"
							use:enhance={() => {
								isDeleting = true;
								return async ({ result, update }) => {
									await update();
									isDeleting = false;

									// Show toast and navigate on success
									if (result.type === 'success' && result.data?.success) {
										toastStore.success(result.data.message as string);
										if (result.data.redirectTo) {
											goto(result.data.redirectTo as string);
										}
									}
								};
							}}
						>
							<Button type="submit" variant="destructive" size="sm" disabled={isLoading}>
								{#if isDeleting}
									Deleting...
								{:else}
									Yes, Delete
								{/if}
							</Button>
						</form>
						<Button
							variant="outline"
							size="sm"
							disabled={isLoading}
							onclick={() => (showDeleteConfirm = false)}
						>
							Cancel
						</Button>
					</div>
				</div>
			{/if}

			<form
				method="POST"
				action="?/update"
				use:enhance={() => {
					isSubmitting = true;
					return async ({ result, update }) => {
						await update();
						isSubmitting = false;

						// Show toast and navigate on success
						if (result.type === 'success' && result.data?.success) {
							toastStore.success(result.data.message as string);
							if (result.data.redirectTo) {
								goto(result.data.redirectTo as string);
							}
						}
					};
				}}
			>
				<div class="grid gap-6">
					{#if form?.error}
						<div
							class="bg-destructive/15 text-destructive rounded-md border border-destructive/20 p-3 text-sm"
							role="alert"
						>
							{form.error}
						</div>
					{/if}

					<!-- Name -->
					<div class="grid gap-2">
						<Label for="name">Name</Label>
						<Input
							id="name"
							name="name"
							type="text"
							placeholder="Daily Morning Sweep"
							required
							disabled={isLoading}
							value={getFormValue(formValues?.name, data.schedule.name)}
						/>
						<p class="text-xs text-muted-foreground">A friendly name to identify this schedule.</p>
					</div>

					<!-- Connector Selection (read-only display, connector cannot be changed after creation) -->
					<div class="grid gap-2">
						<Label>Connector</Label>
						<div class="flex h-9 w-full items-center rounded-md border border-input bg-muted/50 px-3 py-1 text-sm">
							{#if data.schedule.connector}
								{data.schedule.connector.name} ({data.schedule.connector.type})
							{:else}
								All Connectors
							{/if}
						</div>
						<p class="text-xs text-muted-foreground">
							Connector assignment cannot be changed after creation. Create a new schedule to use a
							different connector.
						</p>
					</div>

					<!-- Sweep Type -->
					<div class="grid gap-2">
						<Label for="sweepType">Sweep Type</Label>
						<select
							id="sweepType"
							name="sweepType"
							required
							disabled={isLoading}
							class={selectClass}
						>
							{#each sweepTypes as sweepType}
								<option
									value={sweepType}
									selected={getFormValue(formValues?.sweepType, data.schedule.sweepType) === sweepType}
								>
									{formatSweepType(sweepType)}
								</option>
							{/each}
						</select>
						<p class="text-xs text-muted-foreground">
							Incremental syncs check for new content. Full reconciliation rebuilds the entire
							content mirror.
						</p>
					</div>

					<!-- Cron Expression Builder -->
					<div class="grid gap-2">
						<Label>Schedule</Label>
						<CronBuilder bind:value={cronExpression} {timezone} disabled={isLoading} />
						<input type="hidden" name="cronExpression" value={cronExpression} />
					</div>

					<!-- Timezone -->
					<div class="grid gap-2">
						<Label for="timezone">Timezone</Label>
						<select
							id="timezone"
							name="timezone"
							required
							disabled={isLoading}
							bind:value={timezone}
							class={selectClass}
						>
							{#each timezoneOptions as tz}
								<option value={tz} selected={timezone === tz}>
									{tz}
								</option>
							{/each}
						</select>
						<p class="text-xs text-muted-foreground">
							The timezone for the schedule. Cron times will be interpreted in this timezone.
						</p>
					</div>

					<!-- Throttle Profile -->
					<div class="grid gap-2">
						<Label for="throttleProfileId">Throttle Profile</Label>
						<select
							id="throttleProfileId"
							name="throttleProfileId"
							disabled={isLoading}
							class={selectClass}
						>
							<option
								value=""
								selected={getFormValue(
									formValues?.throttleProfileId,
									data.schedule.throttleProfileId?.toString() ?? ''
								) === ''}
							>
								Use Default Profile
							</option>
							{#each data.throttleProfiles as profile}
								<option
									value={profile.id}
									selected={getFormValue(
										formValues?.throttleProfileId,
										data.schedule.throttleProfileId?.toString() ?? ''
									) === profile.id.toString()}
								>
									{profile.name}
									{#if profile.isDefault}
										(Default)
									{/if}
								</option>
							{/each}
						</select>
						<p class="text-xs text-muted-foreground">
							Rate limiting profile for search requests. Leave as default to use the system default.
						</p>
					</div>

					<!-- Submit -->
					<div class="flex gap-3 pt-2">
						<Button href="/schedules" variant="outline" disabled={isLoading}>Cancel</Button>
						<Button type="submit" disabled={isLoading}>
							{#if isSubmitting}
								Saving...
							{:else}
								Save Changes
							{/if}
						</Button>
					</div>
				</div>
			</form>
		</Card.Content>
	</Card.Root>
</div>
