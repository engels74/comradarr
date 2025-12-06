<script lang="ts">
	/**
	 * Logout page component.
	 * This page should rarely be seen as the server immediately redirects.
	 * Shown only if JavaScript is disabled and redirect fails.
	 */
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
</script>

<svelte:head>
	<title>Logout - Comradarr</title>
</svelte:head>

<Card.Root>
	<Card.Header class="space-y-1">
		<Card.Title class="text-2xl font-bold">Logging out...</Card.Title>
		<Card.Description>You are being signed out of Comradarr</Card.Description>
	</Card.Header>
	<Card.Content>
		<p class="text-muted-foreground text-sm">
			If you are not redirected automatically,
			<Button variant="link" href="/login" class="h-auto p-0">click here to continue</Button>.
		</p>
	</Card.Content>
</Card.Root>
