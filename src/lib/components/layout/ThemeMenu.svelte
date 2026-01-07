<script lang="ts">
import MonitorIcon from '@lucide/svelte/icons/monitor';
import MoonIcon from '@lucide/svelte/icons/moon';
import SunIcon from '@lucide/svelte/icons/sun';
import type { Component } from 'svelte';
import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
import { type Theme, themeStore } from '$lib/stores/theme.svelte';

interface ThemeOption {
	value: Theme;
	label: string;
	icon: Component;
}

const themes: ThemeOption[] = [
	{ value: 'light', label: 'Light', icon: SunIcon },
	{ value: 'dark', label: 'Dark', icon: MoonIcon },
	{ value: 'system', label: 'System', icon: MonitorIcon }
];

function handleThemeChange(value: string): void {
	themeStore.setTheme(value as Theme);
}

const getCurrentIcon = () => {
	return themeStore.resolved === 'dark' ? MoonIcon : SunIcon;
};
</script>

<DropdownMenu.Sub>
	<DropdownMenu.SubTrigger>
		{@const Icon = getCurrentIcon()}
		<Icon class="h-4 w-4 mr-2" />
		<span>Theme</span>
	</DropdownMenu.SubTrigger>
	<DropdownMenu.SubContent>
		<DropdownMenu.RadioGroup value={themeStore.current} onValueChange={handleThemeChange}>
			{#each themes as theme (theme.value)}
				{@const Icon = theme.icon}
				<DropdownMenu.RadioItem value={theme.value}>
					<Icon class="h-4 w-4 mr-2" />
					{theme.label}
				</DropdownMenu.RadioItem>
			{/each}
		</DropdownMenu.RadioGroup>
	</DropdownMenu.SubContent>
</DropdownMenu.Sub>
