<script lang="ts">
	/**
	 * API Keys settings page.
	 *
	 * Requirements: 34.1, 34.3
	 */
	import { enhance } from '$app/forms';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import { Badge } from '$lib/components/ui/badge';
	import * as Dialog from '$lib/components/ui/dialog';
	import {
		apiKeyScopes,
		apiKeyScopeLabels,
		apiKeyScopeDescriptions,
		apiKeyExpirations,
		apiKeyExpirationLabels,
		type ApiKeyScope
	} from '$lib/schemas/settings';
	import type { PageProps } from './$types';
	import KeyIcon from '@lucide/svelte/icons/key';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import BanIcon from '@lucide/svelte/icons/ban';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import CheckIcon from '@lucide/svelte/icons/check';
	import AlertTriangleIcon from '@lucide/svelte/icons/alert-triangle';

	let { data, form }: PageProps = $props();

	let isSubmitting = $state(false);
	let showCreateDialog = $state(false);
	let newKeyValue = $state<string | null>(null);
	let copied = $state(false);
	let selectedScope = $state<ApiKeyScope>('read');

	// Common select styling
	const selectClass =
		'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm';

	// Show new key dialog when a key is created
	$effect(() => {
		if (form?.action === 'createKey' && form?.success && form?.plainKey) {
			newKeyValue = form.plainKey;
			showCreateDialog = false;
		}
	});

	function formatDate(date: Date | null): string {
		if (!date) return 'Never';
		return new Date(date).toLocaleDateString();
	}

	function formatRelativeTime(date: Date | null): string {
		if (!date) return 'Never';
		const now = new Date();
		const diff = now.getTime() - new Date(date).getTime();
		const minutes = Math.floor(diff / 60000);
		const hours = Math.floor(minutes / 60);
		const days = Math.floor(hours / 24);

		if (minutes < 1) return 'Just now';
		if (minutes < 60) return `${minutes}m ago`;
		if (hours < 24) return `${hours}h ago`;
		return `${days}d ago`;
	}

	async function copyToClipboard(text: string) {
		await navigator.clipboard.writeText(text);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}

	function closeNewKeyDialog() {
		newKeyValue = null;
	}

	function isExpired(expiresAt: Date | null): boolean {
		if (!expiresAt) return false;
		return new Date(expiresAt) < new Date();
	}

	function isRevoked(revokedAt: Date | null): boolean {
		return revokedAt !== null;
	}
</script>

<svelte:head>
	<title>API Keys - Comradarr</title>
</svelte:head>

