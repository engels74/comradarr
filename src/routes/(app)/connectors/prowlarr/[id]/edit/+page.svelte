<!--
  Edit Prowlarr instance form page.
-->
<script lang="ts">
import { enhance } from '$app/forms';
import { goto } from '$app/navigation';
import { Button } from '$lib/components/ui/button';
import * as Card from '$lib/components/ui/card';
import { Input } from '$lib/components/ui/input';
import { Label } from '$lib/components/ui/label';
import { toastStore } from '$lib/components/ui/toast';
import type { ActionData, PageProps } from './$types';

let { data, form }: { data: PageProps['data']; form: ActionData } = $props();

let isSubmitting = $state(false);
let isTesting = $state(false);

const isLoading = $derived(isSubmitting || isTesting);

// Use form values if available (on error), otherwise use instance data
const name = $derived(form?.name ?? data.instance.name);
const url = $derived(form?.url ?? data.instance.url);
const enabled = $derived(form?.enabled ?? data.instance.enabled);
</script>

<svelte:head>
	<title>Edit {data.instance.name} - Prowlarr - Comradarr</title>
</svelte:head>

<div class="container mx-auto p-6 max-w-xl">
	<div class="mb-6">
		<a
			href="/connectors/prowlarr/{data.instance.id}"
			class="text-sm text-muted-foreground hover:text-foreground"
		>
			&larr; Back to Prowlarr Instance
		</a>
	</div>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-2xl font-bold">Edit Prowlarr</Card.Title>
			<Card.Description>Update the configuration for your Prowlarr instance.</Card.Description>
		</Card.Header>
		<Card.Content>
			<form
				method="POST"
				action="?/update"
				use:enhance={({ action }) => {
					const actionUrl = action.search;
					if (actionUrl === '?/testConnection') {
						isTesting = true;
					} else {
						isSubmitting = true;
					}
					return async ({ result, update }) => {
						await update({ reset: false });
						isTesting = false;
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
				<div class="grid gap-4">
					{#if form?.error}
						<div
							class="bg-destructive/15 text-destructive rounded-md border border-destructive/20 p-3 text-sm"
							role="alert"
						>
							{form.error}
						</div>
					{/if}

					<div class="grid gap-2">
						<Label for="name">Name</Label>
						<Input
							id="name"
							name="name"
							type="text"
							placeholder="My Prowlarr"
							required
							disabled={isLoading}
							value={name}
						/>
						<p class="text-xs text-muted-foreground">
							A friendly name to identify this Prowlarr instance.
						</p>
					</div>

					<div class="grid gap-2">
						<Label for="url">URL</Label>
						<Input
							id="url"
							name="url"
							type="url"
							placeholder="http://localhost:9696"
							required
							disabled={isLoading}
							value={url}
						/>
						<p class="text-xs text-muted-foreground">
							The full URL to your Prowlarr instance, including the port.
						</p>
					</div>

					<div class="grid gap-2">
						<Label for="apiKey">API Key</Label>
						<Input
							id="apiKey"
							name="apiKey"
							type="password"
							placeholder="Leave blank to keep current"
							disabled={isLoading}
						/>
						<p class="text-xs text-muted-foreground">
							Leave blank to keep the existing API key, or enter a new one to update it.
						</p>
					</div>

					<div class="flex items-center gap-2">
						<input
							type="checkbox"
							id="enabled"
							name="enabled"
							value="true"
							checked={enabled}
							disabled={isLoading}
							class="h-4 w-4 rounded border-input text-primary focus:ring-ring"
						/>
						<Label for="enabled" class="text-sm font-normal cursor-pointer">
							Enable health monitoring
						</Label>
					</div>

					<div class="flex gap-3 pt-2">
						<Button
							type="submit"
							formaction="?/testConnection"
							variant="outline"
							disabled={isLoading}
						>
							{#if isTesting}
								Testing...
							{:else}
								Test Connection
							{/if}
						</Button>
						<Button type="submit" disabled={isLoading}>
							{#if isSubmitting}
								Saving...
							{:else}
								Save Changes
							{/if}
						</Button>
						<Button
							href="/connectors/prowlarr/{data.instance.id}"
							variant="ghost"
							disabled={isLoading}
						>
							Cancel
						</Button>
					</div>
				</div>
			</form>
		</Card.Content>
	</Card.Root>
</div>
