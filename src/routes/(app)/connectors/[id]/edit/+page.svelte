<!--
  Edit connector form page.
-->
<script lang="ts">
	import { enhance } from '$app/forms';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import { toastStore } from '$lib/components/ui/toast';
	import type { PageProps, ActionData } from './$types';
	import { connectorTypes } from '$lib/schemas/connectors';

	let { data, form }: { data: PageProps['data']; form: ActionData } = $props();

	// Show toast on form result
	$effect(() => {
		if (form?.success && form?.message) {
			toastStore.success(form.message);
		}
	});

	let isSubmitting = $state(false);
	let isTesting = $state(false);

	const isLoading = $derived(isSubmitting || isTesting);

	// Use form values if available (on error), otherwise use connector data
	const name = $derived(form?.name ?? data.connector.name);
	const type = $derived(form?.type ?? data.connector.type);
	const url = $derived(form?.url ?? data.connector.url);
	const enabled = $derived(form?.enabled ?? data.connector.enabled);

	const formattedType = $derived(type.charAt(0).toUpperCase() + type.slice(1));
</script>

<svelte:head>
	<title>Edit {data.connector.name} - Connectors - Comradarr</title>
</svelte:head>

<div class="container mx-auto p-6 max-w-xl">
	<div class="mb-6">
		<a
			href="/connectors/{data.connector.id}"
			class="text-sm text-muted-foreground hover:text-foreground"
		>
			&larr; Back to Connector
		</a>
	</div>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-2xl font-bold">Edit Connector</Card.Title>
			<Card.Description>
				Update the configuration for your {formattedType} connector.
			</Card.Description>
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
					return async ({ update }) => {
						await update({ reset: false });
						isTesting = false;
						isSubmitting = false;
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
							placeholder="My Sonarr"
							required
							disabled={isLoading}
							value={name}
						/>
						<p class="text-xs text-muted-foreground">
							A friendly name to identify this connector.
						</p>
					</div>

					<div class="grid gap-2">
						<Label for="type">Type</Label>
						<select
							id="type"
							name="type"
							required
							disabled
							class="flex h-9 w-full rounded-md border border-input bg-muted px-3 py-1 text-base shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
						>
							{#each connectorTypes as connectorType}
								<option value={connectorType} selected={type === connectorType}>
									{connectorType.charAt(0).toUpperCase() + connectorType.slice(1)}
								</option>
							{/each}
						</select>
						<p class="text-xs text-muted-foreground">
							Connector type cannot be changed. Delete and recreate to change type.
						</p>
					</div>

					<div class="grid gap-2">
						<Label for="url">URL</Label>
						<Input
							id="url"
							name="url"
							type="url"
							placeholder="http://localhost:8989"
							required
							disabled={isLoading}
							value={url}
						/>
						<p class="text-xs text-muted-foreground">
							The full URL to your *arr application, including the port.
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
							Enable connector
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
						<Button href="/connectors/{data.connector.id}" variant="ghost" disabled={isLoading}>
							Cancel
						</Button>
					</div>
				</div>
			</form>
		</Card.Content>
	</Card.Root>
</div>
