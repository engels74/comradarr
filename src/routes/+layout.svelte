<script lang="ts">
import 'virtual:uno.css';
import '../app.css';
import { ToastContainer } from '$lib/components/ui/toast';

let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
	<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
	<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
	<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
	<link rel="manifest" href="/site.webmanifest" />
	<meta name="theme-color" content="#1a1625" />
</svelte:head>

<div class="min-h-screen bg-background text-foreground antialiased">
	{@render children()}
</div>

<!-- Toast notifications -->
<ToastContainer />
