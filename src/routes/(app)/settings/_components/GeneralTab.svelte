<script lang="ts">
import { untrack } from 'svelte';
import { enhance } from '$app/forms';
import { Button } from '$lib/components/ui/button';
import * as Card from '$lib/components/ui/card';
import { Checkbox } from '$lib/components/ui/checkbox';
import { Input } from '$lib/components/ui/input';
import { Label } from '$lib/components/ui/label';
import { toastStore } from '$lib/components/ui/toast';
import { logLevelDescriptions, logLevelLabels, logLevels } from '$lib/schemas/settings';
import type { GeneralSettings } from '$lib/server/db/queries/settings';

interface Props {
	data: GeneralSettings;
	form: Record<string, unknown> | null;
	accentColor: string;
}

let { data, form, accentColor }: Props = $props();

let isSubmitting = $state(false);
let checkForUpdates = $state(untrack(() => data.checkForUpdates));

$effect(() => {
	if (form && form.action === 'generalUpdate' && 'checkForUpdates' in form) {
		checkForUpdates = form.checkForUpdates as boolean;
	}
});

const selectClass =
	'flex h-9 w-full rounded-lg border border-glass-border/30 bg-glass/50 backdrop-blur-sm px-3 py-1 text-base transition-all placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 hover:bg-glass/70 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm';

const timezones = Intl.supportedValuesOf('timeZone');

function getFormValue(formValue: string | undefined, settingsValue: string): string {
	return formValue ?? settingsValue;
}
</script>

<Card.Root variant="glass" class="relative overflow-hidden">
	<div
		class="absolute top-0 left-0 right-0 h-px opacity-60"
		style="background: linear-gradient(to right, transparent, {accentColor}, transparent);"
	></div>
	<Card.Header>
		<Card.Title class="text-xl font-display">General Settings</Card.Title>
		<Card.Description>
			Configure the application name, timezone, logging, and update preferences.
		</Card.Description>
	</Card.Header>
	<Card.Content>
		<form
			method="POST"
			action="?/generalUpdate"
			use:enhance={() => {
				isSubmitting = true;
				return async ({ result, update }) => {
					await update();
					isSubmitting = false;
					if (result.type === 'success' && result.data?.success) {
						toastStore.success((result.data.message as string) || 'Settings saved successfully');
					}
				};
			}}
		>
			<div class="grid gap-6">
				{#if form?.action === 'generalUpdate' && form?.error}
					<div
						class="bg-destructive/15 text-destructive rounded-md border border-destructive/20 p-3 text-sm"
						role="alert"
					>
						{form.error}
					</div>
				{/if}

				<div class="grid gap-2">
					<Label for="appName">Application Name</Label>
					<Input
						id="appName"
						name="appName"
						type="text"
						placeholder="Comradarr"
						required
						disabled={isSubmitting}
						value={getFormValue(form?.appName?.toString(), data.appName)}
					/>
					<p class="text-xs text-muted-foreground">
						The display name for this application instance.
					</p>
				</div>

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
								selected={getFormValue(form?.timezone?.toString(), data.timezone) === tz}
							>
								{tz}
							</option>
						{/each}
					</select>
					<p class="text-xs text-muted-foreground">
						The timezone used for scheduling and displaying dates/times.
					</p>
				</div>

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
								selected={getFormValue(form?.logLevel?.toString(), data.logLevel) === level}
							>
								{logLevelLabels[level]} - {logLevelDescriptions[level]}
							</option>
						{/each}
					</select>
					<p class="text-xs text-muted-foreground">
						Controls the verbosity of application logging. More verbose levels include all messages
						from less verbose levels.
					</p>
				</div>

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
