<script lang="ts">
import AlertTriangleIcon from '@lucide/svelte/icons/alert-triangle';
import BanIcon from '@lucide/svelte/icons/ban';
import CheckIcon from '@lucide/svelte/icons/check';
import CopyIcon from '@lucide/svelte/icons/copy';
import KeyIcon from '@lucide/svelte/icons/key';
import MonitorSmartphoneIcon from '@lucide/svelte/icons/monitor-smartphone';
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
import { Separator } from '$lib/components/ui/separator';
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
	authModeDescriptions,
	authModeLabels,
	authModes,
	toRateLimitFormValues
} from '$lib/schemas/settings';
import type { SecuritySettings } from '$lib/server/db/queries/settings';

interface Session {
	id: string;
	userAgent: string | null;
	ipAddress: string | null;
	lastAccessedAt: Date;
	isCurrent: boolean;
}

interface ApiKey {
	id: number;
	name: string;
	description: string | null;
	keyPrefix: string;
	scope: ApiKeyScope;
	rateLimitPerMinute: number | null;
	createdAt: Date | null;
	expiresAt: Date | null;
	revokedAt: Date | null;
	lastUsedAt: Date | null;
}

interface Props {
	security: {
		settings: SecuritySettings;
		sessions: Session[];
		currentSessionId: string | null;
		isLocalBypass: boolean;
	};
	apiKeys: {
		keys: ApiKey[];
		isLocalBypass: boolean;
	};
	form: Record<string, unknown> | null;
	accentColor: string;
}

let { security, apiKeys, form, accentColor }: Props = $props();

let isSubmittingAuthMode = $state(false);
let isSubmittingPassword = $state(false);
let isSubmittingSession = $state(false);
let isSubmittingApiKey = $state(false);
let showCreateKeyDialog = $state(false);
let showRateLimitDialog = $state(false);
let editingKeyId = $state<number | null>(null);
let newKeyValue = $state<string | null>(null);
let copied = $state(false);
let selectedScope = $state<ApiKeyScope>('read');
let selectedRateLimitPreset = $state<ApiKeyRateLimitPreset>('unlimited');
let customRateLimit = $state<number>(60);
let editRateLimitPreset = $state<ApiKeyRateLimitPreset>('unlimited');
let editCustomRateLimit = $state<number>(60);

const selectClass =
	'flex h-9 w-full rounded-lg border border-glass-border/30 bg-glass/50 backdrop-blur-sm px-3 py-1 text-base transition-all placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 hover:bg-glass/70 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm';

$effect(() => {
	if (form?.action === 'apiKeysCreate' && form?.success && form?.plainKey) {
		newKeyValue = form.plainKey as string;
		showCreateKeyDialog = false;
		toastStore.success((form.message as string) ?? 'API key created successfully');
	}
});

$effect(() => {
	if (form?.action === 'apiKeysUpdateRateLimit' && form?.success) {
		closeRateLimitDialog();
		toastStore.success((form.message as string) ?? 'Rate limit updated successfully');
	}
});

