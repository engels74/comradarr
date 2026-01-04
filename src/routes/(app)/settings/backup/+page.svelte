<script lang="ts">
	/**
	 * Backup settings page.
	 */
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { toastStore } from '$lib/components/ui/toast';
	import type { PageProps } from './$types';
	import HardDriveDownloadIcon from '@lucide/svelte/icons/hard-drive-download';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import ClockIcon from '@lucide/svelte/icons/clock';

	let { data, form }: PageProps = $props();

	let isSubmitting = $state(false);
	let deletingBackupId = $state<string | null>(null);

	// Form state with initial values from loaded settings
	let scheduledEnabled = $state(untrack(() => data.settings.scheduledEnabled));

	// Update scheduledEnabled when form is submitted with errors (preserve user's choice)
	$effect(() => {
		if (form && 'scheduledEnabled' in form) {
			scheduledEnabled = form.scheduledEnabled as boolean;
		}
	});

	/**
	 * Get form value with fallback to loaded data.
	 */
	function getFormValue(formValue: string | undefined, settingsValue: string): string {
		return formValue ?? settingsValue;
	}

	/**
	 * Get numeric form value with fallback to loaded data.
	 */
	function getNumericFormValue(formValue: number | undefined, settingsValue: number): number {
		return formValue ?? settingsValue;
	}

	/**
	 * Format file size in human-readable format.
	 */
	function formatFileSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	/**
	 * Format date in human-readable format.
	 */
	function formatDate(isoString: string): string {
		const date = new Date(isoString);
		return date.toLocaleString();
	}

	/**
	 * Get relative time string.
	 */
	function getRelativeTime(isoString: string): string {
		const date = new Date(isoString);
		const now = new Date();
		const diffMs = date.getTime() - now.getTime();
		const diffMinutes = Math.round(diffMs / 60000);
		const diffHours = Math.round(diffMs / 3600000);
		const diffDays = Math.round(diffMs / 86400000);

		if (diffMs < 0) {
			// Past
			const absDiffMinutes = Math.abs(diffMinutes);
			const absDiffHours = Math.abs(diffHours);
			const absDiffDays = Math.abs(diffDays);

			if (absDiffMinutes < 60) return `${absDiffMinutes} minutes ago`;
			if (absDiffHours < 24) return `${absDiffHours} hours ago`;
			return `${absDiffDays} days ago`;
		} else {
			// Future
			if (diffMinutes < 60) return `in ${diffMinutes} minutes`;
			if (diffHours < 24) return `in ${diffHours} hours`;
			return `in ${diffDays} days`;
		}
	}
</script>

<svelte:head>
	<title>Backup Settings - Comradarr</title>
</svelte:head>

