<script lang="ts">
import CalendarIcon from '@lucide/svelte/icons/calendar';
import ClockIcon from '@lucide/svelte/icons/clock';
import GaugeIcon from '@lucide/svelte/icons/gauge';
import PencilIcon from '@lucide/svelte/icons/pencil';
import PlusIcon from '@lucide/svelte/icons/plus';
import RocketIcon from '@lucide/svelte/icons/rocket';
import ShieldIcon from '@lucide/svelte/icons/shield';
import StarIcon from '@lucide/svelte/icons/star';
import Trash2Icon from '@lucide/svelte/icons/trash-2';
import TrashIcon from '@lucide/svelte/icons/trash-2';
import WrenchIcon from '@lucide/svelte/icons/wrench';
import ZapIcon from '@lucide/svelte/icons/zap';
import { untrack } from 'svelte';
import { enhance } from '$app/forms';
import { Badge } from '$lib/components/ui/badge';
import { Button } from '$lib/components/ui/button';
import * as Card from '$lib/components/ui/card';
import { Checkbox } from '$lib/components/ui/checkbox';
import * as Dialog from '$lib/components/ui/dialog';
import { Input } from '$lib/components/ui/input';
import { Label } from '$lib/components/ui/label';
import { Separator } from '$lib/components/ui/separator';
import { toastStore } from '$lib/components/ui/toast';
import {
	AGGRESSIVE_PRESET,
	CONSERVATIVE_PRESET,
	MODERATE_PRESET
} from '$lib/config/throttle-presets';
import { throttleProfileDescriptions, throttleProfileLabels } from '$lib/schemas/throttle-profile';
import type { BackupSettings, MaintenanceSettings } from '$lib/server/db/queries/settings';
import type { ProfileWithUsage } from '../+page.server';

interface BackupInfo {
	id: string;
	createdAt: string;
	description: string | null | undefined;
	type: string;
	tableCount: number;
	fileSizeBytes: number;
	schemaVersion: {
		appVersion: string;
		lastMigration: string;
		migrationIndex: number;
	};
}

interface Props {
	throttle: { profiles: ProfileWithUsage[] };
	backup: { settings: BackupSettings; backups: BackupInfo[]; nextBackupRun: string | null };
	maintenance: MaintenanceSettings;
	form: Record<string, unknown> | null;
	accentColor: string;
}

let { throttle, backup, maintenance, form, accentColor }: Props = $props();

// Throttle state
let isSubmitting = $state(false);
let createDialogOpen = $state(false);
let editDialogOpen = $state(false);
let deleteDialogOpen = $state(false);
let editingProfile = $state<ProfileWithUsage | null>(null);
let deletingProfile = $state<ProfileWithUsage | null>(null);
let createIsDefault = $state(false);
let editIsDefault = $state(false);

// Backup state
let deletingBackupId = $state<string | null>(null);
let scheduledEnabled = $state(untrack(() => backup.settings.scheduledEnabled));

// Maintenance state
let logPersistenceEnabled = $state(untrack(() => maintenance.logPersistenceEnabled));

const inputClass = 'w-full';

$effect(() => {
	if (form?.success) {
		createDialogOpen = false;
		editDialogOpen = false;
		deleteDialogOpen = false;
		editingProfile = null;
		deletingProfile = null;
		createIsDefault = false;
		if (form.message) {
			toastStore.success(form.message as string);
		}
	}
});

$effect(() => {
	if (editingProfile) {
		editIsDefault = editingProfile.isDefault;
	}
});

$effect(() => {
	if (form && form.action === 'backupUpdate' && 'scheduledEnabled' in form) {
		scheduledEnabled = form.scheduledEnabled as boolean;
	}
});

$effect(() => {
	if (form && form.action === 'maintenanceUpdate' && form.values) {
		const values = form.values as { logPersistenceEnabled: boolean };
		logPersistenceEnabled = values.logPersistenceEnabled;
	}
});

function formatDailyBudget(budget: number | null): string {
	return budget === null ? 'Unlimited' : budget.toLocaleString();
}

