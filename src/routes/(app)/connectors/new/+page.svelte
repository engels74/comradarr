<script lang="ts">
	/**
	 * Add connector form page.
	 */
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import { toastStore } from '$lib/components/ui/toast';
	import type { ActionData } from './$types';
	import { connectorTypes } from '$lib/schemas/connectors';

	let { form }: { form: ActionData } = $props();

	let isSubmitting = $state(false);
	let isTesting = $state(false);

	const isLoading = $derived(isSubmitting || isTesting);
</script>

<svelte:head>
	<title>Add Connector - Comradarr</title>
</svelte:head>

<div class="container mx-auto p-6 max-w-xl">
	<div class="mb-6">
		<a href="/connectors" class="text-sm text-muted-foreground hover:text-foreground">
			&larr; Back to Connectors
		</a>
	</div>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-2xl font-bold">Add Connector</Card.Title>
			<Card.Description>
				Connect to a Sonarr, Radarr, or Whisparr instance to monitor your media library.
			</Card.Description>
		</Card.Header>
		<Card.Content>
			<form
				method="POST"
				action="?/create"
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
							placeholder="My Sonarr"
							required
							disabled={isLoading}
							value={form?.name ?? ''}
						/>
						<p class="text-xs text-muted-foreground">A friendly name to identify this connector.</p>
					</div>

					<div class="grid gap-2">
						<Label for="type">Type</Label>
						<select
							id="type"
							name="type"
							required
							disabled={isLoading}
							class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
						>
							<option value="" disabled selected={!form?.type}>Select a type...</option>
							{#each connectorTypes as connectorType}
								<option value={connectorType} selected={form?.type === connectorType}>
									{connectorType.charAt(0).toUpperCase() + connectorType.slice(1)}
								</option>
							{/each}
						</select>
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
							value={form?.url ?? ''}
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
							placeholder="Enter your API key"
							required
							disabled={isLoading}
						/>
						<p class="text-xs text-muted-foreground">
							Found in Settings &rarr; General &rarr; Security in your *arr application.
						</p>
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
								Adding...
							{:else}
								Add Connector
							{/if}
						</Button>
					</div>
				</div>
			</form>
		</Card.Content>
	</Card.Root>
</div>
