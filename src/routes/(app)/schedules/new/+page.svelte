<script lang="ts">
	/**
	 * New schedule form page.
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
	import type { ActionData, PageProps } from './$types';

	let { data, form }: PageProps & { form: ActionData } = $props();

	let isSubmitting = $state(false);

	// Form state - use untrack to explicitly capture initial values without reactive tracking
	let cronExpression = $state(untrack(() => form?.cronExpression ?? '0 3 * * *'));
	let timezone = $state(untrack(() => form?.timezone ?? 'UTC'));

	const isLoading = $derived(isSubmitting);

	// Select styling
	const selectClass =
		'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm';

	/**
	 * Format sweep type for display.
	 */
	function formatSweepType(type: string): string {
		return type === 'incremental' ? 'Incremental Sync' : 'Full Reconciliation';
	}
</script>

<svelte:head>
	<title>Add Schedule - Comradarr</title>
</svelte:head>

<div class="container mx-auto p-6 max-w-2xl">
	<div class="mb-6">
		<a href="/schedules" class="text-sm text-muted-foreground hover:text-foreground">
			&larr; Back to Schedules
		</a>
	</div>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-2xl font-bold">Add Schedule</Card.Title>
			<Card.Description>
				Create a new sweep schedule to automatically detect content gaps and upgrade candidates.
			</Card.Description>
		</Card.Header>
		<Card.Content>
			<form
				method="POST"
				action="?/create"
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
							value={form?.name ?? ''}
						/>
						<p class="text-xs text-muted-foreground">A friendly name to identify this schedule.</p>
					</div>

					<!-- Connector Selection -->
					<div class="grid gap-2">
						<Label for="connectorId">Connector</Label>
						<select id="connectorId" name="connectorId" disabled={isLoading} class={selectClass}>
							<option value="" selected={!form?.connectorId}>All Connectors</option>
							{#each data.connectors as connector}
								<option
									value={connector.id}
									selected={form?.connectorId === connector.id.toString()}
								>
									{connector.name} ({connector.type})
								</option>
							{/each}
						</select>
						<p class="text-xs text-muted-foreground">
							Select a specific connector or leave as "All Connectors" for a global schedule.
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
							<option value="" disabled selected={!form?.sweepType}>Select a sweep type...</option>
							{#each sweepTypes as sweepType}
								<option value={sweepType} selected={form?.sweepType === sweepType}>
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
							<option value="" selected={!form?.throttleProfileId}>Use Default Profile</option>
							{#each data.throttleProfiles as profile}
								<option
									value={profile.id}
									selected={form?.throttleProfileId === profile.id.toString()}
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
								Creating...
							{:else}
								Create Schedule
							{/if}
						</Button>
					</div>
				</div>
			</form>
		</Card.Content>
	</Card.Root>
</div>
