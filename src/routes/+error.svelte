<script lang="ts">
/**
 * Global error page component.
 * Handles 404, 500, and other HTTP errors with branded UI.
 */
import { page } from '$app/stores';
import comradarrIcon from '$lib/assets/comradarr-icon.svg';
import { Button } from '$lib/components/ui/button';

const errorMessages: Record<number, string> = {
	400: 'Bad request',
	401: 'Unauthorized',
	403: 'Forbidden',
	404: 'Page not found',
	500: 'Internal server error',
	502: 'Bad gateway',
	503: 'Service unavailable'
};

const errorMessage = $derived(
	errorMessages[$page.status] ?? $page.error?.message ?? 'Something went wrong'
);
</script>

<svelte:head>
	<title>{$page.status} - Comradarr</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center p-4">
	<div class="flex flex-col items-center gap-6 text-center">
		<img src={comradarrIcon} alt="" class="h-32 w-32 opacity-50" aria-hidden="true" />
		<div class="space-y-2">
			<h1 class="text-6xl font-bold text-foreground">{$page.status}</h1>
			<p class="text-xl text-muted-foreground">{errorMessage}</p>
		</div>
		<div class="flex gap-3">
			<Button href="/dashboard">Go to Dashboard</Button>
			<Button variant="outline" onclick={() => history.back()}>Go Back</Button>
		</div>
	</div>
</div>
