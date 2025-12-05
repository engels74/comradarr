<script lang="ts">
	/**
	 * Security settings page.
	 *
	 * Requirements: 21.5, 10.3
	 */
	import { enhance } from '$app/forms';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import { Badge } from '$lib/components/ui/badge';
	import { Separator } from '$lib/components/ui/separator';
	import { authModes, authModeLabels, authModeDescriptions } from '$lib/schemas/settings';
	import type { PageProps } from './$types';
	import ShieldIcon from '@lucide/svelte/icons/shield';
	import KeyIcon from '@lucide/svelte/icons/key';
	import MonitorSmartphoneIcon from '@lucide/svelte/icons/monitor-smartphone';
	import AlertTriangleIcon from '@lucide/svelte/icons/alert-triangle';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';

	let { data, form }: PageProps = $props();

	let isSubmittingAuthMode = $state(false);
	let isSubmittingPassword = $state(false);
	let isSubmittingSession = $state(false);

	// Common select styling
	const selectClass =
		'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm';

	/**
	 * Format user agent to display friendly device/browser name.
	 */
	function formatUserAgent(userAgent: string | null): string {
		if (!userAgent) return 'Unknown device';

		// Simple parsing - could be enhanced with a proper UA parser
		if (userAgent.includes('Chrome')) return 'Chrome Browser';
		if (userAgent.includes('Firefox')) return 'Firefox Browser';
		if (userAgent.includes('Safari')) return 'Safari Browser';
		if (userAgent.includes('Edge')) return 'Edge Browser';
		if (userAgent.includes('Mobile')) return 'Mobile Device';

		return 'Web Browser';
	}

	/**
	 * Format relative time for session display.
	 */
	function formatRelativeTime(date: Date): string {
		const now = new Date();
		const diff = now.getTime() - new Date(date).getTime();
		const minutes = Math.floor(diff / 60000);
		const hours = Math.floor(minutes / 60);
		const days = Math.floor(hours / 24);

		if (minutes < 1) return 'Just now';
		if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
		if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
		return `${days} day${days === 1 ? '' : 's'} ago`;
	}
</script>

<svelte:head>
	<title>Security Settings - Comradarr</title>
</svelte:head>

