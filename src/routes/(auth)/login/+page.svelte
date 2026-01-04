<script lang="ts">
	/**
	 * Login page component.
	 */
	import { enhance } from '$app/forms';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import comradarrIcon from '$lib/assets/comradarr-icon.svg';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();

	let isSubmitting = $state(false);
</script>

<svelte:head>
	<title>Login - Comradarr</title>
</svelte:head>

<div class="flex flex-col items-center gap-6">
	<div class="flex flex-col items-center gap-2">
		<img src={comradarrIcon} alt="Comradarr" class="h-20 w-20" />
		<h1 class="text-2xl font-bold text-foreground">Comradarr</h1>
	</div>

	<Card.Root class="w-full">
		<Card.Header class="space-y-1">
			<Card.Title class="text-2xl font-bold">Login</Card.Title>
			<Card.Description>Enter your credentials to access Comradarr</Card.Description>
		</Card.Header>
		<Card.Content>
			<form
				method="POST"
				use:enhance={() => {
					isSubmitting = true;
					return async ({ update }) => {
						await update();
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
						<Label for="username">Username</Label>
						<Input
							id="username"
							name="username"
							type="text"
							autocomplete="username"
							required
							disabled={isSubmitting}
							value={form?.username ?? ''}
						/>
					</div>

					<div class="grid gap-2">
						<Label for="password">Password</Label>
						<Input
							id="password"
							name="password"
							type="password"
							autocomplete="current-password"
							required
							disabled={isSubmitting}
						/>
					</div>

					<Button type="submit" class="w-full" disabled={isSubmitting}>
						{#if isSubmitting}
							Signing in...
						{:else}
							Sign in
						{/if}
					</Button>
				</div>
			</form>
		</Card.Content>
	</Card.Root>
</div>
