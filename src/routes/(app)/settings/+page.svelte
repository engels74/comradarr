<script lang="ts">
	/**
	 * General settings page.
	 */
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { logLevels, logLevelLabels, logLevelDescriptions } from '$lib/schemas/settings';
	import type { PageProps } from './$types';
	import SettingsIcon from '@lucide/svelte/icons/settings';

	let { data, form }: PageProps = $props();

	let isSubmitting = $state(false);

	// Form state with initial values from loaded settings
	// Use untrack to explicitly capture initial value without reactive tracking
	let checkForUpdates = $state(untrack(() => data.settings.checkForUpdates));

	// Update checkForUpdates when form is submitted with errors (preserve user's choice)
	$effect(() => {
		if (form && 'checkForUpdates' in form) {
			checkForUpdates = form.checkForUpdates as boolean;
		}
	});

	// Common select styling
	const selectClass =
		'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm';

	// Get all IANA timezones
	const timezones = Intl.supportedValuesOf('timeZone');

	/**
	 * Get form value with fallback to loaded data.
	 */
	function getFormValue(formValue: string | undefined, settingsValue: string): string {
		return formValue ?? settingsValue;
	}
</script>

<svelte:head>
	<title>Settings - Comradarr</title>
</svelte:head>

<div class="container mx-auto p-6 max-w-2xl">
	<!-- Page Header -->
	<div class="mb-6">
		<div class="flex items-center gap-3">
			<SettingsIcon class="h-8 w-8 text-muted-foreground" />
			<div>
				<h1 class="text-3xl font-bold">Settings</h1>
				<p class="text-muted-foreground mt-1">Configure application settings</p>
			</div>
		</div>
	</div>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-xl">General Settings</Card.Title>
			<Card.Description>
				Configure the application name, timezone, logging, and update preferences.
			</Card.Description>
		</Card.Header>
		<Card.Content>
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

					<!-- Application Name -->
					<div class="grid gap-2">
						<Label for="appName">Application Name</Label>
						<Input
							id="appName"
							name="appName"
							type="text"
							placeholder="Comradarr"
							required
							disabled={isSubmitting}
							value={getFormValue(form?.appName?.toString(), data.settings.appName)}
						/>
						<p class="text-xs text-muted-foreground">
							The display name for this application instance.
						</p>
					</div>

					<!-- Timezone -->
					<div class="grid gap-2">
						<Label for="timezone">Timezone</Label>
						<select
							id="timezone"
							name="timezone"
							required
							disabled={isSubmitting}
							class={selectClass}
						>
							{#each timezones as tz}
								<option
									value={tz}
									selected={getFormValue(form?.timezone?.toString(), data.settings.timezone) === tz}
								>
									{tz}
								</option>
							{/each}
						</select>
						<p class="text-xs text-muted-foreground">
							The timezone used for scheduling and displaying dates/times.
						</p>
					</div>

					<!-- Log Level -->
					<div class="grid gap-2">
						<Label for="logLevel">Log Level</Label>
						<select
							id="logLevel"
							name="logLevel"
							required
							disabled={isSubmitting}
							class={selectClass}
						>
							{#each logLevels as level}
								<option
									value={level}
									selected={getFormValue(form?.logLevel?.toString(), data.settings.logLevel) ===
										level}
								>
									{logLevelLabels[level]} - {logLevelDescriptions[level]}
								</option>
							{/each}
						</select>
						<p class="text-xs text-muted-foreground">
							Controls the verbosity of application logging. More verbose levels include all
							messages from less verbose levels.
						</p>
					</div>

					<!-- Check for Updates -->
					<div class="grid gap-2">
						<div class="flex items-center space-x-3">
							<Checkbox
								id="checkForUpdates"
								name="checkForUpdates"
								bind:checked={checkForUpdates}
								disabled={isSubmitting}
							/>
							<Label for="checkForUpdates" class="text-sm font-medium cursor-pointer">
								Check for updates
							</Label>
						</div>
						<p class="text-xs text-muted-foreground ml-7">
							When enabled, the application will periodically check for new versions and notify you
							when updates are available.
						</p>
					</div>

					<!-- Submit -->
					<div class="flex gap-3 pt-4">
						<Button type="submit" disabled={isSubmitting}>
							{#if isSubmitting}
								Saving...
							{:else}
								Save Settings
							{/if}
						</Button>
					</div>
				</div>
			</form>
		</Card.Content>
	</Card.Root>
</div>
