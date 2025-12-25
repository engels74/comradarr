<script lang="ts">
	/**
	 * Throttle profiles settings page.
	 */
	import { enhance } from '$app/forms';
	import * as Card from '$lib/components/ui/card';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import { Badge } from '$lib/components/ui/badge';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Separator } from '$lib/components/ui/separator';
	import { toastStore } from '$lib/components/ui/toast';
	import {
		CONSERVATIVE_PRESET,
		MODERATE_PRESET,
		AGGRESSIVE_PRESET
	} from '$lib/config/throttle-presets';
	import {
		throttleProfileLabels,
		throttleProfileDescriptions
	} from '$lib/schemas/throttle-profile';
	import type { PageProps } from './$types';
	import type { ProfileWithUsage } from './+page.server';
	import GaugeIcon from '@lucide/svelte/icons/gauge';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import StarIcon from '@lucide/svelte/icons/star';
	import ZapIcon from '@lucide/svelte/icons/zap';
	import ShieldIcon from '@lucide/svelte/icons/shield';
	import RocketIcon from '@lucide/svelte/icons/rocket';

	let { data, form }: PageProps = $props();

	let isSubmitting = $state(false);
	let createDialogOpen = $state(false);
	let editDialogOpen = $state(false);
	let deleteDialogOpen = $state(false);
	let editingProfile = $state<ProfileWithUsage | null>(null);
	let deletingProfile = $state<ProfileWithUsage | null>(null);

	// Form state for create dialog
	let createIsDefault = $state(false);

	// Form state for edit dialog
	let editIsDefault = $state(false);

	// Close dialogs on successful submission and show toast
	$effect(() => {
		if (form?.success) {
			createDialogOpen = false;
			editDialogOpen = false;
			deleteDialogOpen = false;
			editingProfile = null;
			deletingProfile = null;
			// Reset form states
			createIsDefault = false;
			// Show success toast
			if (form.message) {
				toastStore.success(form.message);
			}
		}
	});

	// Sync edit form state when editing profile changes
	$effect(() => {
		if (editingProfile) {
			editIsDefault = editingProfile.isDefault;
		}
	});

	/**
	 * Format daily budget for display.
	 */
	function formatDailyBudget(budget: number | null): string {
		return budget === null ? 'Unlimited' : budget.toLocaleString();
	}

	/**
	 * Format seconds into a human-readable string.
	 */
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

	/**
	 * Open edit dialog for a profile.
	 */
	function openEditDialog(profile: ProfileWithUsage) {
		editingProfile = profile;
		editDialogOpen = true;
	}

	/**
	 * Open delete confirmation dialog.
	 */
	function openDeleteDialog(profile: ProfileWithUsage) {
		deletingProfile = profile;
		deleteDialogOpen = true;
	}

	// Common input styling
	const inputClass = 'w-full';
</script>

<svelte:head>
	<title>Throttle Profiles - Comradarr</title>
</svelte:head>

<div class="container mx-auto p-6 max-w-4xl">
	<!-- Page Header -->
	<div class="mb-6">
		<div class="flex items-center gap-3">
			<GaugeIcon class="h-8 w-8 text-muted-foreground" />
			<div>
				<h1 class="text-3xl font-bold">Throttle Profiles</h1>
				<p class="text-muted-foreground mt-1">
					Configure rate limiting profiles for search dispatches
				</p>
			</div>
		</div>
	</div>

	<!-- Error Message -->
	{#if form?.error && !createDialogOpen && !editDialogOpen && !deleteDialogOpen}
		<div
			class="mb-6 bg-destructive/15 text-destructive rounded-md border border-destructive/20 p-3 text-sm"
			role="alert"
		>
			{form.error}
		</div>
	{/if}

	<!-- Preset Profiles Section -->
	<Card.Root class="mb-6">
		<Card.Header>
			<Card.Title class="text-xl">Preset Profiles</Card.Title>
			<Card.Description>
				Reference presets for common use cases. These are read-only templates.
			</Card.Description>
		</Card.Header>
		<Card.Content>
			<div class="grid gap-4 md:grid-cols-3">
				<!-- Conservative -->
				<div class="rounded-lg border border-dashed p-4 bg-muted/30">
					<div class="flex items-center gap-2 mb-3">
						<ShieldIcon class="h-5 w-5 text-blue-500" />
						<span class="font-semibold">{CONSERVATIVE_PRESET.name}</span>
					</div>
					<p class="text-xs text-muted-foreground mb-3">
						{CONSERVATIVE_PRESET.description}
					</p>
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
							<span class="font-medium"
								>{formatSeconds(CONSERVATIVE_PRESET.batchCooldownSeconds)}</span
							>
						</div>
					</div>
				</div>

				<!-- Moderate -->
				<div class="rounded-lg border border-dashed p-4 bg-muted/30">
					<div class="flex items-center gap-2 mb-3">
						<ZapIcon class="h-5 w-5 text-yellow-500" />
						<span class="font-semibold">{MODERATE_PRESET.name}</span>
						<Badge variant="secondary" class="text-xs">Default Fallback</Badge>
					</div>
					<p class="text-xs text-muted-foreground mb-3">
						{MODERATE_PRESET.description}
					</p>
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

				<!-- Aggressive -->
				<div class="rounded-lg border border-dashed p-4 bg-muted/30">
					<div class="flex items-center gap-2 mb-3">
						<RocketIcon class="h-5 w-5 text-red-500" />
						<span class="font-semibold">{AGGRESSIVE_PRESET.name}</span>
					</div>
					<p class="text-xs text-muted-foreground mb-3">
						{AGGRESSIVE_PRESET.description}
					</p>
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
							<span class="font-medium"
								>{formatSeconds(AGGRESSIVE_PRESET.batchCooldownSeconds)}</span
							>
						</div>
					</div>
				</div>
			</div>
		</Card.Content>
	</Card.Root>

	<!-- Custom Profiles Section -->
	<Card.Root>
		<Card.Header>
			<div class="flex items-center justify-between">
				<div>
					<Card.Title class="text-xl">Custom Profiles</Card.Title>
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
							action="?/create"
							use:enhance={() => {
								isSubmitting = true;
								return async ({ update }) => {
									await update();
									isSubmitting = false;
								};
							}}
						>
							<div class="grid gap-4 py-4">
								{#if form?.action === 'create' && form?.error}
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
									<p class="text-xs text-muted-foreground">
										{throttleProfileDescriptions.name}
									</p>
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
			{#if data.profiles.length === 0}
				<div class="rounded-lg border border-dashed p-8 text-center">
					<GaugeIcon class="h-12 w-12 mx-auto text-muted-foreground mb-4" />
					<h3 class="text-lg font-medium mb-2">No custom profiles</h3>
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
					{#each data.profiles as profile (profile.id)}
						<div
							class="flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
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
										action="?/setDefault"
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
</div>

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
				action="?/update"
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
					{#if form?.action === 'update' && form?.error}
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
				Are you sure you want to delete the profile "{deletingProfile?.name}"? This action cannot be
				undone.
			</Dialog.Description>
		</Dialog.Header>
		{#if deletingProfile}
			<form
				method="POST"
				action="?/delete"
				use:enhance={() => {
					isSubmitting = true;
					return async ({ update }) => {
						await update();
						isSubmitting = false;
					};
				}}
			>
				<input type="hidden" name="id" value={deletingProfile.id} />
				{#if form?.action === 'delete' && form?.error}
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