function formatSeconds(seconds: number): string {
	if (seconds >= 60) {
		const minutes = Math.floor(seconds / 60);
		const remaining = seconds % 60;
		if (remaining === 0) {
			return `${minutes}m`;
		}
		return `${minutes}m ${remaining}s`;
	}
	return `${seconds}s`;
}

function formatFileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(isoString: string): string {
	const date = new Date(isoString);
	return date.toLocaleString();
}

function getRelativeTime(isoString: string): string {
	const date = new Date(isoString);
	const now = new Date();
	const diffMs = date.getTime() - now.getTime();
	const diffMinutes = Math.round(diffMs / 60000);
	const diffHours = Math.round(diffMs / 3600000);
	const diffDays = Math.round(diffMs / 86400000);

	if (diffMs < 0) {
		const absDiffMinutes = Math.abs(diffMinutes);
		const absDiffHours = Math.abs(diffHours);
		const absDiffDays = Math.abs(diffDays);

		if (absDiffMinutes < 60) return `${absDiffMinutes} minutes ago`;
		if (absDiffHours < 24) return `${absDiffHours} hours ago`;
		return `${absDiffDays} days ago`;
	} else {
		if (diffMinutes < 60) return `in ${diffMinutes} minutes`;
		if (diffHours < 24) return `in ${diffHours} hours`;
		return `in ${diffDays} days`;
	}
}

function openEditDialog(profile: ProfileWithUsage) {
	editingProfile = profile;
	editDialogOpen = true;
}

function openDeleteDialog(profile: ProfileWithUsage) {
	deletingProfile = profile;
	deleteDialogOpen = true;
}

function getFormValue(formValue: string | undefined, settingsValue: string): string {
	return formValue ?? settingsValue;
}

function getNumericFormValue(formValue: number | undefined, settingsValue: number): number {
	return formValue ?? settingsValue;
}
</script>