<div class="container mx-auto p-6 max-w-2xl">
	<!-- Page Header -->
	<div class="mb-6">
		<div class="flex items-center gap-3">
			<ShieldIcon class="h-8 w-8 text-muted-foreground" />
			<div>
				<h1 class="text-3xl font-bold">Security Settings</h1>
				<p class="text-muted-foreground mt-1">Manage authentication, passwords, and sessions</p>
			</div>
		</div>
	</div>

	<div class="grid gap-6">
		<!-- Local Bypass Warning -->
		{#if data.isLocalBypass}
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
		<Card.Root>
			<Card.Header>
				<Card.Title class="text-xl flex items-center gap-2">
					<KeyIcon class="h-5 w-5" />
					Authentication Mode
				</Card.Title>
				<Card.Description>
					Control how users authenticate to access Comradarr.
				</Card.Description>
			</Card.Header>
			<Card.Content>
				<form
					method="POST"
					action="?/updateAuthMode"
					use:enhance={() => {
						isSubmittingAuthMode = true;
						return async ({ update }) => {
							await update();
							isSubmittingAuthMode = false;
						};
					}}
				>
					<div class="grid gap-6">
						<!-- Success/Error Messages -->
						{#if form?.action === 'updateAuthMode' && form?.success}
							<div
								class="bg-green-500/15 text-green-600 dark:text-green-400 rounded-md border border-green-500/20 p-3 text-sm"
								role="status"
							>
								{form.message}
							</div>
						{/if}

						{#if form?.action === 'updateAuthMode' && form?.error}
							<div
								class="bg-destructive/15 text-destructive rounded-md border border-destructive/20 p-3 text-sm"
								role="alert"
							>
								{form.error}
							</div>
						{/if}

						<!-- Auth Mode Selection -->
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
									<option
										value={mode}
										selected={data.securitySettings.authMode === mode}
									>
										{authModeLabels[mode]}
									</option>
								{/each}
							</select>
							<p class="text-xs text-muted-foreground">
								{authModeDescriptions[data.securitySettings.authMode]}
							</p>
						</div>

						<!-- Local Bypass Warning -->
						{#if data.securitySettings.authMode === 'local_bypass'}
							<div
								class="bg-amber-500/15 text-amber-600 dark:text-amber-400 rounded-md border border-amber-500/20 p-3 text-sm"
								role="alert"
							>
								<strong>Security Notice:</strong> Local network bypass allows anyone on your local network
								to access Comradarr without logging in. Only enable this if you trust all devices on your network.
							</div>
						{/if}

						<!-- Submit -->
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

		<!-- Change Password Card (hidden for bypass users) -->
		{#if !data.isLocalBypass}
			<Card.Root>
				<Card.Header>
					<Card.Title class="text-xl">Change Password</Card.Title>
					<Card.Description>
						Update your account password. You will need to enter your current password to confirm.
					</Card.Description>
				</Card.Header>
				<Card.Content>
					<form
						method="POST"
						action="?/changePassword"
						use:enhance={() => {
							isSubmittingPassword = true;
							return async ({ update }) => {
								await update();
								isSubmittingPassword = false;
							};
						}}
					>
						<div class="grid gap-6">
							<!-- Success/Error Messages -->
							{#if form?.action === 'changePassword' && form?.success}
								<div
									class="bg-green-500/15 text-green-600 dark:text-green-400 rounded-md border border-green-500/20 p-3 text-sm"
									role="status"
								>
									{form.message}
								</div>
							{/if}

							{#if form?.action === 'changePassword' && form?.error}
								<div
									class="bg-destructive/15 text-destructive rounded-md border border-destructive/20 p-3 text-sm"
									role="alert"
								>
									{form.error}
								</div>
							{/if}

							<!-- Current Password -->
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

							<!-- New Password -->
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
								<p class="text-xs text-muted-foreground">
									Must be at least 8 characters long.
								</p>
							</div>

							<!-- Confirm Password -->
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

							<!-- Submit -->
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

		<!-- Session Management Card -->
		<Card.Root>
			<Card.Header>
				<Card.Title class="text-xl flex items-center gap-2">
					<MonitorSmartphoneIcon class="h-5 w-5" />
					Active Sessions
				</Card.Title>
				<Card.Description>
					Manage your active login sessions across devices.
				</Card.Description>
			</Card.Header>
			<Card.Content>
				<div class="grid gap-4">
					<!-- Success/Error Messages -->
					{#if (form?.action === 'revokeSession' || form?.action === 'revokeAllSessions') && form?.success}
						<div
							class="bg-green-500/15 text-green-600 dark:text-green-400 rounded-md border border-green-500/20 p-3 text-sm"
							role="status"
						>
							{form.message}
						</div>
					{/if}

					{#if (form?.action === 'revokeSession' || form?.action === 'revokeAllSessions') && form?.error}
						<div
							class="bg-destructive/15 text-destructive rounded-md border border-destructive/20 p-3 text-sm"
							role="alert"
						>
							{form.error}
						</div>
					{/if}

					{#if data.isLocalBypass}
						<p class="text-sm text-muted-foreground">
							Session management is not available in local network bypass mode.
						</p>
					{:else if data.sessions.length === 0}
						<p class="text-sm text-muted-foreground">No active sessions found.</p>
					{:else}
						<!-- Sessions List -->
						<div class="space-y-3">
							{#each data.sessions as session}
								<div
									class="flex items-center justify-between p-3 rounded-lg border bg-card"
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
											action="?/revokeSession"
											use:enhance={() => {
												isSubmittingSession = true;
												return async ({ update }) => {
													await update();
													isSubmittingSession = false;
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

						<!-- Revoke All Button -->
						{#if data.sessions.length > 1}
							<Separator class="my-2" />
							<form
								method="POST"
								action="?/revokeAllSessions"
								use:enhance={() => {
									isSubmittingSession = true;
									return async ({ update }) => {
										await update();
										isSubmittingSession = false;
									};
								}}
							>
								<Button
									type="submit"
									variant="outline"
									disabled={isSubmittingSession}
									class="w-full"
								>
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
	</div>
</div>
