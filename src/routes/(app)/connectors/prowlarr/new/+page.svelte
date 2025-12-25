<script lang="ts">
	/**
	 * Add Prowlarr instance form page.
	 */
	import { enhance } from '$app/forms';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import { toastStore } from '$lib/components/ui/toast';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();

	// Show toast on form result
	$effect(() => {
		if (form?.success && form?.message) {
			toastStore.success(form.message);
		}
	});

	let isSubmitting = $state(false);
	let isTesting = $state(false);

	const isLoading = $derived(isSubmitting || isTesting);
</script>

<svelte:head>
	<title>Add Prowlarr - Comradarr</title>
</svelte:head>

<div class="container mx-auto p-6 max-w-xl">
	<div class="mb-6">
		<a href="/connectors" class="text-sm text-muted-foreground hover:text-foreground">
			&larr; Back to Connectors
		</a>
	</div>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-2xl font-bold">Add Prowlarr</Card.Title>
			<Card.Description>
				Connect to Prowlarr to monitor your indexer health status. This is informational only and
				does not affect search dispatch.
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
							placeholder="My Prowlarr"
							required
							disabled={isLoading}
							value={form?.name ?? ''}
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
							value={form?.url ?? ''}
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
							placeholder="Enter your API key"
							required
							disabled={isLoading}
						/>
						<p class="text-xs text-muted-foreground">
							Found in Settings &rarr; General &rarr; Security in Prowlarr.
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
								Add Prowlarr
							{/if}
						</Button>
					</div>
				</div>
			</form>
		</Card.Content>
	</Card.Root>
</div>