<div class="space-y-6">
	<!-- Throttle Profiles Section -->
	<Card.Root variant="glass" class="relative overflow-hidden">
		<div
			class="absolute top-0 left-0 right-0 h-px opacity-60"
			style="background: linear-gradient(to right, transparent, {accentColor}, transparent);"
		></div>
		<Card.Header>
			<Card.Title class="text-xl font-display flex items-center gap-2">
				<GaugeIcon class="h-5 w-5" />
				Preset Profiles
			</Card.Title>
			<Card.Description>
				Reference presets for common use cases. These are read-only templates.
			</Card.Description>
		</Card.Header>
		<Card.Content>
			<div class="grid gap-4 md:grid-cols-3">
				<div class="rounded-xl border border-glass-border/30 p-4 bg-glass/30 backdrop-blur-sm">
					<div class="flex items-center gap-2 mb-3">
						<ShieldIcon class="h-5 w-5 text-blue-500" />
						<span class="font-semibold">{CONSERVATIVE_PRESET.name}</span>
					</div>
					<p class="text-xs text-muted-foreground mb-3">{CONSERVATIVE_PRESET.description}</p>
					<div class="space-y-1 text-sm">
						<div class="flex justify-between">
							<span class="text-muted-foreground">Requests/min:</span>
							<span class="font-medium">{CONSERVATIVE_PRESET.requestsPerMinute}</span>
						</div>
						<div class="flex justify-between">
							<span class="text-muted-foreground">Daily budget:</span>
							<span class="font-medium">{formatDailyBudget(CONSERVATIVE_PRESET.dailyBudget)}</span>
						</div>
						<div class="flex justify-between">
							<span class="text-muted-foreground">Batch size:</span>
							<span class="font-medium">{CONSERVATIVE_PRESET.batchSize}</span>
						</div>
						<div class="flex justify-between">
							<span class="text-muted-foreground">Cooldown:</span>
							<span class="font-medium">{formatSeconds(CONSERVATIVE_PRESET.batchCooldownSeconds)}</span
							>
						</div>
					</div>
				</div>

				<div class="rounded-xl border border-glass-border/30 p-4 bg-glass/30 backdrop-blur-sm">
					<div class="flex items-center gap-2 mb-3">
						<ZapIcon class="h-5 w-5 text-yellow-500" />
						<span class="font-semibold">{MODERATE_PRESET.name}</span>
						<Badge variant="secondary" class="text-xs">Default Fallback</Badge>
					</div>
					<p class="text-xs text-muted-foreground mb-3">{MODERATE_PRESET.description}</p>
					<div class="space-y-1 text-sm">
						<div class="flex justify-between">
							<span class="text-muted-foreground">Requests/min:</span>
							<span class="font-medium">{MODERATE_PRESET.requestsPerMinute}</span>
						</div>
						<div class="flex justify-between">
							<span class="text-muted-foreground">Daily budget:</span>
							<span class="font-medium">{formatDailyBudget(MODERATE_PRESET.dailyBudget)}</span>
						</div>
						<div class="flex justify-between">
							<span class="text-muted-foreground">Batch size:</span>
							<span class="font-medium">{MODERATE_PRESET.batchSize}</span>
						</div>
						<div class="flex justify-between">
							<span class="text-muted-foreground">Cooldown:</span>
							<span class="font-medium">{formatSeconds(MODERATE_PRESET.batchCooldownSeconds)}</span>
						</div>
					</div>
				</div>

				<div class="rounded-xl border border-glass-border/30 p-4 bg-glass/30 backdrop-blur-sm">
					<div class="flex items-center gap-2 mb-3">
						<RocketIcon class="h-5 w-5 text-red-500" />
						<span class="font-semibold">{AGGRESSIVE_PRESET.name}</span>
					</div>
					<p class="text-xs text-muted-foreground mb-3">{AGGRESSIVE_PRESET.description}</p>
					<div class="space-y-1 text-sm">
						<div class="flex justify-between">
							<span class="text-muted-foreground">Requests/min:</span>
							<span class="font-medium">{AGGRESSIVE_PRESET.requestsPerMinute}</span>
						</div>
						<div class="flex justify-between">
							<span class="text-muted-foreground">Daily budget:</span>
							<span class="font-medium">{formatDailyBudget(AGGRESSIVE_PRESET.dailyBudget)}</span>
						</div>
						<div class="flex justify-between">
							<span class="text-muted-foreground">Batch size:</span>
							<span class="font-medium">{AGGRESSIVE_PRESET.batchSize}</span>
						</div>
						<div class="flex justify-between">
							<span class="text-muted-foreground">Cooldown:</span>
							<span class="font-medium">{formatSeconds(AGGRESSIVE_PRESET.batchCooldownSeconds)}</span
							>
						</div>
					</div>
				</div>
			</div>
		</Card.Content>
	</Card.Root>

	<!-- Custom Throttle Profiles -->
	<Card.Root variant="glass" class="relative overflow-hidden">
		<div
			class="absolute top-0 left-0 right-0 h-px opacity-60"
			style="background: linear-gradient(to right, transparent, {accentColor}, transparent);"
		></div>
		<Card.Header>
			<div class="flex items-center justify-between">
				<div>
					<Card.Title class="text-xl font-display">Custom Profiles</Card.Title>
					<Card.Description>
						Create and manage your own throttle profiles with custom rate limits.
					</Card.Description>
				</div>
				<Dialog.Root bind:open={createDialogOpen}>
					<Dialog.Trigger>
						<Button>
							<PlusIcon class="h-4 w-4 mr-2" />
							Create Profile
						</Button>
					</Dialog.Trigger>
					<Dialog.Content class="max-w-lg">
						<Dialog.Header>
							<Dialog.Title>Create Throttle Profile</Dialog.Title>
							<Dialog.Description>
								Create a new custom throttle profile with your own rate limits.
							</Dialog.Description>
						</Dialog.Header>
						<form
							method="POST"
							action="?/throttleCreate"
							use:enhance={() => {
								isSubmitting = true;
								return async ({ update }) => {
									await update();
									isSubmitting = false;
								};
							}}
						>
							<div class="grid gap-4 py-4">
								{#if form?.action === 'throttleCreate' && form?.error}
									<div
										class="bg-destructive/15 text-destructive rounded-md border border-destructive/20 p-3 text-sm"
										role="alert"
									>
										{form.error}
									</div>
								{/if}

								<div class="grid gap-2">
									<Label for="create-name">{throttleProfileLabels.name}</Label>
									<Input
										id="create-name"
										name="name"
										type="text"
										placeholder="My Custom Profile"
										required
										disabled={isSubmitting}
										class={inputClass}
									/>
									<p class="text-xs text-muted-foreground">{throttleProfileDescriptions.name}</p>
								</div>

								<div class="grid gap-2">
									<Label for="create-description">{throttleProfileLabels.description}</Label>
									<Input
										id="create-description"
										name="description"
										type="text"
										placeholder="Optional description"
										disabled={isSubmitting}
										class={inputClass}
									/>
									<p class="text-xs text-muted-foreground">
										{throttleProfileDescriptions.description}
									</p>
								</div>

								<Separator />

								<div class="grid gap-4 sm:grid-cols-2">
									<div class="grid gap-2">
										<Label for="create-requestsPerMinute"
											>{throttleProfileLabels.requestsPerMinute}</Label
										>
										<Input
											id="create-requestsPerMinute"
											name="requestsPerMinute"
											type="number"
											min="1"
											max="60"
											value="5"
											required
											disabled={isSubmitting}
											class={inputClass}
										/>
									</div>

									<div class="grid gap-2">
										<Label for="create-dailyBudget">{throttleProfileLabels.dailyBudget}</Label>
										<Input
											id="create-dailyBudget"
											name="dailyBudget"
											type="number"
											min="10"
											max="10000"
											placeholder="Empty = unlimited"
											disabled={isSubmitting}
											class={inputClass}
										/>
									</div>
								</div>

								<div class="grid gap-4 sm:grid-cols-2">
									<div class="grid gap-2">
										<Label for="create-batchSize">{throttleProfileLabels.batchSize}</Label>
										<Input
											id="create-batchSize"
											name="batchSize"
											type="number"
											min="1"
											max="50"
											value="10"
											required
											disabled={isSubmitting}
											class={inputClass}
										/>
									</div>

									<div class="grid gap-2">
										<Label for="create-batchCooldownSeconds"
											>{throttleProfileLabels.batchCooldownSeconds}</Label
										>
										<Input
											id="create-batchCooldownSeconds"
											name="batchCooldownSeconds"
											type="number"
											min="10"
											max="3600"
											value="60"
											required
											disabled={isSubmitting}
											class={inputClass}
										/>
									</div>
								</div>

								<div class="grid gap-2">
									<Label for="create-rateLimitPauseSeconds"
										>{throttleProfileLabels.rateLimitPauseSeconds}</Label
									>
									<Input
										id="create-rateLimitPauseSeconds"
										name="rateLimitPauseSeconds"
										type="number"
										min="60"
										max="3600"
										value="300"
										required
										disabled={isSubmitting}
										class={inputClass}
									/>
									<p class="text-xs text-muted-foreground">
										{throttleProfileDescriptions.rateLimitPauseSeconds}
									</p>
								</div>

								<Separator />

								<div class="flex items-center space-x-3">
									<Checkbox
										id="create-isDefault"
										name="isDefault"
										bind:checked={createIsDefault}
										disabled={isSubmitting}
									/>
									<Label for="create-isDefault" class="text-sm font-medium cursor-pointer">
										{throttleProfileLabels.isDefault}
									</Label>
								</div>
								<p class="text-xs text-muted-foreground -mt-2">
									{throttleProfileDescriptions.isDefault}
								</p>
							</div>
							<Dialog.Footer>
								<Dialog.Close>
									<Button variant="outline" type="button" disabled={isSubmitting}>Cancel</Button>
								</Dialog.Close>
								<Button type="submit" disabled={isSubmitting}>
									{#if isSubmitting}
										Creating...
									{:else}
										Create Profile
									{/if}
								</Button>
							</Dialog.Footer>
						</form>
					</Dialog.Content>
				</Dialog.Root>
			</div>
		</Card.Header>
		<Card.Content>
			{#if throttle.profiles.length === 0}
				<div class="glass-panel p-8 text-center">
					<div class="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-muted/50 mb-4">
						<GaugeIcon class="h-6 w-6 text-muted-foreground opacity-50" />
					</div>
					<h3 class="text-lg font-display font-medium mb-2">No custom profiles</h3>
					<p class="text-muted-foreground mb-4">
						Create a custom throttle profile to fine-tune rate limiting for your needs.
					</p>
					<Button onclick={() => (createDialogOpen = true)}>
						<PlusIcon class="h-4 w-4 mr-2" />
						Create Profile
					</Button>
				</div>
			{:else}
				<div class="space-y-4">
					{#each throttle.profiles as profile (profile.id)}
						<div
							class="flex items-center justify-between p-4 rounded-xl border border-glass-border/20 bg-glass/30 backdrop-blur-sm hover:bg-glass/50 transition-all duration-200"
						>
							<div class="flex-1 min-w-0">
								<div class="flex items-center gap-2 mb-1">
									<span class="font-semibold">{profile.name}</span>
									{#if profile.isDefault}
										<Badge variant="default" class="text-xs">
											<StarIcon class="h-3 w-3 mr-1" />
											Default
										</Badge>
									{/if}
									{#if profile.connectorCount > 0}
										<Badge variant="outline" class="text-xs">
											{profile.connectorCount} connector{profile.connectorCount !== 1 ? 's' : ''}
										</Badge>
									{/if}
								</div>
								{#if profile.description}
									<p class="text-sm text-muted-foreground mb-2 truncate">{profile.description}</p>
								{/if}
								<div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
									<span>{profile.requestsPerMinute} req/min</span>
									<span>{formatDailyBudget(profile.dailyBudget)}/day</span>
									<span>batch: {profile.batchSize}</span>
									<span>cooldown: {formatSeconds(profile.batchCooldownSeconds)}</span>
								</div>
							</div>
							<div class="flex items-center gap-2 ml-4">
								{#if !profile.isDefault}
									<form
										method="POST"
										action="?/throttleSetDefault"
										use:enhance={() => {
											return async ({ update }) => {
												await update();
											};
										}}
									>
										<input type="hidden" name="id" value={profile.id} />
										<Button variant="ghost" size="sm" type="submit" title="Set as default">
											<StarIcon class="h-4 w-4" />
										</Button>
									</form>
								{/if}
								<Button variant="ghost" size="sm" onclick={() => openEditDialog(profile)}>
									<PencilIcon class="h-4 w-4" />
								</Button>
								<Button
									variant="ghost"
									size="sm"
									onclick={() => openDeleteDialog(profile)}
									disabled={profile.connectorCount > 0}
									title={profile.connectorCount > 0
										? 'Cannot delete: profile is in use'
										: 'Delete profile'}
								>
									<Trash2Icon class="h-4 w-4" />
								</Button>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</Card.Content>
	</Card.Root>

	<!-- Edit Dialog -->
	<Dialog.Root bind:open={editDialogOpen}>
		<Dialog.Content class="max-w-lg">
			<Dialog.Header>
				<Dialog.Title>Edit Throttle Profile</Dialog.Title>
				<Dialog.Description>Update the settings for this throttle profile.</Dialog.Description>
			</Dialog.Header>
			{#if editingProfile}
				<form
					method="POST"
					action="?/throttleUpdate"
					use:enhance={() => {
						isSubmitting = true;
						return async ({ update }) => {
							await update();
							isSubmitting = false;
						};
					}}
				>
					<input type="hidden" name="id" value={editingProfile.id} />
					<div class="grid gap-4 py-4">
						{#if form?.action === 'throttleUpdate' && form?.error}
							<div
								class="bg-destructive/15 text-destructive rounded-md border border-destructive/20 p-3 text-sm"
								role="alert"
							>
								{form.error}
							</div>
						{/if}

						<div class="grid gap-2">
							<Label for="edit-name">{throttleProfileLabels.name}</Label>
							<Input
								id="edit-name"
								name="name"
								type="text"
								value={editingProfile.name}
								required
								disabled={isSubmitting}
								class={inputClass}
							/>
						</div>

						<div class="grid gap-2">
							<Label for="edit-description">{throttleProfileLabels.description}</Label>
							<Input
								id="edit-description"
								name="description"
								type="text"
								value={editingProfile.description ?? ''}
								disabled={isSubmitting}
								class={inputClass}
							/>
						</div>

						<Separator />

						<div class="grid gap-4 sm:grid-cols-2">
							<div class="grid gap-2">
								<Label for="edit-requestsPerMinute">{throttleProfileLabels.requestsPerMinute}</Label>
								<Input
									id="edit-requestsPerMinute"
									name="requestsPerMinute"
									type="number"
									min="1"
									max="60"
									value={editingProfile.requestsPerMinute}
									required
									disabled={isSubmitting}
									class={inputClass}
								/>
							</div>

							<div class="grid gap-2">
								<Label for="edit-dailyBudget">{throttleProfileLabels.dailyBudget}</Label>
								<Input
									id="edit-dailyBudget"
									name="dailyBudget"
									type="number"
									min="10"
									max="10000"
									value={editingProfile.dailyBudget ?? ''}
									placeholder="Empty = unlimited"
									disabled={isSubmitting}
									class={inputClass}
								/>
							</div>
						</div>

						<div class="grid gap-4 sm:grid-cols-2">
							<div class="grid gap-2">
								<Label for="edit-batchSize">{throttleProfileLabels.batchSize}</Label>
								<Input
									id="edit-batchSize"
									name="batchSize"
									type="number"
									min="1"
									max="50"
									value={editingProfile.batchSize}
									required
									disabled={isSubmitting}
									class={inputClass}
								/>
							</div>

							<div class="grid gap-2">
								<Label for="edit-batchCooldownSeconds"
									>{throttleProfileLabels.batchCooldownSeconds}</Label
								>
								<Input
									id="edit-batchCooldownSeconds"
									name="batchCooldownSeconds"
									type="number"
									min="10"
									max="3600"
									value={editingProfile.batchCooldownSeconds}
									required
									disabled={isSubmitting}
									class={inputClass}
								/>
							</div>
						</div>

						<div class="grid gap-2">
							<Label for="edit-rateLimitPauseSeconds"
								>{throttleProfileLabels.rateLimitPauseSeconds}</Label
							>
							<Input
								id="edit-rateLimitPauseSeconds"
								name="rateLimitPauseSeconds"
								type="number"
								min="60"
								max="3600"
								value={editingProfile.rateLimitPauseSeconds}
								required
								disabled={isSubmitting}
								class={inputClass}
							/>
						</div>

						<Separator />

						<div class="flex items-center space-x-3">
							<Checkbox
								id="edit-isDefault"
								name="isDefault"
								bind:checked={editIsDefault}
								disabled={isSubmitting}
							/>
							<Label for="edit-isDefault" class="text-sm font-medium cursor-pointer">
								{throttleProfileLabels.isDefault}
							</Label>
						</div>
					</div>
					<Dialog.Footer>
						<Dialog.Close>
							<Button variant="outline" type="button" disabled={isSubmitting}>Cancel</Button>
						</Dialog.Close>
						<Button type="submit" disabled={isSubmitting}>
							{#if isSubmitting}
								Saving...
							{:else}
								Save Changes
							{/if}
						</Button>
					</Dialog.Footer>
				</form>
			{/if}
		</Dialog.Content>
	</Dialog.Root>

	<!-- Delete Confirmation Dialog -->
	<Dialog.Root bind:open={deleteDialogOpen}>
		<Dialog.Content class="max-w-md">
			<Dialog.Header>
				<Dialog.Title>Delete Throttle Profile</Dialog.Title>
				<Dialog.Description>
					Are you sure you want to delete the profile "{deletingProfile?.name}"? This action cannot
					be undone.
				</Dialog.Description>
			</Dialog.Header>
			{#if deletingProfile}
				<form
					method="POST"
					action="?/throttleDelete"
					use:enhance={() => {
						isSubmitting = true;
						return async ({ update }) => {
							await update();
							isSubmitting = false;
						};
					}}
				>
					<input type="hidden" name="id" value={deletingProfile.id} />
					{#if form?.action === 'throttleDelete' && form?.error}
						<div
							class="bg-destructive/15 text-destructive rounded-md border border-destructive/20 p-3 text-sm mb-4"
							role="alert"
						>
							{form.error}
						</div>
					{/if}
					<Dialog.Footer>
						<Dialog.Close>
							<Button variant="outline" type="button" disabled={isSubmitting}>Cancel</Button>
						</Dialog.Close>
						<Button variant="destructive" type="submit" disabled={isSubmitting}>
							{#if isSubmitting}
								Deleting...
							{:else}
								Delete Profile
							{/if}
						</Button>
					</Dialog.Footer>
				</form>
			{/if}
		</Dialog.Content>
	</Dialog.Root>

	<Separator class="my-6" />

	<!-- Backup Settings Section -->
	<Card.Root variant="glass" class="relative overflow-hidden">
		<div
			class="absolute top-0 left-0 right-0 h-px opacity-60"
			style="background: linear-gradient(to right, transparent, {accentColor}, transparent);"
		></div>
		<Card.Header>
			<Card.Title class="text-xl font-display">Scheduled Backups</Card.Title>
			<Card.Description>Configure automatic backups to run at regular intervals.</Card.Description>
		</Card.Header>
		<Card.Content>
			<form
				method="POST"
				action="?/backupUpdate"
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
					{#if form?.action === 'backupUpdate' && form?.error}
						<div
							class="bg-destructive/15 text-destructive rounded-md border border-destructive/20 p-3 text-sm"
							role="alert"
						>
							{form.error}
						</div>
					{/if}

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

					{#if backup.nextBackupRun && scheduledEnabled}
						<div class="flex items-center gap-2 p-3 bg-muted/50 rounded-md">
							<ClockIcon class="h-4 w-4 text-muted-foreground" />
							<span class="text-sm">
								Next backup: <strong>{formatDate(backup.nextBackupRun)}</strong>
								<span class="text-muted-foreground">({getRelativeTime(backup.nextBackupRun)})</span>
							</span>
						</div>
					{/if}

					<div class="grid gap-2">
						<Label for="scheduledCron">Backup Schedule (Cron Expression)</Label>
						<Input
							id="scheduledCron"
							name="scheduledCron"
							type="text"
							placeholder="0 2 * * *"
							required
							disabled={isSubmitting || !scheduledEnabled}
							value={getFormValue(form?.scheduledCron?.toString(), backup.settings.scheduledCron)}
						/>
						<p class="text-xs text-muted-foreground">
							Cron expression for when to run backups. Default: <code>0 2 * * *</code> (daily at 2 AM).
							Format: minute hour day-of-month month day-of-week.
						</p>
					</div>

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
							value={getNumericFormValue(form?.retentionCount as number, backup.settings.retentionCount)}
						/>
						<p class="text-xs text-muted-foreground">
							Number of scheduled backups to keep. Older scheduled backups will be automatically
							deleted. Manual backups are not affected by this setting.
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

	<!-- Existing Backups -->
	<Card.Root variant="glass" class="relative overflow-hidden">
		<div
			class="absolute top-0 left-0 right-0 h-px opacity-60"
			style="background: linear-gradient(to right, transparent, {accentColor}, transparent);"
		></div>
		<Card.Header>
			<Card.Title class="text-xl font-display">Existing Backups</Card.Title>
			<Card.Description>
				View and manage your database backups. Manual backups can be created from the System page.
			</Card.Description>
		</Card.Header>
		<Card.Content>
			{#if form?.action === 'backupDelete' && form?.error}
				<div
					class="bg-destructive/15 text-destructive rounded-md border border-destructive/20 p-3 text-sm mb-4"
					role="alert"
				>
					{form.error}
				</div>
			{/if}

			{#if backup.backups.length === 0}
				<div class="glass-panel p-8 text-center">
					<div class="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-muted/50 mb-4">
						<CalendarIcon class="h-6 w-6 text-muted-foreground opacity-50" />
					</div>
					<p class="font-display font-medium">No backups found</p>
					<p class="text-sm mt-1 text-muted-foreground">Backups will appear here once created.</p>
				</div>
			{:else}
				<div class="space-y-3">
					{#each backup.backups as backupItem}
						<div
							class="flex items-center justify-between p-4 border border-glass-border/20 rounded-xl bg-glass/30 backdrop-blur-sm hover:bg-glass/50 transition-all duration-200"
						>
							<div class="flex-1">
								<div class="flex items-center gap-2">
									<span class="font-medium">
										{backupItem.description ?? 'Backup'}
									</span>
									<span
										class="text-xs px-2 py-0.5 rounded-full {backupItem.type === 'scheduled'
											? 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
											: 'bg-gray-500/15 text-gray-600 dark:text-gray-400'}"
									>
										{backupItem.type}
									</span>
								</div>
								<div class="text-sm text-muted-foreground mt-1">
									<span>{formatDate(backupItem.createdAt)}</span>
									<span class="mx-2">-</span>
									<span>{formatFileSize(backupItem.fileSizeBytes)}</span>
									<span class="mx-2">-</span>
									<span>{backupItem.tableCount} tables</span>
								</div>
							</div>
							<form
								method="POST"
								action="?/backupDelete"
								use:enhance={() => {
									deletingBackupId = backupItem.id;
									return async ({ result, update }) => {
										await update();
										deletingBackupId = null;
										if (result.type === 'success' && result.data?.success) {
											toastStore.success((result.data.message as string) || 'Backup deleted');
										}
									};
								}}
							>
								<input type="hidden" name="backupId" value={backupItem.id} />
								<Button
									type="submit"
									variant="ghost"
									size="sm"
									class="text-destructive hover:text-destructive hover:bg-destructive/10"
									disabled={deletingBackupId === backupItem.id}
								>
									{#if deletingBackupId === backupItem.id}
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

	<Separator class="my-6" />

	<!-- Maintenance Settings Section -->
	<Card.Root variant="glass" class="relative overflow-hidden">
		<div
			class="absolute top-0 left-0 right-0 h-px opacity-60"
			style="background: linear-gradient(to right, transparent, {accentColor}, transparent);"
		></div>
		<Card.Header>
			<Card.Title class="text-xl font-display flex items-center gap-2">
				<WrenchIcon class="h-5 w-5" />
				Maintenance Settings
			</Card.Title>
			<Card.Description>
				Configure data retention policies and log persistence settings.
			</Card.Description>
		</Card.Header>
		<Card.Content>
			<form
				method="POST"
				action="?/maintenanceUpdate"
				use:enhance={() => {
					isSubmitting = true;
					return async ({ result, update }) => {
						await update();
						isSubmitting = false;
						if (result.type === 'success' && result.data?.success) {
							toastStore.success(
								(result.data.message as string) || 'Maintenance settings saved successfully'
							);
						}
					};
				}}
			>
				<div class="grid gap-6">
					{#if form?.action === 'maintenanceUpdate' && form?.error}
						<div
							class="bg-destructive/15 text-destructive rounded-md border border-destructive/20 p-3 text-sm"
							role="alert"
						>
							{form.error}
						</div>
					{/if}

					<div class="grid gap-4 sm:grid-cols-2">
						<div class="grid gap-2">
							<Label for="historyRetentionDaysSearch">Search History Retention (days)</Label>
							<Input
								id="historyRetentionDaysSearch"
								name="historyRetentionDaysSearch"
								type="number"
								min="1"
								max="365"
								required
								disabled={isSubmitting}
								value={maintenance.historyRetentionDaysSearch}
							/>
							<p class="text-xs text-muted-foreground">
								How long to keep search history records before automatic cleanup.
							</p>
						</div>

						<div class="grid gap-2">
							<Label for="logRetentionDays">Log Retention (days)</Label>
							<Input
								id="logRetentionDays"
								name="logRetentionDays"
								type="number"
								min="1"
								max="365"
								required
								disabled={isSubmitting}
								value={maintenance.logRetentionDays}
							/>
							<p class="text-xs text-muted-foreground">
								How long to keep application logs before automatic cleanup.
							</p>
						</div>
					</div>

					<div class="grid gap-2">
						<div class="flex items-center space-x-3">
							<Checkbox
								id="logPersistenceEnabled"
								name="logPersistenceEnabled"
								bind:checked={logPersistenceEnabled}
								disabled={isSubmitting}
							/>
							<Label for="logPersistenceEnabled" class="text-sm font-medium cursor-pointer">
								Enable log persistence
							</Label>
						</div>
						<p class="text-xs text-muted-foreground ml-7">
							When enabled, application logs are persisted to the database for later viewing in the
							UI. Disable to reduce database writes if you have external logging configured.
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
</div>