function formatUserAgent(userAgent: string | null): string {
	if (!userAgent) return 'Unknown device';
	if (userAgent.includes('Chrome')) return 'Chrome Browser';
	if (userAgent.includes('Firefox')) return 'Firefox Browser';
	if (userAgent.includes('Safari')) return 'Safari Browser';
	if (userAgent.includes('Edge')) return 'Edge Browser';
	if (userAgent.includes('Mobile')) return 'Mobile Device';
	return 'Web Browser';
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

function formatDate(date: Date | null): string {
	if (!date) return 'Never';
	return new Date(date).toLocaleDateString();
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
</script>

<div class="space-y-6">
	{#if security.isLocalBypass}
		<div
			class="bg-amber-500/15 text-amber-600 dark:text-amber-400 rounded-md border border-amber-500/20 p-4"
			role="alert"
		>
			<div class="flex items-start gap-3">
				<AlertTriangleIcon class="h-5 w-5 mt-0.5 flex-shrink-0" />
				<div>
					<p class="font-medium">Local Network Bypass Active</p>
					<p class="text-sm mt-1">
						You are accessing Comradarr without authentication via local network bypass. Some
						security features are limited in this mode.
					</p>
				</div>
			</div>
		</div>
	{/if}

	<!-- Authentication Mode Card -->
	<Card.Root variant="glass" class="relative overflow-hidden">
		<div
			class="absolute top-0 left-0 right-0 h-px opacity-60"
			style="background: linear-gradient(to right, transparent, {accentColor}, transparent);"
		></div>
		<Card.Header>
			<Card.Title class="text-xl font-display flex items-center gap-2">
				<KeyIcon class="h-5 w-5" />
				Authentication Mode
			</Card.Title>
			<Card.Description>Control how users authenticate to access Comradarr.</Card.Description>
		</Card.Header>
		<Card.Content>
			<form
				method="POST"
				action="?/securityUpdateAuthMode"
				use:enhance={() => {
					isSubmittingAuthMode = true;
					return async ({ result, update }) => {
						await update();
						isSubmittingAuthMode = false;
						if (result.type === 'success' && result.data?.success) {
							toastStore.success(
								(result.data.message as string) || 'Authentication mode updated'
							);
						}
					};
				}}
			>
				<div class="grid gap-6">
					{#if form?.action === 'securityUpdateAuthMode' && form?.error}
						<div
							class="bg-destructive/15 text-destructive rounded-md border border-destructive/20 p-3 text-sm"
							role="alert"
						>
							{form.error}
						</div>
					{/if}

					<div class="grid gap-2">
						<Label for="authMode">Authentication Mode</Label>
						<select
							id="authMode"
							name="authMode"
							required
							disabled={isSubmittingAuthMode}
							class={selectClass}
						>
							{#each authModes as mode}
								<option value={mode} selected={security.settings.authMode === mode}>
									{authModeLabels[mode]}
								</option>
							{/each}
						</select>
						<p class="text-xs text-muted-foreground">
							{authModeDescriptions[security.settings.authMode]}
						</p>
					</div>

					{#if security.settings.authMode === 'local_bypass'}
						<div
							class="bg-amber-500/15 text-amber-600 dark:text-amber-400 rounded-md border border-amber-500/20 p-3 text-sm"
							role="alert"
						>
							<strong>Security Notice:</strong> Local network bypass allows anyone on your local network
							to access Comradarr without logging in. Only enable this if you trust all devices on your
							network.
						</div>
					{/if}

					<div class="flex gap-3">
						<Button type="submit" disabled={isSubmittingAuthMode}>
							{#if isSubmittingAuthMode}
								Saving...
							{:else}
								Save Authentication Mode
							{/if}
						</Button>
					</div>
				</div>
			</form>
		</Card.Content>
	</Card.Root>

	<!-- Change Password Card -->
	{#if !security.isLocalBypass}
		<Card.Root variant="glass" class="relative overflow-hidden">
			<div
				class="absolute top-0 left-0 right-0 h-px opacity-60"
				style="background: linear-gradient(to right, transparent, {accentColor}, transparent);"
			></div>
			<Card.Header>
				<Card.Title class="text-xl font-display">Change Password</Card.Title>
				<Card.Description>
					Update your account password. You will need to enter your current password to confirm.
				</Card.Description>
			</Card.Header>
			<Card.Content>
				<form
					method="POST"
					action="?/securityChangePassword"
					use:enhance={() => {
						isSubmittingPassword = true;
						return async ({ result, update }) => {
							await update();
							isSubmittingPassword = false;
							if (result.type === 'success' && result.data?.success) {
								toastStore.success(
									(result.data.message as string) || 'Password changed successfully'
								);
							}
						};
					}}
				>
					<div class="grid gap-6">
						{#if form?.action === 'securityChangePassword' && form?.error}
							<div
								class="bg-destructive/15 text-destructive rounded-md border border-destructive/20 p-3 text-sm"
								role="alert"
							>
								{form.error}
							</div>
						{/if}

						<div class="grid gap-2">
							<Label for="currentPassword">Current Password</Label>
							<Input
								id="currentPassword"
								name="currentPassword"
								type="password"
								required
								disabled={isSubmittingPassword}
								autocomplete="current-password"
							/>
						</div>

						<div class="grid gap-2">
							<Label for="newPassword">New Password</Label>
							<Input
								id="newPassword"
								name="newPassword"
								type="password"
								required
								minlength={8}
								disabled={isSubmittingPassword}
								autocomplete="new-password"
							/>
							<p class="text-xs text-muted-foreground">Must be at least 8 characters long.</p>
						</div>

						<div class="grid gap-2">
							<Label for="confirmPassword">Confirm New Password</Label>
							<Input
								id="confirmPassword"
								name="confirmPassword"
								type="password"
								required
								minlength={8}
								disabled={isSubmittingPassword}
								autocomplete="new-password"
							/>
						</div>

						<div class="flex gap-3">
							<Button type="submit" disabled={isSubmittingPassword}>
								{#if isSubmittingPassword}
									Changing...
								{:else}
									Change Password
								{/if}
							</Button>
						</div>
					</div>
				</form>
			</Card.Content>
		</Card.Root>
	{/if}

	<!-- Active Sessions Card -->
	<Card.Root variant="glass" class="relative overflow-hidden">
		<div
			class="absolute top-0 left-0 right-0 h-px opacity-60"
			style="background: linear-gradient(to right, transparent, {accentColor}, transparent);"
		></div>
		<Card.Header>
			<Card.Title class="text-xl font-display flex items-center gap-2">
				<MonitorSmartphoneIcon class="h-5 w-5" />
				Active Sessions
			</Card.Title>
			<Card.Description>Manage your active login sessions across devices.</Card.Description>
		</Card.Header>
		<Card.Content>
			<div class="grid gap-4">
				{#if (form?.action === 'securityRevokeSession' || form?.action === 'securityRevokeAllSessions') && form?.error}
					<div
						class="bg-destructive/15 text-destructive rounded-md border border-destructive/20 p-3 text-sm"
						role="alert"
					>
						{form.error}
					</div>
				{/if}

				{#if security.isLocalBypass}
					<p class="text-sm text-muted-foreground">
						Session management is not available in local network bypass mode.
					</p>
				{:else if security.sessions.length === 0}
					<p class="text-sm text-muted-foreground">No active sessions found.</p>
				{:else}
					<div class="space-y-3">
						{#each security.sessions as session}
							<div
								class="flex items-center justify-between p-3 rounded-xl border border-glass-border/20 bg-glass/30 backdrop-blur-sm hover:bg-glass/50 transition-all duration-200"
							>
								<div class="flex flex-col gap-1">
									<div class="flex items-center gap-2">
										<span class="font-medium text-sm">
											{formatUserAgent(session.userAgent)}
										</span>
										{#if session.isCurrent}
											<Badge variant="secondary" class="text-xs">Current</Badge>
										{/if}
									</div>
									<div class="flex items-center gap-3 text-xs text-muted-foreground">
										{#if session.ipAddress}
											<span>IP: {session.ipAddress}</span>
										{/if}
										<span>Last active: {formatRelativeTime(session.lastAccessedAt)}</span>
									</div>
								</div>

								{#if !session.isCurrent}
									<form
										method="POST"
										action="?/securityRevokeSession"
										use:enhance={() => {
											isSubmittingSession = true;
											return async ({ result, update }) => {
												await update();
												isSubmittingSession = false;
												if (result.type === 'success' && result.data?.success) {
													toastStore.success((result.data.message as string) || 'Session revoked');
												}
											};
										}}
									>
										<input type="hidden" name="sessionId" value={session.id} />
										<Button
											type="submit"
											variant="ghost"
											size="sm"
											disabled={isSubmittingSession}
											class="text-destructive hover:text-destructive hover:bg-destructive/10"
										>
											<Trash2Icon class="h-4 w-4" />
											<span class="sr-only">Revoke session</span>
										</Button>
									</form>
								{/if}
							</div>
						{/each}
					</div>

					{#if security.sessions.length > 1}
						<Separator class="my-2" />
						<form
							method="POST"
							action="?/securityRevokeAllSessions"
							use:enhance={() => {
								isSubmittingSession = true;
								return async ({ result, update }) => {
									await update();
									isSubmittingSession = false;
									if (result.type === 'success' && result.data?.success) {
										toastStore.success(
											(result.data.message as string) || 'All other sessions revoked'
										);
									}
								};
							}}
						>
							<Button type="submit" variant="outline" disabled={isSubmittingSession} class="w-full">
								{#if isSubmittingSession}
									Revoking...
								{:else}
									Revoke All Other Sessions
								{/if}
							</Button>
						</form>
					{/if}
				{/if}
			</div>
		</Card.Content>
	</Card.Root>

	<!-- API Keys Section -->
	<Separator class="my-6" />

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
	<Dialog.Root bind:open={showCreateKeyDialog}>
		<Dialog.Content>
			<Dialog.Header>
				<Dialog.Title>Create API Key</Dialog.Title>
				<Dialog.Description>
					Create a new API key for programmatic access to Comradarr.
				</Dialog.Description>
			</Dialog.Header>
			<form
				method="POST"
				action="?/apiKeysCreate"
				use:enhance={() => {
					isSubmittingApiKey = true;
					return async ({ update }) => {
						await update();
						isSubmittingApiKey = false;
						if (form?.action === 'apiKeysCreate' && form?.success) {
							showCreateKeyDialog = false;
						}
					};
				}}
			>
				<div class="space-y-4">
					{#if form?.action === 'apiKeysCreate' && form?.error}
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
							disabled={isSubmittingApiKey}
						/>
					</div>

					<div class="grid gap-2">
						<Label for="description">Description (optional)</Label>
						<Input
							id="description"
							name="description"
							placeholder="What is this key used for?"
							disabled={isSubmittingApiKey}
						/>
					</div>

					<div class="grid gap-2">
						<Label for="scope">Scope</Label>
						<select
							id="scope"
							name="scope"
							required
							disabled={isSubmittingApiKey}
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
						<select id="expiresIn" name="expiresIn" disabled={isSubmittingApiKey} class={selectClass}>
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
							disabled={isSubmittingApiKey}
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
									disabled={isSubmittingApiKey}
									class="w-24"
								/>
								<span class="text-sm text-muted-foreground">requests per minute</span>
							</div>
						{/if}
					</div>
				</div>

				<Dialog.Footer class="mt-6">
					<Button type="button" variant="outline" onclick={() => (showCreateKeyDialog = false)}>
						Cancel
					</Button>
					<Button type="submit" disabled={isSubmittingApiKey}>
						{isSubmittingApiKey ? 'Creating...' : 'Create Key'}
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
				action="?/apiKeysUpdateRateLimit"
				use:enhance={() => {
					isSubmittingApiKey = true;
					return async ({ update }) => {
						await update();
						isSubmittingApiKey = false;
					};
				}}
			>
				<input type="hidden" name="keyId" value={editingKeyId} />
				<div class="space-y-4">
					{#if form?.action === 'apiKeysUpdateRateLimit' && form?.error}
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
							disabled={isSubmittingApiKey}
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
									disabled={isSubmittingApiKey}
									class="w-24"
								/>
								<span class="text-sm text-muted-foreground">requests per minute</span>
							</div>
						{/if}
					</div>
				</div>

				<Dialog.Footer class="mt-6">
					<Button type="button" variant="outline" onclick={closeRateLimitDialog}>Cancel</Button>
					<Button type="submit" disabled={isSubmittingApiKey}>
						{isSubmittingApiKey ? 'Saving...' : 'Save'}
					</Button>
				</Dialog.Footer>
			</form>
		</Dialog.Content>
	</Dialog.Root>

	<!-- API Keys Card -->
	<Card.Root variant="glass" class="relative overflow-hidden">
		<div
			class="absolute top-0 left-0 right-0 h-px opacity-60"
			style="background: linear-gradient(to right, transparent, {accentColor}, transparent);"
		></div>
		<Card.Header>
			<div class="flex items-center justify-between">
				<div>
					<Card.Title class="text-xl font-display flex items-center gap-2">
						<KeyIcon class="h-5 w-5" />
						API Keys
					</Card.Title>
					<Card.Description>
						Use these keys to authenticate API requests with the Authorization header.
					</Card.Description>
				</div>
				{#if !apiKeys.isLocalBypass}
					<Button onclick={() => (showCreateKeyDialog = true)}>
						<PlusIcon class="h-4 w-4 mr-2" />
						Create Key
					</Button>
				{/if}
			</div>
		</Card.Header>
		<Card.Content>
			{#if apiKeys.isLocalBypass}
				<p class="text-sm text-muted-foreground text-center py-8">
					API key management is not available in local network bypass mode.
				</p>
			{:else if apiKeys.keys.length === 0}
				<p class="text-sm text-muted-foreground text-center py-8">
					No API keys yet. Create one to get started.
				</p>
			{:else}
				<div class="space-y-3">
					{#each apiKeys.keys as key}
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
										disabled={isSubmittingApiKey}
										class="text-muted-foreground hover:text-foreground"
										title="Edit rate limit"
										onclick={() => openRateLimitDialog(key.id, key.rateLimitPerMinute)}
									>
										<SettingsIcon class="h-4 w-4" />
										<span class="sr-only">Edit rate limit</span>
									</Button>
									<form
										method="POST"
										action="?/apiKeysRevoke"
										use:enhance={() => {
											isSubmittingApiKey = true;
											return async ({ result, update }) => {
												await update();
												isSubmittingApiKey = false;
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
											disabled={isSubmittingApiKey}
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
									action="?/apiKeysDelete"
									use:enhance={() => {
										isSubmittingApiKey = true;
										return async ({ result, update }) => {
											await update();
											isSubmittingApiKey = false;
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
										disabled={isSubmittingApiKey}
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

	<!-- API Key Usage Instructions -->
	{#if !apiKeys.isLocalBypass}
		<Card.Root variant="glass" class="relative overflow-hidden">
			<div
				class="absolute top-0 left-0 right-0 h-px opacity-60"
				style="background: linear-gradient(to right, transparent, {accentColor}, transparent);"
			></div>
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
