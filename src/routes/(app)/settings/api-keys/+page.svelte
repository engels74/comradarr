<script lang="ts">
/**
 * API Keys settings page.
 */

import AlertTriangleIcon from '@lucide/svelte/icons/alert-triangle';
import BanIcon from '@lucide/svelte/icons/ban';
import CheckIcon from '@lucide/svelte/icons/check';
import CopyIcon from '@lucide/svelte/icons/copy';
import KeyIcon from '@lucide/svelte/icons/key';
import PlusIcon from '@lucide/svelte/icons/plus';
import SettingsIcon from '@lucide/svelte/icons/settings';
import Trash2Icon from '@lucide/svelte/icons/trash-2';
import { enhance } from '$app/forms';
import { Badge } from '$lib/components/ui/badge';
import { Button } from '$lib/components/ui/button';
import * as Card from '$lib/components/ui/card';
import * as Dialog from '$lib/components/ui/dialog';
import { Input } from '$lib/components/ui/input';
import { Label } from '$lib/components/ui/label';
import { toastStore } from '$lib/components/ui/toast';
import {
	type ApiKeyRateLimitPreset,
	type ApiKeyScope,
	apiKeyExpirationLabels,
	apiKeyExpirations,
	apiKeyRateLimitPresetDescriptions,
	apiKeyRateLimitPresetLabels,
	apiKeyRateLimitPresets,
	apiKeyScopeDescriptions,
	apiKeyScopeLabels,
	apiKeyScopes,
	toRateLimitFormValues
} from '$lib/schemas/settings';
import type { PageProps } from './$types';

let { data, form }: PageProps = $props();

let isSubmitting = $state(false);
let showCreateDialog = $state(false);
let showRateLimitDialog = $state(false);
let editingKeyId = $state<number | null>(null);
let newKeyValue = $state<string | null>(null);
let copied = $state(false);
let selectedScope = $state<ApiKeyScope>('read');
let selectedRateLimitPreset = $state<ApiKeyRateLimitPreset>('unlimited');
let customRateLimit = $state<number>(60);
let editRateLimitPreset = $state<ApiKeyRateLimitPreset>('unlimited');
let editCustomRateLimit = $state<number>(60);

// Common select styling - glass variant
const selectClass =
	'flex h-9 w-full rounded-lg border border-glass-border/30 bg-glass/50 backdrop-blur-sm px-3 py-1 text-base transition-all placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 hover:bg-glass/70 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm';

