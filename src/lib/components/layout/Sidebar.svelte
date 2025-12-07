<script lang="ts">
	import { page } from '$app/stores';
	import LayoutDashboardIcon from '@lucide/svelte/icons/layout-dashboard';
	import PlugIcon from '@lucide/svelte/icons/plug';
	import LibraryIcon from '@lucide/svelte/icons/library';
	import ListOrderedIcon from '@lucide/svelte/icons/list-ordered';
	import CalendarClockIcon from '@lucide/svelte/icons/calendar-clock';
	import BarChart3Icon from '@lucide/svelte/icons/bar-chart-3';
	import ScrollTextIcon from '@lucide/svelte/icons/scroll-text';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import UserMenu from './UserMenu.svelte';
	import ThemeToggle from './ThemeToggle.svelte';
	import comradarrIcon from '$lib/assets/comradarr-icon.svg';
	import type { Snippet, Component } from 'svelte';

	interface NavItem {
		label: string;
		href: string;
		icon: Component;
	}

	interface Props {
		user: { id: number; username: string } | null;
	}

	let { user }: Props = $props();

	const navItems: NavItem[] = [
		{ label: 'Dashboard', href: '/dashboard', icon: LayoutDashboardIcon },
		{ label: 'Connectors', href: '/connectors', icon: PlugIcon },
		{ label: 'Content', href: '/content', icon: LibraryIcon },
		{ label: 'Queue', href: '/queue', icon: ListOrderedIcon },
		{ label: 'Schedules', href: '/schedules', icon: CalendarClockIcon },
		{ label: 'Analytics', href: '/analytics', icon: BarChart3Icon },
		{ label: 'Logs', href: '/logs', icon: ScrollTextIcon },
		{ label: 'Settings', href: '/settings', icon: SettingsIcon }
	];

	const isActive = $derived((href: string) => {
		const pathname = $page.url.pathname;
		if (href === '/dashboard') {
			return pathname === '/dashboard' || pathname === '/';
		}
		return pathname.startsWith(href);
	});
</script>

<aside class="fixed left-0 top-0 z-40 h-screen w-60 border-r border-border bg-sidebar">
	<div class="flex h-full flex-col">
		<!-- Logo / App Title -->
		<div class="flex h-16 items-center justify-between border-b border-border px-4">
			<a href="/dashboard" class="flex items-center gap-2">
				<img src={comradarrIcon} alt="" class="h-8 w-8" aria-hidden="true" />
				<span class="text-xl font-bold text-foreground">Comradarr</span>
			</a>
			<ThemeToggle />
		</div>

		<!-- Navigation -->
		<nav class="flex-1 space-y-1 px-3 py-4">
			{#each navItems as item (item.href)}
				{@const Icon = item.icon}
				<a
					href={item.href}
					data-sveltekit-reload
					class="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors {isActive(
						item.href
					)
						? 'bg-accent text-accent-foreground'
						: 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'}"
				>
					<Icon class="h-5 w-5" />
					{item.label}
				</a>
			{/each}
		</nav>

		<!-- User Menu at bottom -->
		<div class="border-t border-border p-3">
			<UserMenu {user} />
		</div>
	</div>
</aside>