<div class="container mx-auto p-6 max-w-4xl">
	<!-- Page Header -->
	<div class="mb-6">
		<div class="flex items-center gap-3">
			<HardDriveDownloadIcon class="h-8 w-8 text-muted-foreground" />
			<div>
				<h1 class="text-3xl font-bold">Backup Settings</h1>
				<p class="text-muted-foreground mt-1">Configure automatic database backups</p>
			</div>
		</div>
	</div>

	<!-- Scheduled Backup Settings -->
	<Card.Root class="mb-6">
		<Card.Header>
			<Card.Title class="text-xl">Scheduled Backups</Card.Title>
			<Card.Description>Configure automatic backups to run at regular intervals.</Card.Description>
		</Card.Header>
		<Card.Content>
			<form
				method="POST"
				action="?/update"
				use:enhance={() => {
					isSubmitting = true;
					return async ({ result, update }) => {
						await update();
						isSubmitting = false;
						if (result.type === 'success' && result.data?.success) {
							toastStore.success(
								(result.data.message as string) || 'Backup settings saved successfully'
							);
						}
					};
				}}
			>
				<div class="grid gap-6">
					<!-- Error Message -->
					{#if form?.error}
						<div
							class="bg-destructive/15 text-destructive rounded-md border border-destructive/20 p-3 text-sm"
							role="alert"
						>
							{form.error}
						</div>
					{/if}

					<!-- Enable Scheduled Backups -->
					<div class="grid gap-2">
						<div class="flex items-center space-x-3">
							<Checkbox
								id="scheduledEnabled"
								name="scheduledEnabled"
								bind:checked={scheduledEnabled}
								disabled={isSubmitting}
							/>
							<Label for="scheduledEnabled" class="text-sm font-medium cursor-pointer">
								Enable scheduled backups
							</Label>
						</div>
						<p class="text-xs text-muted-foreground ml-7">
							When enabled, backups will be created automatically at the specified interval.
						</p>
					</div>

					<!-- Next Backup Time -->
					{#if data.nextBackupRun && scheduledEnabled}
						<div class="flex items-center gap-2 p-3 bg-muted/50 rounded-md">
							<ClockIcon class="h-4 w-4 text-muted-foreground" />
							<span class="text-sm">
								Next backup: <strong>{formatDate(data.nextBackupRun)}</strong>
								<span class="text-muted-foreground">({getRelativeTime(data.nextBackupRun)})</span>
							</span>
						</div>
					{/if}

					<!-- Cron Expression -->
					<div class="grid gap-2">
						<Label for="scheduledCron">Backup Schedule (Cron Expression)</Label>
						<Input
							id="scheduledCron"
							name="scheduledCron"
							type="text"
							placeholder="0 2 * * *"
							required
							disabled={isSubmitting || !scheduledEnabled}
							value={getFormValue(form?.scheduledCron?.toString(), data.settings.scheduledCron)}
						/>
						<p class="text-xs text-muted-foreground">
							Cron expression for when to run backups. Default: <code>0 2 * * *</code> (daily at 2 AM).
							Format: minute hour day-of-month month day-of-week.
						</p>
					</div>

					<!-- Retention Count -->
					<div class="grid gap-2">
						<Label for="retentionCount">Retention Count</Label>
						<Input
							id="retentionCount"
							name="retentionCount"
							type="number"
							min="1"
							max="100"
							required
							disabled={isSubmitting || !scheduledEnabled}
							value={getNumericFormValue(form?.retentionCount, data.settings.retentionCount)}
						/>
						<p class="text-xs text-muted-foreground">
							Number of scheduled backups to keep. Older scheduled backups will be automatically
							deleted. Manual backups are not affected by this setting.
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

	<!-- Existing Backups -->
	<Card.Root>
		<Card.Header>
			<Card.Title class="text-xl">Existing Backups</Card.Title>
			<Card.Description>
				View and manage your database backups. Manual backups can be created from the System page.
			</Card.Description>
		</Card.Header>
		<Card.Content>
			<!-- Delete Error Message -->
			{#if form?.deleteError}
				<div
					class="bg-destructive/15 text-destructive rounded-md border border-destructive/20 p-3 text-sm mb-4"
					role="alert"
				>
					{form.deleteError}
				</div>
			{/if}

			{#if data.backups.length === 0}
				<div class="text-center py-8 text-muted-foreground">
					<CalendarIcon class="h-12 w-12 mx-auto mb-4 opacity-50" />
					<p>No backups found</p>
					<p class="text-sm mt-1">Backups will appear here once created.</p>
				</div>
			{:else}
				<div class="space-y-3">
					{#each data.backups as backup}
						<div
							class="flex items-center justify-between p-4 border rounded-lg bg-card hover:bg-muted/50 transition-colors"
						>
							<div class="flex-1">
								<div class="flex items-center gap-2">
									<span class="font-medium">
										{backup.description ?? 'Backup'}
									</span>
									<span
										class="text-xs px-2 py-0.5 rounded-full {backup.type === 'scheduled'
											? 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
											: 'bg-gray-500/15 text-gray-600 dark:text-gray-400'}"
									>
										{backup.type}
									</span>
								</div>
								<div class="text-sm text-muted-foreground mt-1">
									<span>{formatDate(backup.createdAt)}</span>
									<span class="mx-2">•</span>
									<span>{formatFileSize(backup.fileSizeBytes)}</span>
									<span class="mx-2">•</span>
									<span>{backup.tableCount} tables</span>
								</div>
							</div>
							<form
								method="POST"
								action="?/delete"
								use:enhance={() => {
									deletingBackupId = backup.id;
									return async ({ result, update }) => {
										await update();
										deletingBackupId = null;
										if (result.type === 'success' && result.data?.deleteSuccess) {
											toastStore.success((result.data.deleteMessage as string) || 'Backup deleted');
										}
									};
								}}
							>
								<input type="hidden" name="backupId" value={backup.id} />
								<Button
									type="submit"
									variant="ghost"
									size="sm"
									class="text-destructive hover:text-destructive hover:bg-destructive/10"
									disabled={deletingBackupId === backup.id}
								>
									{#if deletingBackupId === backup.id}
										Deleting...
									{:else}
										<TrashIcon class="h-4 w-4" />
									{/if}
								</Button>
							</form>
						</div>
					{/each}
				</div>
			{/if}
		</Card.Content>
	</Card.Root>
</div>
