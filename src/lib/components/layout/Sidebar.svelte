<script lang="ts">
import BarChart3Icon from '@lucide/svelte/icons/bar-chart-3';
import CalendarClockIcon from '@lucide/svelte/icons/calendar-clock';
import LayoutDashboardIcon from '@lucide/svelte/icons/layout-dashboard';
import LibraryIcon from '@lucide/svelte/icons/library';
import ListOrderedIcon from '@lucide/svelte/icons/list-ordered';
import PlugIcon from '@lucide/svelte/icons/plug';
import ScrollTextIcon from '@lucide/svelte/icons/scroll-text';
import SettingsIcon from '@lucide/svelte/icons/settings';
import type { Component, Snippet } from 'svelte';
import { page } from '$app/stores';
import comradarrIcon from '$lib/assets/comradarr-icon.svg';
import ThemeToggle from './ThemeToggle.svelte';
import UserMenu from './UserMenu.svelte';

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

<aside class="fixed left-0 top-0 z-40 h-screen w-64 border-r border-glass-border/30 bg-sidebar">
	<div class="flex h-full flex-col">
		<!-- Logo / App Title -->
		<div class="flex h-16 items-center justify-between border-b border-glass-border/20 px-4">
			<a href="/dashboard" class="group flex items-center gap-3 transition-all duration-200">
				<div class="relative">
					<img src={comradarrIcon} alt="" class="h-9 w-9 transition-transform duration-200 group-hover:scale-105" aria-hidden="true" />
					<div class="absolute inset-0 rounded-full bg-primary/20 blur-md opacity-0 transition-opacity group-hover:opacity-100"></div>
				</div>
				<span class="font-display text-xl font-semibold tracking-tight text-foreground">Comradarr</span>
			</a>
			<ThemeToggle />
		</div>

		<!-- Navigation -->
		<nav class="flex-1 space-y-1 px-3 py-5">
			{#each navItems as item (item.href)}
				{@const Icon = item.icon}
				{@const active = isActive(item.href)}
				<a
					href={item.href}
					data-sveltekit-reload
					class="group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200
						{active
							? 'bg-primary/15 text-primary'
							: 'text-muted-foreground hover:bg-glass/50 hover:text-foreground'}"
				>
					<!-- Active indicator bar -->
					{#if active}
						<div class="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-primary shadow-[0_0_12px_oklch(var(--primary)/0.5)]"></div>
					{/if}

					<Icon class="h-5 w-5 shrink-0 transition-transform duration-200 {active ? '' : 'group-hover:scale-110'}" />
					<span class="truncate">{item.label}</span>

					<!-- Hover glow effect -->
					{#if !active}
						<div class="absolute inset-0 rounded-lg bg-gradient-to-r from-primary/5 to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100"></div>
					{/if}
				</a>
			{/each}
		</nav>

		<!-- User Menu at bottom -->
		<div class="border-t border-glass-border/20 p-3">
			<UserMenu {user} />
		</div>
	</div>
</aside>
