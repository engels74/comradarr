<script lang="ts">
/**
 * Notification settings page.
 */

import BellIcon from '@lucide/svelte/icons/bell';
import BellRingIcon from '@lucide/svelte/icons/bell-ring';
import HashIcon from '@lucide/svelte/icons/hash';
import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
import MailIcon from '@lucide/svelte/icons/mail';
import MessageCircleIcon from '@lucide/svelte/icons/message-circle';
import MessageSquareIcon from '@lucide/svelte/icons/message-square';
import PencilIcon from '@lucide/svelte/icons/pencil';
import PlusIcon from '@lucide/svelte/icons/plus';
import SendIcon from '@lucide/svelte/icons/send';
import ServerIcon from '@lucide/svelte/icons/server';
import ToggleLeftIcon from '@lucide/svelte/icons/toggle-left';
import ToggleRightIcon from '@lucide/svelte/icons/toggle-right';
import Trash2Icon from '@lucide/svelte/icons/trash-2';
import WebhookIcon from '@lucide/svelte/icons/webhook';
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
	baseChannelDescriptions,
	baseChannelLabels,
	channelTypeDescriptions,
	channelTypeLabels,
	discordFieldDescriptions,
	discordFieldLabels,
	emailFieldDescriptions,
	emailFieldLabels,
	eventTypeLabels,
	isImplementedChannelType,
	NOTIFICATION_CHANNEL_TYPES,
	NOTIFICATION_EVENT_TYPES,
	type NotificationChannelType,
	slackFieldDescriptions,
	slackFieldLabels,
	telegramFieldDescriptions,
	telegramFieldLabels,
	webhookFieldDescriptions,
	webhookFieldLabels
} from '$lib/schemas/notification-channel';
import type { ChannelWithStats } from './+page.server';
import type { PageProps } from './$types';

let { data, form }: PageProps = $props();

let isSubmitting = $state(false);
let createDialogOpen = $state(false);
let editDialogOpen = $state(false);
let deleteDialogOpen = $state(false);
let selectedType = $state<NotificationChannelType | null>(null);
let editingChannel = $state<ChannelWithStats | null>(null);
let deletingChannel = $state<ChannelWithStats | null>(null);
let testingChannelId = $state<number | null>(null);

// Form state for create dialog
let createSelectedEvents = $state<string[]>([]);
let createBatchingEnabled = $state(false);
let createQuietHoursEnabled = $state(false);

// Form state for edit dialog
let editSelectedEvents = $state<string[]>([]);
let editBatchingEnabled = $state(false);
let editQuietHoursEnabled = $state(false);

// Close dialogs on successful submission and show toast
$effect(() => {
	if (form?.success) {
		createDialogOpen = false;
		editDialogOpen = false;
		deleteDialogOpen = false;
		selectedType = null;
		editingChannel = null;
		deletingChannel = null;
		// Reset form states
		createSelectedEvents = [];
		createBatchingEnabled = false;
		createQuietHoursEnabled = false;
		// Show success toast
		if (form.message) {
			toastStore.success(form.message);
		}
	}
});

// Sync edit form state when editing channel changes
$effect(() => {
	if (editingChannel) {
		const events = editingChannel.enabledEvents as string[] | null;
		editSelectedEvents = events ?? [];
		editBatchingEnabled = editingChannel.batchingEnabled;
		editQuietHoursEnabled = editingChannel.quietHoursEnabled;
	}
});

/**
 * Get icon component for channel type.
 */
function getChannelIcon(type: string) {
	switch (type) {
		case 'discord':
			return MessageCircleIcon;
		case 'telegram':
			return SendIcon;
		case 'slack':
			return HashIcon;
		case 'email':
			return MailIcon;
		case 'webhook':
			return WebhookIcon;
		case 'pushover':
			return BellRingIcon;
		case 'gotify':
			return ServerIcon;
		case 'ntfy':
			return MessageSquareIcon;
		default:
			return BellIcon;
	}
}

/**
 * Open edit dialog for a channel.
 */
function openEditDialog(channel: ChannelWithStats) {
	editingChannel = channel;
	editDialogOpen = true;
}

/**
 * Open delete confirmation dialog.
 */
function openDeleteDialog(channel: ChannelWithStats) {
	deletingChannel = channel;
	deleteDialogOpen = true;
}

/**
 * Reset create dialog state.
 */
function resetCreateDialog() {
	selectedType = null;
	createSelectedEvents = [];
	createBatchingEnabled = false;
	createQuietHoursEnabled = false;
}

/**
 * Toggle event in selected events array.
 */
function toggleCreateEvent(event: string, checked: boolean) {
	if (checked) {
		createSelectedEvents = [...createSelectedEvents, event];
	} else {
		createSelectedEvents = createSelectedEvents.filter((e) => e !== event);
	}
}

function toggleEditEvent(event: string, checked: boolean) {
	if (checked) {
		editSelectedEvents = [...editSelectedEvents, event];
	} else {
		editSelectedEvents = editSelectedEvents.filter((e) => e !== event);
	}
}

// Common input styling
const inputClass = 'w-full';
const selectClass =
	'flex h-10 w-full rounded-lg border border-glass-border/30 bg-glass/50 backdrop-blur-sm px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 hover:bg-glass/70 disabled:cursor-not-allowed disabled:opacity-50';

