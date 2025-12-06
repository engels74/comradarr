<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import SunIcon from '@lucide/svelte/icons/sun';
	import MoonIcon from '@lucide/svelte/icons/moon';
	import MonitorIcon from '@lucide/svelte/icons/monitor';
	import { themeStore } from '$lib/stores/theme.svelte';

	// Get the appropriate icon based on current theme setting
	const getIcon = () => {
		switch (themeStore.current) {
			case 'light':
				return SunIcon;
			case 'dark':
				return MoonIcon;
			case 'system':
				return MonitorIcon;
		}
	};

	// Get tooltip text for current theme
	const getTooltip = () => {
		switch (themeStore.current) {
			case 'light':
				return 'Light mode (click to switch)';
			case 'dark':
				return 'Dark mode (click to switch)';
			case 'system':
				return 'System theme (click to switch)';
		}
	};
</script>

<Button
	variant="ghost"
	size="icon"
	onclick={() => themeStore.toggle()}
	title={getTooltip()}
	class="h-8 w-8"
>
	{@const Icon = getIcon()}
	<Icon class="h-4 w-4" />
	<span class="sr-only">Toggle theme</span>
</Button>