<div class="container mx-auto p-6 max-w-2xl">
	<!-- Page Header -->
	<div class="mb-6">
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-3">
				<KeyIcon class="h-8 w-8 text-muted-foreground" />
				<div>
					<h1 class="text-3xl font-bold">API Keys</h1>
					<p class="text-muted-foreground mt-1">Manage API keys for programmatic access</p>
				</div>
			</div>
			{#if !data.isLocalBypass}
				<Button onclick={() => (showCreateDialog = true)}>
					<PlusIcon class="h-4 w-4 mr-2" />
					Create Key
				</Button>
			{/if}
		</div>
	</div>

	<!-- Local Bypass Warning -->
	{#if data.isLocalBypass}
		<div
			class="bg-amber-500/15 text-amber-600 dark:text-amber-400 rounded-md border border-amber-500/20 p-4 mb-6"
			role="alert"
		>
			<div class="flex items-start gap-3">
				<AlertTriangleIcon class="h-5 w-5 mt-0.5 flex-shrink-0" />
				<div>
					<p class="font-medium">Local Network Bypass Active</p>
					<p class="text-sm mt-1">
						API key management is not available in local network bypass mode. Please log in with a
						user account to create and manage API keys.
					</p>
				</div>
			</div>
		</div>
	{/if}

	<!-- New Key Display Dialog -->
	<Dialog.Root open={!!newKeyValue} onOpenChange={closeNewKeyDialog}>
		<Dialog.Content>
			<Dialog.Header>
				<Dialog.Title>API Key Created</Dialog.Title>
				<Dialog.Description>
					Copy your API key now. You will not be able to see it again.
				</Dialog.Description>
			</Dialog.Header>
			<div class="space-y-4">
				<div
					class="bg-amber-500/15 text-amber-600 dark:text-amber-400 rounded-md border border-amber-500/20 p-3 text-sm"
				>
					<div class="flex items-start gap-2">
						<AlertTriangleIcon class="h-4 w-4 mt-0.5 flex-shrink-0" />
						<span>This key will only be shown once. Store it securely.</span>
					</div>
				</div>
				<div class="flex items-center gap-2">
					<code class="flex-1 bg-muted p-3 rounded-md text-sm font-mono break-all">
						{newKeyValue}
					</code>
					<Button
						variant="outline"
						size="icon"
						onclick={() => newKeyValue && copyToClipboard(newKeyValue)}
					>
						{#if copied}
							<CheckIcon class="h-4 w-4 text-green-500" />
						{:else}
							<CopyIcon class="h-4 w-4" />
						{/if}
					</Button>
				</div>
			</div>
			<Dialog.Footer>
				<Button onclick={closeNewKeyDialog}>Done</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>

	<!-- Create Key Dialog -->
	<Dialog.Root bind:open={showCreateDialog}>
		<Dialog.Content>
			<Dialog.Header>
				<Dialog.Title>Create API Key</Dialog.Title>
				<Dialog.Description>
					Create a new API key for programmatic access to Comradarr.
				</Dialog.Description>
			</Dialog.Header>
			<form
				method="POST"
				action="?/createKey"
				use:enhance={() => {
					isSubmitting = true;
					return async ({ update }) => {
						await update();
						isSubmitting = false;
						if (form?.action === 'createKey' && form?.success) {
							showCreateDialog = false;
						}
					};
				}}
			>
				<div class="space-y-4">
					{#if form?.action === 'createKey' && form?.error}
						<div
							class="bg-destructive/15 text-destructive rounded-md border border-destructive/20 p-3 text-sm"
						>
							{form.error}
						</div>
					{/if}

					<div class="grid gap-2">
						<Label for="name">Name</Label>
						<Input
							id="name"
							name="name"
							placeholder="e.g., Home Assistant Integration"
							required
							disabled={isSubmitting}
						/>
					</div>

					<div class="grid gap-2">
						<Label for="description">Description (optional)</Label>
						<Input
							id="description"
							name="description"
							placeholder="What is this key used for?"
							disabled={isSubmitting}
						/>
					</div>

					<div class="grid gap-2">
						<Label for="scope">Scope</Label>
						<select
							id="scope"
							name="scope"
							required
							disabled={isSubmitting}
							class={selectClass}
							bind:value={selectedScope}
						>
							{#each apiKeyScopes as scope}
								<option value={scope}>{apiKeyScopeLabels[scope]}</option>
							{/each}
						</select>
						<p class="text-xs text-muted-foreground">
							{apiKeyScopeDescriptions[selectedScope]}
						</p>
					</div>

					<div class="grid gap-2">
						<Label for="expiresIn">Expiration</Label>
						<select id="expiresIn" name="expiresIn" disabled={isSubmitting} class={selectClass}>
							{#each apiKeyExpirations as exp}
								<option value={exp}>{apiKeyExpirationLabels[exp]}</option>
							{/each}
						</select>
					</div>
				</div>

				<Dialog.Footer class="mt-6">
					<Button type="button" variant="outline" onclick={() => (showCreateDialog = false)}>
						Cancel
					</Button>
					<Button type="submit" disabled={isSubmitting}>
						{isSubmitting ? 'Creating...' : 'Create Key'}
					</Button>
				</Dialog.Footer>
			</form>
		</Dialog.Content>
	</Dialog.Root>

	<!-- API Keys List -->
	<Card.Root>
		<Card.Header>
			<Card.Title class="text-xl">Your API Keys</Card.Title>
			<Card.Description>
				Use these keys to authenticate API requests with the Authorization header.
			</Card.Description>
		</Card.Header>
		<Card.Content>
			{#if data.isLocalBypass}
				<p class="text-sm text-muted-foreground text-center py-8">
					API key management is not available in local network bypass mode.
				</p>
			{:else if data.apiKeys.length === 0}
				<p class="text-sm text-muted-foreground text-center py-8">
					No API keys yet. Create one to get started.
				</p>
			{:else}
				<div class="space-y-3">
					{#each data.apiKeys as key}
						<div
							class="flex items-center justify-between p-3 rounded-lg border bg-card {isRevoked(key.revokedAt) ? 'opacity-60' : ''}"
						>
							<div class="flex flex-col gap-1">
								<div class="flex items-center gap-2">
									<span class="font-medium text-sm">{key.name}</span>
									<Badge variant={key.scope === 'full' ? 'default' : 'secondary'}>
										{apiKeyScopeLabels[key.scope]}
									</Badge>
									{#if isRevoked(key.revokedAt)}
										<Badge variant="destructive">Revoked</Badge>
									{:else if isExpired(key.expiresAt)}
										<Badge variant="destructive">Expired</Badge>
									{/if}
								</div>
								<div class="flex items-center gap-3 text-xs text-muted-foreground">
									<code class="bg-muted px-1 rounded">cmdr_{key.keyPrefix}...</code>
									<span>Created: {formatDate(key.createdAt)}</span>
									{#if key.revokedAt}
										<span>Revoked: {formatDate(key.revokedAt)}</span>
									{:else if key.expiresAt}
										<span>Expires: {formatDate(key.expiresAt)}</span>
									{/if}
									<span>Last used: {formatRelativeTime(key.lastUsedAt)}</span>
								</div>
								{#if key.description}
									<p class="text-xs text-muted-foreground mt-1">{key.description}</p>
								{/if}
							</div>

							<div class="flex items-center gap-1">
								{#if !isRevoked(key.revokedAt)}
									<form
										method="POST"
										action="?/revokeKey"
										use:enhance={() => {
											isSubmitting = true;
											return async ({ update }) => {
												await update();
												isSubmitting = false;
											};
										}}
									>
										<input type="hidden" name="keyId" value={key.id} />
										<Button
											type="submit"
											variant="ghost"
											size="sm"
											disabled={isSubmitting}
											class="text-amber-600 hover:text-amber-600 hover:bg-amber-500/10"
											title="Revoke key"
										>
											<BanIcon class="h-4 w-4" />
											<span class="sr-only">Revoke key</span>
										</Button>
									</form>
								{/if}
								<form
									method="POST"
									action="?/deleteKey"
									use:enhance={() => {
										isSubmitting = true;
										return async ({ update }) => {
											await update();
											isSubmitting = false;
										};
									}}
								>
									<input type="hidden" name="keyId" value={key.id} />
									<Button
										type="submit"
										variant="ghost"
										size="sm"
										disabled={isSubmitting}
										class="text-destructive hover:text-destructive hover:bg-destructive/10"
										title="Delete key"
									>
										<Trash2Icon class="h-4 w-4" />
										<span class="sr-only">Delete key</span>
									</Button>
								</form>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</Card.Content>
	</Card.Root>

	<!-- Usage Instructions -->
	{#if !data.isLocalBypass}
		<Card.Root class="mt-6">
			<Card.Header>
				<Card.Title class="text-xl">Usage</Card.Title>
			</Card.Header>
			<Card.Content>
				<p class="text-sm text-muted-foreground mb-4">
					Include your API key in the Authorization header of your requests:
				</p>
				<code class="block bg-muted p-3 rounded-md text-sm font-mono">
					Authorization: Bearer cmdr_your_api_key_here
				</code>
			</Card.Content>
		</Card.Root>
	{/if}
</div>