// Common timezones for quiet hours
const commonTimezones = [
	'UTC',
	'America/New_York',
	'America/Chicago',
	'America/Denver',
	'America/Los_Angeles',
	'Europe/London',
	'Europe/Paris',
	'Europe/Berlin',
	'Asia/Tokyo',
	'Asia/Shanghai',
	'Australia/Sydney'
];
</script>

<svelte:head>
	<title>Notifications - Comradarr</title>
</svelte:head>

<div class="container mx-auto p-6 lg:p-8 max-w-4xl">
	<!-- Page Header -->
	<header class="mb-8 animate-float-up" style="animation-delay: 0ms;">
		<div class="flex items-center gap-3">
			<div class="p-2.5 rounded-xl bg-muted/50">
				<BellIcon class="h-6 w-6 text-muted-foreground" />
			</div>
			<div>
				<h1 class="font-display text-3xl font-semibold tracking-tight md:text-4xl">Notifications</h1>
				<p class="text-muted-foreground mt-2">
					Configure notification channels and event filtering
				</p>
			</div>
		</div>
	</header>

	<!-- Success/Error Messages -->
	{#if form?.success && !createDialogOpen && !editDialogOpen}
		<div
			class="mb-6 bg-green-500/15 text-green-600 dark:text-green-400 rounded-md border border-green-500/20 p-3 text-sm"
			role="status"
		>
			{form.message}
		</div>
	{/if}

	{#if form?.error && !createDialogOpen && !editDialogOpen && !deleteDialogOpen}
		<div
			class="mb-6 bg-destructive/15 text-destructive rounded-md border border-destructive/20 p-3 text-sm"
			role="alert"
		>
			{form.error}
		</div>
	{/if}

	<!-- Notification Channels Card -->
	<Card.Root variant="glass" class="animate-float-up" style="animation-delay: 100ms;">
		<Card.Header>
			<div class="flex items-center justify-between">
				<div>
					<Card.Title class="text-xl font-display">Notification Channels</Card.Title>
					<Card.Description>Configure where notifications are sent</Card.Description>
				</div>
				<Dialog.Root
					bind:open={createDialogOpen}
					onOpenChange={(open) => {
						if (!open) resetCreateDialog();
					}}
				>
					<Dialog.Trigger>
						<Button>
							<PlusIcon class="h-4 w-4 mr-2" />
							Add Channel
						</Button>
					</Dialog.Trigger>
					<Dialog.Content class="max-w-lg max-h-[90vh] overflow-y-auto">
						{#if !selectedType}
							<!-- Channel Type Selection -->
							<Dialog.Header>
								<Dialog.Title>Add Notification Channel</Dialog.Title>
								<Dialog.Description>Select a notification service to configure</Dialog.Description>
							</Dialog.Header>
							<div class="grid grid-cols-2 gap-3 py-4">
								{#each NOTIFICATION_CHANNEL_TYPES as channelType}
									{@const Icon = getChannelIcon(channelType)}
									{@const implemented = isImplementedChannelType(channelType)}
									<button
										type="button"
										class="flex flex-col items-center p-4 rounded-lg border hover:bg-accent transition-colors {!implemented
											? 'opacity-50 cursor-not-allowed'
											: ''}"
										onclick={() => {
											if (implemented) selectedType = channelType;
										}}
										disabled={!implemented}
									>
										<Icon class="h-8 w-8 mb-2 text-muted-foreground" />
										<span class="font-medium">{channelTypeLabels[channelType]}</span>
										{#if !implemented}
											<Badge variant="secondary" class="mt-1 text-xs">Coming Soon</Badge>
										{/if}
									</button>
								{/each}
							</div>
						{:else}
							<!-- Channel Configuration Form -->
							<Dialog.Header>
								<Dialog.Title>Configure {channelTypeLabels[selectedType]}</Dialog.Title>
								<Dialog.Description>{channelTypeDescriptions[selectedType]}</Dialog.Description>
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
								<input type="hidden" name="type" value={selectedType} />

								<div class="grid gap-4 py-4">
									{#if form?.action === 'create' && form?.error}
										<div
											class="bg-destructive/15 text-destructive rounded-md border border-destructive/20 p-3 text-sm"
											role="alert"
										>
											{form.error}
										</div>
									{/if}

									<!-- Channel Name -->
									<div class="grid gap-2">
										<Label for="create-name">{baseChannelLabels.name}</Label>
										<Input
											id="create-name"
											name="name"
											type="text"
											placeholder="My {channelTypeLabels[selectedType]} Channel"
											required
											disabled={isSubmitting}
											class={inputClass}
										/>
										<p class="text-xs text-muted-foreground">{baseChannelDescriptions.name}</p>
									</div>

									<Separator />

									<!-- Type-specific fields -->
									{#if selectedType === 'discord'}
										<div class="grid gap-2">
											<Label for="create-webhookUrl">{discordFieldLabels.webhookUrl}</Label>
											<Input
												id="create-webhookUrl"
												name="webhookUrl"
												type="url"
												placeholder="https://discord.com/api/webhooks/..."
												required
												disabled={isSubmitting}
												class={inputClass}
											/>
											<p class="text-xs text-muted-foreground">
												{discordFieldDescriptions.webhookUrl}
											</p>
										</div>
										<div class="grid gap-4 sm:grid-cols-2">
											<div class="grid gap-2">
												<Label for="create-username">{discordFieldLabels.username}</Label>
												<Input
													id="create-username"
													name="username"
													type="text"
													placeholder="Comradarr"
													disabled={isSubmitting}
													class={inputClass}
												/>
											</div>
											<div class="grid gap-2">
												<Label for="create-avatarUrl">{discordFieldLabels.avatarUrl}</Label>
												<Input
													id="create-avatarUrl"
													name="avatarUrl"
													type="url"
													placeholder="https://..."
													disabled={isSubmitting}
													class={inputClass}
												/>
											</div>
										</div>
									{:else if selectedType === 'telegram'}
										<div class="grid gap-2">
											<Label for="create-botToken">{telegramFieldLabels.botToken}</Label>
											<Input
												id="create-botToken"
												name="botToken"
												type="password"
												placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
												required
												disabled={isSubmitting}
												class={inputClass}
											/>
											<p class="text-xs text-muted-foreground">
												{telegramFieldDescriptions.botToken}
											</p>
										</div>
										<div class="grid gap-2">
											<Label for="create-chatId">{telegramFieldLabels.chatId}</Label>
											<Input
												id="create-chatId"
												name="chatId"
												type="text"
												placeholder="-1001234567890"
												required
												disabled={isSubmitting}
												class={inputClass}
											/>
											<p class="text-xs text-muted-foreground">
												{telegramFieldDescriptions.chatId}
											</p>
										</div>
										<div class="grid gap-2">
											<Label for="create-parseMode">{telegramFieldLabels.parseMode}</Label>
											<select
												id="create-parseMode"
												name="parseMode"
												class={selectClass}
												disabled={isSubmitting}
											>
												<option value="HTML">HTML</option>
												<option value="Markdown">Markdown</option>
												<option value="MarkdownV2">MarkdownV2</option>
											</select>
										</div>
										<div class="flex items-center space-x-3">
											<Checkbox
												id="create-disableWebPagePreview"
												name="disableWebPagePreview"
												disabled={isSubmitting}
											/>
											<Label for="create-disableWebPagePreview" class="text-sm cursor-pointer">
												{telegramFieldLabels.disableWebPagePreview}
											</Label>
										</div>
										<div class="flex items-center space-x-3">
											<Checkbox
												id="create-disableNotification"
												name="disableNotification"
												disabled={isSubmitting}
											/>
											<Label for="create-disableNotification" class="text-sm cursor-pointer">
												{telegramFieldLabels.disableNotification}
											</Label>
										</div>
									{:else if selectedType === 'slack'}
										<div class="grid gap-2">
											<Label for="create-webhookUrl">{slackFieldLabels.webhookUrl}</Label>
											<Input
												id="create-webhookUrl"
												name="webhookUrl"
												type="url"
												placeholder="https://hooks.slack.com/services/..."
												required
												disabled={isSubmitting}
												class={inputClass}
											/>
											<p class="text-xs text-muted-foreground">
												{slackFieldDescriptions.webhookUrl}
											</p>
										</div>
										<div class="grid gap-4 sm:grid-cols-2">
											<div class="grid gap-2">
												<Label for="create-channel">{slackFieldLabels.channel}</Label>
												<Input
													id="create-channel"
													name="channel"
													type="text"
													placeholder="#alerts"
													disabled={isSubmitting}
													class={inputClass}
												/>
											</div>
											<div class="grid gap-2">
												<Label for="create-username">{slackFieldLabels.username}</Label>
												<Input
													id="create-username"
													name="username"
													type="text"
													placeholder="Comradarr"
													disabled={isSubmitting}
													class={inputClass}
												/>
											</div>
										</div>
										<div class="grid gap-2">
											<Label for="create-iconEmoji">{slackFieldLabels.iconEmoji}</Label>
											<Input
												id="create-iconEmoji"
												name="iconEmoji"
												type="text"
												placeholder=":robot:"
												disabled={isSubmitting}
												class={inputClass}
											/>
										</div>
									{:else if selectedType === 'email'}
										<div class="grid gap-4 sm:grid-cols-2">
											<div class="grid gap-2">
												<Label for="create-host">{emailFieldLabels.host}</Label>
												<Input
													id="create-host"
													name="host"
													type="text"
													placeholder="smtp.gmail.com"
													required
													disabled={isSubmitting}
													class={inputClass}
												/>
											</div>
											<div class="grid gap-2">
												<Label for="create-port">{emailFieldLabels.port}</Label>
												<Input
													id="create-port"
													name="port"
													type="number"
													value="587"
													min="1"
													max="65535"
													required
													disabled={isSubmitting}
													class={inputClass}
												/>
											</div>
										</div>
										<div class="flex items-center space-x-3">
											<Checkbox id="create-secure" name="secure" disabled={isSubmitting} />
											<Label for="create-secure" class="text-sm cursor-pointer">
												{emailFieldLabels.secure}
											</Label>
										</div>
										<p class="text-xs text-muted-foreground -mt-2">
											{emailFieldDescriptions.secure}
										</p>
										<div class="grid gap-4 sm:grid-cols-2">
											<div class="grid gap-2">
												<Label for="create-from">{emailFieldLabels.from}</Label>
												<Input
													id="create-from"
													name="from"
													type="email"
													placeholder="alerts@example.com"
													required
													disabled={isSubmitting}
													class={inputClass}
												/>
											</div>
											<div class="grid gap-2">
												<Label for="create-to">{emailFieldLabels.to}</Label>
												<Input
													id="create-to"
													name="to"
													type="text"
													placeholder="admin@example.com"
													required
													disabled={isSubmitting}
													class={inputClass}
												/>
											</div>
										</div>
										<div class="grid gap-4 sm:grid-cols-2">
											<div class="grid gap-2">
												<Label for="create-emailUsername">{emailFieldLabels.username}</Label>
												<Input
													id="create-emailUsername"
													name="username"
													type="text"
													placeholder="Optional"
													disabled={isSubmitting}
													class={inputClass}
												/>
											</div>
											<div class="grid gap-2">
												<Label for="create-password">{emailFieldLabels.password}</Label>
												<Input
													id="create-password"
													name="password"
													type="password"
													placeholder="••••••••"
													disabled={isSubmitting}
													class={inputClass}
												/>
											</div>
										</div>
										<div class="grid gap-2">
											<Label for="create-subjectPrefix">{emailFieldLabels.subjectPrefix}</Label>
											<Input
												id="create-subjectPrefix"
												name="subjectPrefix"
												type="text"
												placeholder="[Comradarr]"
												disabled={isSubmitting}
												class={inputClass}
											/>
										</div>
									{:else if selectedType === 'webhook'}
										<div class="grid gap-2">
											<Label for="create-url">{webhookFieldLabels.url}</Label>
											<Input
												id="create-url"
												name="url"
												type="url"
												placeholder="https://example.com/webhook"
												required
												disabled={isSubmitting}
												class={inputClass}
											/>
											<p class="text-xs text-muted-foreground">{webhookFieldDescriptions.url}</p>
										</div>
										<div class="grid gap-4 sm:grid-cols-2">
											<div class="grid gap-2">
												<Label for="create-method">{webhookFieldLabels.method}</Label>
												<select
													id="create-method"
													name="method"
													class={selectClass}
													disabled={isSubmitting}
												>
													<option value="POST">POST</option>
													<option value="PUT">PUT</option>
												</select>
											</div>
											<div class="grid gap-2">
												<Label for="create-contentType">{webhookFieldLabels.contentType}</Label>
												<Input
													id="create-contentType"
													name="contentType"
													type="text"
													value="application/json"
													disabled={isSubmitting}
													class={inputClass}
												/>
											</div>
										</div>
										<div class="grid gap-2">
											<Label for="create-signingSecret">{webhookFieldLabels.signingSecret}</Label>
											<Input
												id="create-signingSecret"
												name="signingSecret"
												type="password"
												placeholder="Optional secret for HMAC-SHA256 signatures"
												disabled={isSubmitting}
												class={inputClass}
											/>
											<p class="text-xs text-muted-foreground">
												{webhookFieldDescriptions.signingSecret}
											</p>
										</div>
									{/if}

									<Separator />

									<!-- Event Selection -->
									<div class="grid gap-2">
										<Label>{baseChannelLabels.enabledEvents}</Label>
										<p class="text-xs text-muted-foreground">
											{baseChannelDescriptions.enabledEvents}
										</p>
										<div class="grid grid-cols-2 gap-2 mt-2">
											{#each NOTIFICATION_EVENT_TYPES as eventType}
												<div class="flex items-center space-x-2">
													<Checkbox
														id="create-event-{eventType}"
														name="enabledEvents"
														value={eventType}
														checked={createSelectedEvents.includes(eventType)}
														onCheckedChange={(checked) => toggleCreateEvent(eventType, !!checked)}
														disabled={isSubmitting}
													/>
													<Label
														for="create-event-{eventType}"
														class="text-sm cursor-pointer font-normal"
													>
														{eventTypeLabels[eventType]}
													</Label>
												</div>
											{/each}
										</div>
									</div>

									<Separator />

									<!-- Batching Configuration -->
									<div class="grid gap-3">
										<div class="flex items-center space-x-3">
											<Checkbox
												id="create-batchingEnabled"
												name="batchingEnabled"
												bind:checked={createBatchingEnabled}
												disabled={isSubmitting}
											/>
											<Label
												for="create-batchingEnabled"
												class="text-sm font-medium cursor-pointer"
											>
												{baseChannelLabels.batchingEnabled}
											</Label>
										</div>
										<p class="text-xs text-muted-foreground -mt-1">
											{baseChannelDescriptions.batchingEnabled}
										</p>
										{#if createBatchingEnabled}
											<div class="grid gap-2 ml-7">
												<Label for="create-batchingWindowSeconds"
													>{baseChannelLabels.batchingWindowSeconds}</Label
												>
												<Input
													id="create-batchingWindowSeconds"
													name="batchingWindowSeconds"
													type="number"
													value="60"
													min="10"
													max="3600"
													disabled={isSubmitting}
													class={inputClass}
												/>
											</div>
										{/if}
									</div>

									<!-- Quiet Hours Configuration -->
									<div class="grid gap-3">
										<div class="flex items-center space-x-3">
											<Checkbox
												id="create-quietHoursEnabled"
												name="quietHoursEnabled"
												bind:checked={createQuietHoursEnabled}
												disabled={isSubmitting}
											/>
											<Label
												for="create-quietHoursEnabled"
												class="text-sm font-medium cursor-pointer"
											>
												{baseChannelLabels.quietHoursEnabled}
											</Label>
										</div>
										<p class="text-xs text-muted-foreground -mt-1">
											{baseChannelDescriptions.quietHoursEnabled}
										</p>
										{#if createQuietHoursEnabled}
											<div class="grid gap-3 ml-7">
												<div class="grid grid-cols-2 gap-3">
													<div class="grid gap-2">
														<Label for="create-quietHoursStart"
															>{baseChannelLabels.quietHoursStart}</Label
														>
														<Input
															id="create-quietHoursStart"
															name="quietHoursStart"
															type="time"
															value="22:00"
															required
															disabled={isSubmitting}
															class={inputClass}
														/>
													</div>
													<div class="grid gap-2">
														<Label for="create-quietHoursEnd"
															>{baseChannelLabels.quietHoursEnd}</Label
														>
														<Input
															id="create-quietHoursEnd"
															name="quietHoursEnd"
															type="time"
															value="08:00"
															required
															disabled={isSubmitting}
															class={inputClass}
														/>
													</div>
												</div>
												<div class="grid gap-2">
													<Label for="create-quietHoursTimezone"
														>{baseChannelLabels.quietHoursTimezone}</Label
													>
													<select
														id="create-quietHoursTimezone"
														name="quietHoursTimezone"
														class={selectClass}
														disabled={isSubmitting}
													>
														{#each commonTimezones as tz}
															<option value={tz}>{tz}</option>
														{/each}
													</select>
												</div>
											</div>
										{/if}
									</div>
								</div>

								<Dialog.Footer>
									<Button
										variant="outline"
										type="button"
										onclick={() => (selectedType = null)}
										disabled={isSubmitting}
									>
										Back
									</Button>
									<Button type="submit" disabled={isSubmitting}>
										{#if isSubmitting}
											Creating...
										{:else}
											Create Channel
										{/if}
									</Button>
								</Dialog.Footer>
							</form>
						{/if}
					</Dialog.Content>
				</Dialog.Root>
			</div>
		</Card.Header>
		<Card.Content>
			{#if data.channels.length === 0}
				<div class="glass-panel p-8 text-center">
					<div class="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-muted/50 mb-4">
						<BellIcon class="h-6 w-6 text-muted-foreground opacity-50" />
					</div>
					<h3 class="text-lg font-display font-medium mb-2">No notification channels</h3>
					<p class="text-muted-foreground mb-4">
						Add a notification channel to receive alerts about searches, syncs, and more.
					</p>
					<Button onclick={() => (createDialogOpen = true)}>
						<PlusIcon class="h-4 w-4 mr-2" />
						Add Channel
					</Button>
				</div>
			{:else}
				<div class="space-y-4">
					{#each data.channels as channel (channel.id)}
						{@const Icon = getChannelIcon(channel.type)}
						<div
							class="flex items-center justify-between p-4 rounded-xl border border-glass-border/20 bg-glass/30 backdrop-blur-sm hover:bg-glass/50 transition-all duration-200"
						>
							<div class="flex items-center gap-4">
								<!-- Channel Type Icon -->
								<div class="flex-shrink-0">
									<Icon class="h-6 w-6 text-muted-foreground" />
								</div>

								<!-- Channel Info -->
								<div class="flex-1 min-w-0">
									<div class="flex items-center gap-2 mb-1">
										<span class="font-semibold">{channel.name}</span>
										<Badge variant={channel.enabled ? 'default' : 'secondary'}>
											{channel.enabled ? 'Enabled' : 'Disabled'}
										</Badge>
										<Badge variant="outline"
											>{channelTypeLabels[channel.type as NotificationChannelType]}</Badge
										>
									</div>
									<div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
										<span>{channel.stats.totalSent} sent</span>
										{#if channel.stats.totalFailed > 0}
											<span class="text-destructive">{channel.stats.totalFailed} failed</span>
										{/if}
										{#if Array.isArray(channel.enabledEvents) && channel.enabledEvents.length > 0}
											<span>{channel.enabledEvents.length} events</span>
										{/if}
										{#if channel.quietHoursEnabled}
											<span>Quiet: {channel.quietHoursStart}-{channel.quietHoursEnd}</span>
										{/if}
									</div>
								</div>
							</div>

							<!-- Actions -->
							<div class="flex items-center gap-1">
								<!-- Toggle Enabled -->
								<form
									method="POST"
									action="?/toggle"
									use:enhance={() => {
										return async ({ update }) => {
											await update();
										};
									}}
								>
									<input type="hidden" name="id" value={channel.id} />
									<input type="hidden" name="enabled" value={!channel.enabled} />
									<Button variant="ghost" size="sm" type="submit" title="Toggle enabled">
										{#if channel.enabled}
											<ToggleRightIcon class="h-4 w-4" />
										{:else}
											<ToggleLeftIcon class="h-4 w-4" />
										{/if}
									</Button>
								</form>

								<!-- Test -->
								<form
									method="POST"
									action="?/test"
									use:enhance={() => {
										testingChannelId = channel.id;
										return async ({ update }) => {
											await update();
											testingChannelId = null;
										};
									}}
								>
									<input type="hidden" name="id" value={channel.id} />
									<Button
										variant="ghost"
										size="sm"
										type="submit"
										title="Send test notification"
										disabled={testingChannelId === channel.id}
									>
										{#if testingChannelId === channel.id}
											<LoaderCircleIcon class="h-4 w-4 animate-spin" />
										{:else}
											<SendIcon class="h-4 w-4" />
										{/if}
									</Button>
								</form>

								<!-- Edit -->
								<Button variant="ghost" size="sm" onclick={() => openEditDialog(channel)}>
									<PencilIcon class="h-4 w-4" />
								</Button>

								<!-- Delete -->
								<Button variant="ghost" size="sm" onclick={() => openDeleteDialog(channel)}>
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
	<Dialog.Content class="max-w-lg max-h-[90vh] overflow-y-auto">
		<Dialog.Header>
			<Dialog.Title>Edit Notification Channel</Dialog.Title>
			<Dialog.Description>Update the settings for this notification channel.</Dialog.Description>
		</Dialog.Header>
		{#if editingChannel}
			{@const channelType = editingChannel.type as NotificationChannelType}
			{@const config = editingChannel.config as Record<string, unknown> | null}
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
				<input type="hidden" name="id" value={editingChannel.id} />
				<input type="hidden" name="type" value={channelType} />

				<div class="grid gap-4 py-4">
					{#if form?.action === 'update' && form?.error}
						<div
							class="bg-destructive/15 text-destructive rounded-md border border-destructive/20 p-3 text-sm"
							role="alert"
						>
							{form.error}
						</div>
					{/if}

					<!-- Channel Name -->
					<div class="grid gap-2">
						<Label for="edit-name">{baseChannelLabels.name}</Label>
						<Input
							id="edit-name"
							name="name"
							type="text"
							value={editingChannel.name}
							required
							disabled={isSubmitting}
							class={inputClass}
						/>
					</div>

					<Separator />

					<!-- Type-specific fields -->
					{#if channelType === 'discord'}
						<div class="grid gap-2">
							<Label for="edit-webhookUrl">{discordFieldLabels.webhookUrl}</Label>
							<Input
								id="edit-webhookUrl"
								name="webhookUrl"
								type="url"
								placeholder="Leave empty to keep existing"
								disabled={isSubmitting}
								class={inputClass}
							/>
							<p class="text-xs text-muted-foreground">Leave empty to keep existing webhook URL</p>
						</div>
						<div class="grid gap-4 sm:grid-cols-2">
							<div class="grid gap-2">
								<Label for="edit-username">{discordFieldLabels.username}</Label>
								<Input
									id="edit-username"
									name="username"
									type="text"
									value={config?.username ?? ''}
									disabled={isSubmitting}
									class={inputClass}
								/>
							</div>
							<div class="grid gap-2">
								<Label for="edit-avatarUrl">{discordFieldLabels.avatarUrl}</Label>
								<Input
									id="edit-avatarUrl"
									name="avatarUrl"
									type="url"
									value={config?.avatarUrl ?? ''}
									disabled={isSubmitting}
									class={inputClass}
								/>
							</div>
						</div>
					{:else if channelType === 'telegram'}
						<div class="grid gap-2">
							<Label for="edit-botToken">{telegramFieldLabels.botToken}</Label>
							<Input
								id="edit-botToken"
								name="botToken"
								type="password"
								placeholder="Leave empty to keep existing"
								disabled={isSubmitting}
								class={inputClass}
							/>
							<p class="text-xs text-muted-foreground">Leave empty to keep existing bot token</p>
						</div>
						<div class="grid gap-2">
							<Label for="edit-chatId">{telegramFieldLabels.chatId}</Label>
							<Input
								id="edit-chatId"
								name="chatId"
								type="text"
								value={config?.chatId ?? ''}
								required
								disabled={isSubmitting}
								class={inputClass}
							/>
						</div>
						<div class="grid gap-2">
							<Label for="edit-parseMode">{telegramFieldLabels.parseMode}</Label>
							<select
								id="edit-parseMode"
								name="parseMode"
								class={selectClass}
								disabled={isSubmitting}
							>
								<option value="HTML" selected={config?.parseMode === 'HTML'}>HTML</option>
								<option value="Markdown" selected={config?.parseMode === 'Markdown'}
									>Markdown</option
								>
								<option value="MarkdownV2" selected={config?.parseMode === 'MarkdownV2'}
									>MarkdownV2</option
								>
							</select>
						</div>
						<div class="flex items-center space-x-3">
							<Checkbox
								id="edit-disableWebPagePreview"
								name="disableWebPagePreview"
								checked={!!config?.disableWebPagePreview}
								disabled={isSubmitting}
							/>
							<Label for="edit-disableWebPagePreview" class="text-sm cursor-pointer">
								{telegramFieldLabels.disableWebPagePreview}
							</Label>
						</div>
						<div class="flex items-center space-x-3">
							<Checkbox
								id="edit-disableNotification"
								name="disableNotification"
								checked={!!config?.disableNotification}
								disabled={isSubmitting}
							/>
							<Label for="edit-disableNotification" class="text-sm cursor-pointer">
								{telegramFieldLabels.disableNotification}
							</Label>
						</div>
					{:else if channelType === 'slack'}
						<div class="grid gap-2">
							<Label for="edit-webhookUrl">{slackFieldLabels.webhookUrl}</Label>
							<Input
								id="edit-webhookUrl"
								name="webhookUrl"
								type="url"
								placeholder="Leave empty to keep existing"
								disabled={isSubmitting}
								class={inputClass}
							/>
							<p class="text-xs text-muted-foreground">Leave empty to keep existing webhook URL</p>
						</div>
						<div class="grid gap-4 sm:grid-cols-2">
							<div class="grid gap-2">
								<Label for="edit-channel">{slackFieldLabels.channel}</Label>
								<Input
									id="edit-channel"
									name="channel"
									type="text"
									value={config?.channel ?? ''}
									disabled={isSubmitting}
									class={inputClass}
								/>
							</div>
							<div class="grid gap-2">
								<Label for="edit-username">{slackFieldLabels.username}</Label>
								<Input
									id="edit-username"
									name="username"
									type="text"
									value={config?.username ?? ''}
									disabled={isSubmitting}
									class={inputClass}
								/>
							</div>
						</div>
						<div class="grid gap-2">
							<Label for="edit-iconEmoji">{slackFieldLabels.iconEmoji}</Label>
							<Input
								id="edit-iconEmoji"
								name="iconEmoji"
								type="text"
								value={config?.iconEmoji ?? ''}
								disabled={isSubmitting}
								class={inputClass}
							/>
						</div>
					{:else if channelType === 'email'}
						<div class="grid gap-4 sm:grid-cols-2">
							<div class="grid gap-2">
								<Label for="edit-host">{emailFieldLabels.host}</Label>
								<Input
									id="edit-host"
									name="host"
									type="text"
									value={config?.host ?? ''}
									required
									disabled={isSubmitting}
									class={inputClass}
								/>
							</div>
							<div class="grid gap-2">
								<Label for="edit-port">{emailFieldLabels.port}</Label>
								<Input
									id="edit-port"
									name="port"
									type="number"
									value={config?.port ?? 587}
									min="1"
									max="65535"
									required
									disabled={isSubmitting}
									class={inputClass}
								/>
							</div>
						</div>
						<div class="flex items-center space-x-3">
							<Checkbox
								id="edit-secure"
								name="secure"
								checked={!!config?.secure}
								disabled={isSubmitting}
							/>
							<Label for="edit-secure" class="text-sm cursor-pointer"
								>{emailFieldLabels.secure}</Label
							>
						</div>
						<div class="grid gap-4 sm:grid-cols-2">
							<div class="grid gap-2">
								<Label for="edit-from">{emailFieldLabels.from}</Label>
								<Input
									id="edit-from"
									name="from"
									type="email"
									value={config?.from ?? ''}
									required
									disabled={isSubmitting}
									class={inputClass}
								/>
							</div>
							<div class="grid gap-2">
								<Label for="edit-to">{emailFieldLabels.to}</Label>
								<Input
									id="edit-to"
									name="to"
									type="text"
									value={config?.to ?? ''}
									required
									disabled={isSubmitting}
									class={inputClass}
								/>
							</div>
						</div>
						<div class="grid gap-4 sm:grid-cols-2">
							<div class="grid gap-2">
								<Label for="edit-emailUsername">{emailFieldLabels.username}</Label>
								<Input
									id="edit-emailUsername"
									name="username"
									type="text"
									value={config?.username ?? ''}
									disabled={isSubmitting}
									class={inputClass}
								/>
							</div>
							<div class="grid gap-2">
								<Label for="edit-password">{emailFieldLabels.password}</Label>
								<Input
									id="edit-password"
									name="password"
									type="password"
									placeholder="Leave empty to keep existing"
									disabled={isSubmitting}
									class={inputClass}
								/>
							</div>
						</div>
						<div class="grid gap-2">
							<Label for="edit-subjectPrefix">{emailFieldLabels.subjectPrefix}</Label>
							<Input
								id="edit-subjectPrefix"
								name="subjectPrefix"
								type="text"
								value={config?.subjectPrefix ?? ''}
								disabled={isSubmitting}
								class={inputClass}
							/>
						</div>
					{:else if channelType === 'webhook'}
						<div class="grid gap-2">
							<Label for="edit-url">{webhookFieldLabels.url}</Label>
							<Input
								id="edit-url"
								name="url"
								type="url"
								placeholder="Leave empty to keep existing"
								disabled={isSubmitting}
								class={inputClass}
							/>
							<p class="text-xs text-muted-foreground">Leave empty to keep existing URL</p>
						</div>
						<div class="grid gap-4 sm:grid-cols-2">
							<div class="grid gap-2">
								<Label for="edit-method">{webhookFieldLabels.method}</Label>
								<select id="edit-method" name="method" class={selectClass} disabled={isSubmitting}>
									<option value="POST" selected={config?.method !== 'PUT'}>POST</option>
									<option value="PUT" selected={config?.method === 'PUT'}>PUT</option>
								</select>
							</div>
							<div class="grid gap-2">
								<Label for="edit-contentType">{webhookFieldLabels.contentType}</Label>
								<Input
									id="edit-contentType"
									name="contentType"
									type="text"
									value={config?.contentType ?? 'application/json'}
									disabled={isSubmitting}
									class={inputClass}
								/>
							</div>
						</div>
						<div class="grid gap-2">
							<Label for="edit-signingSecret">{webhookFieldLabels.signingSecret}</Label>
							<Input
								id="edit-signingSecret"
								name="signingSecret"
								type="password"
								placeholder="Leave empty to keep existing"
								disabled={isSubmitting}
								class={inputClass}
							/>
						</div>
					{/if}

					<Separator />

					<!-- Event Selection -->
					<div class="grid gap-2">
						<Label>{baseChannelLabels.enabledEvents}</Label>
						<div class="grid grid-cols-2 gap-2 mt-2">
							{#each NOTIFICATION_EVENT_TYPES as eventType}
								<div class="flex items-center space-x-2">
									<Checkbox
										id="edit-event-{eventType}"
										name="enabledEvents"
										value={eventType}
										checked={editSelectedEvents.includes(eventType)}
										onCheckedChange={(checked) => toggleEditEvent(eventType, !!checked)}
										disabled={isSubmitting}
									/>
									<Label for="edit-event-{eventType}" class="text-sm cursor-pointer font-normal">
										{eventTypeLabels[eventType]}
									</Label>
								</div>
							{/each}
						</div>
					</div>

					<Separator />

					<!-- Batching Configuration -->
					<div class="grid gap-3">
						<div class="flex items-center space-x-3">
							<Checkbox
								id="edit-batchingEnabled"
								name="batchingEnabled"
								bind:checked={editBatchingEnabled}
								disabled={isSubmitting}
							/>
							<Label for="edit-batchingEnabled" class="text-sm font-medium cursor-pointer">
								{baseChannelLabels.batchingEnabled}
							</Label>
						</div>
						{#if editBatchingEnabled}
							<div class="grid gap-2 ml-7">
								<Label for="edit-batchingWindowSeconds"
									>{baseChannelLabels.batchingWindowSeconds}</Label
								>
								<Input
									id="edit-batchingWindowSeconds"
									name="batchingWindowSeconds"
									type="number"
									value={editingChannel.batchingWindowSeconds}
									min="10"
									max="3600"
									disabled={isSubmitting}
									class={inputClass}
								/>
							</div>
						{/if}
					</div>

					<!-- Quiet Hours Configuration -->
					<div class="grid gap-3">
						<div class="flex items-center space-x-3">
							<Checkbox
								id="edit-quietHoursEnabled"
								name="quietHoursEnabled"
								bind:checked={editQuietHoursEnabled}
								disabled={isSubmitting}
							/>
							<Label for="edit-quietHoursEnabled" class="text-sm font-medium cursor-pointer">
								{baseChannelLabels.quietHoursEnabled}
							</Label>
						</div>
						{#if editQuietHoursEnabled}
							<div class="grid gap-3 ml-7">
								<div class="grid grid-cols-2 gap-3">
									<div class="grid gap-2">
										<Label for="edit-quietHoursStart">{baseChannelLabels.quietHoursStart}</Label>
										<Input
											id="edit-quietHoursStart"
											name="quietHoursStart"
											type="time"
											value={editingChannel.quietHoursStart ?? '22:00'}
											required
											disabled={isSubmitting}
											class={inputClass}
										/>
									</div>
									<div class="grid gap-2">
										<Label for="edit-quietHoursEnd">{baseChannelLabels.quietHoursEnd}</Label>
										<Input
											id="edit-quietHoursEnd"
											name="quietHoursEnd"
											type="time"
											value={editingChannel.quietHoursEnd ?? '08:00'}
											required
											disabled={isSubmitting}
											class={inputClass}
										/>
									</div>
								</div>
								<div class="grid gap-2">
									<Label for="edit-quietHoursTimezone">{baseChannelLabels.quietHoursTimezone}</Label
									>
									<select
										id="edit-quietHoursTimezone"
										name="quietHoursTimezone"
										class={selectClass}
										disabled={isSubmitting}
									>
										{#each commonTimezones as tz}
											<option value={tz} selected={editingChannel.quietHoursTimezone === tz}
												>{tz}</option
											>
										{/each}
									</select>
								</div>
							</div>
						{/if}
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
			<Dialog.Title>Delete Notification Channel</Dialog.Title>
			<Dialog.Description>
				Are you sure you want to delete the channel "{deletingChannel?.name}"? This will also delete
				all notification history for this channel. This action cannot be undone.
			</Dialog.Description>
		</Dialog.Header>
		{#if deletingChannel}
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
				<input type="hidden" name="id" value={deletingChannel.id} />
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
							Delete Channel
						{/if}
					</Button>
				</Dialog.Footer>
			</form>
		{/if}
	</Dialog.Content>
</Dialog.Root>