// Show new key dialog when a key is created
$effect(() => {
	if (form?.action === 'createKey' && form?.success && form?.plainKey) {
		newKeyValue = form.plainKey;
		showCreateDialog = false;
		toastStore.success(form.message ?? 'API key created successfully');
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
	setTimeout(() => {
		copied = false;
	}, 2000);
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

function formatRateLimit(rateLimitPerMinute: number | null): string {
	if (rateLimitPerMinute === null) return 'Unlimited';
	return `${rateLimitPerMinute}/min`;
}

function openRateLimitDialog(keyId: number, rateLimitPerMinute: number | null) {
	editingKeyId = keyId;
	const formValues = toRateLimitFormValues(rateLimitPerMinute);
	editRateLimitPreset = formValues.preset;
	editCustomRateLimit = formValues.custom ?? 60;
	showRateLimitDialog = true;
}

function closeRateLimitDialog() {
	showRateLimitDialog = false;
	editingKeyId = null;
}

// Close rate limit dialog on successful update
$effect(() => {
	if (form?.action === 'updateRateLimit' && form?.success) {
		closeRateLimitDialog();
		toastStore.success(form.message ?? 'Rate limit updated successfully');
	}
});
</script>

<svelte:head>
	<title>API Keys - Comradarr</title>
</svelte:head>

<div class="container mx-auto p-6 lg:p-8 max-w-2xl">
	<!-- Page Header -->
	<header class="mb-8 animate-float-up" style="animation-delay: 0ms;">
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-3">
				<div class="p-2.5 rounded-xl bg-muted/50">
					<KeyIcon class="h-6 w-6 text-muted-foreground" />
				</div>
				<div>
					<h1 class="font-display text-3xl font-semibold tracking-tight md:text-4xl">API Keys</h1>
					<p class="text-muted-foreground mt-2">Manage API keys for programmatic access</p>
				</div>
			</div>
			{#if !data.isLocalBypass}
				<Button onclick={() => (showCreateDialog = true)}>
					<PlusIcon class="h-4 w-4 mr-2" />
					Create Key
				</Button>
			{/if}
		</div>
	</header>

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

					<div class="grid gap-2">
						<Label for="rateLimitPreset">Rate Limit</Label>
						<select
							id="rateLimitPreset"
							name="rateLimitPreset"
							disabled={isSubmitting}
							class={selectClass}
							bind:value={selectedRateLimitPreset}
						>
							{#each apiKeyRateLimitPresets as preset}
								<option value={preset}>{apiKeyRateLimitPresetLabels[preset]}</option>
							{/each}
						</select>
						<p class="text-xs text-muted-foreground">
							{apiKeyRateLimitPresetDescriptions[selectedRateLimitPreset]}
						</p>
						{#if selectedRateLimitPreset === 'custom'}
							<div class="flex items-center gap-2 mt-2">
								<Input
									id="rateLimitCustom"
									name="rateLimitCustom"
									type="number"
									min="1"
									max="1000"
									bind:value={customRateLimit}
									disabled={isSubmitting}
									class="w-24"
								/>
								<span class="text-sm text-muted-foreground">requests per minute</span>
							</div>
						{/if}
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

	<!-- Edit Rate Limit Dialog -->
	<Dialog.Root bind:open={showRateLimitDialog} onOpenChange={closeRateLimitDialog}>
		<Dialog.Content>
			<Dialog.Header>
				<Dialog.Title>Edit Rate Limit</Dialog.Title>
				<Dialog.Description>Update the rate limit for this API key.</Dialog.Description>
			</Dialog.Header>
			<form
				method="POST"
				action="?/updateRateLimit"
				use:enhance={() => {
					isSubmitting = true;
					return async ({ update }) => {
						await update();
						isSubmitting = false;
					};
				}}
			>
				<input type="hidden" name="keyId" value={editingKeyId} />
				<div class="space-y-4">
					{#if form?.action === 'updateRateLimit' && form?.error}
						<div
							class="bg-destructive/15 text-destructive rounded-md border border-destructive/20 p-3 text-sm"
						>
							{form.error}
						</div>
					{/if}

					<div class="grid gap-2">
						<Label for="editRateLimitPreset">Rate Limit</Label>
						<select
							id="editRateLimitPreset"
							name="rateLimitPreset"
							disabled={isSubmitting}
							class={selectClass}
							bind:value={editRateLimitPreset}
						>
							{#each apiKeyRateLimitPresets as preset}
								<option value={preset}>{apiKeyRateLimitPresetLabels[preset]}</option>
							{/each}
						</select>
						<p class="text-xs text-muted-foreground">
							{apiKeyRateLimitPresetDescriptions[editRateLimitPreset]}
						</p>
						{#if editRateLimitPreset === 'custom'}
							<div class="flex items-center gap-2 mt-2">
								<Input
									id="editRateLimitCustom"
									name="rateLimitCustom"
									type="number"
									min="1"
									max="1000"
									bind:value={editCustomRateLimit}
									disabled={isSubmitting}
									class="w-24"
								/>
								<span class="text-sm text-muted-foreground">requests per minute</span>
							</div>
						{/if}
					</div>
				</div>

				<Dialog.Footer class="mt-6">
					<Button type="button" variant="outline" onclick={closeRateLimitDialog}>Cancel</Button>
					<Button type="submit" disabled={isSubmitting}>
						{isSubmitting ? 'Saving...' : 'Save'}
					</Button>
				</Dialog.Footer>
			</form>
		</Dialog.Content>
	</Dialog.Root>

	<!-- API Keys List -->
	<Card.Root variant="glass" class="animate-float-up" style="animation-delay: 100ms;">
		<Card.Header>
			<Card.Title class="text-xl font-display">Your API Keys</Card.Title>
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
							class="flex items-center justify-between p-3 rounded-xl border border-glass-border/20 bg-glass/30 backdrop-blur-sm hover:bg-glass/50 transition-all duration-200 {isRevoked(
								key.revokedAt
							)
								? 'opacity-60'
								: ''}"
						>
							<div class="flex flex-col gap-1">
								<div class="flex items-center gap-2">
									<span class="font-medium text-sm">{key.name}</span>
									<Badge variant={key.scope === 'full' ? 'default' : 'secondary'}>
										{apiKeyScopeLabels[key.scope]}
									</Badge>
									<Badge variant="outline">
										{formatRateLimit(key.rateLimitPerMinute)}
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
									<Button
										type="button"
										variant="ghost"
										size="sm"
										disabled={isSubmitting}
										class="text-muted-foreground hover:text-foreground"
										title="Edit rate limit"
										onclick={() => openRateLimitDialog(key.id, key.rateLimitPerMinute)}
									>
										<SettingsIcon class="h-4 w-4" />
										<span class="sr-only">Edit rate limit</span>
									</Button>
									<form
										method="POST"
										action="?/revokeKey"
										use:enhance={() => {
											isSubmitting = true;
											return async ({ result, update }) => {
												await update();
												isSubmitting = false;
												if (result.type === 'success' && result.data?.success) {
													toastStore.success((result.data.message as string) || 'API key revoked');
												}
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
										return async ({ result, update }) => {
											await update();
											isSubmitting = false;
											if (result.type === 'success' && result.data?.success) {
												toastStore.success((result.data.message as string) || 'API key deleted');
											}
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
		<Card.Root variant="glass" class="mt-6 animate-float-up" style="animation-delay: 150ms;">
			<Card.Header>
				<Card.Title class="text-xl font-display">Usage</Card.Title>
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
