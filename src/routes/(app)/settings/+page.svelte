<script lang="ts">
import BellIcon from '@lucide/svelte/icons/bell';
import CogIcon from '@lucide/svelte/icons/cog';
import CompassIcon from '@lucide/svelte/icons/compass';
import MenuIcon from '@lucide/svelte/icons/menu';
import SettingsIcon from '@lucide/svelte/icons/settings';
import ShieldIcon from '@lucide/svelte/icons/shield';
import { goto } from '$app/navigation';
import { page } from '$app/state';
import { Button } from '$lib/components/ui/button';
import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
import * as Tabs from '$lib/components/ui/tabs';
import AccessTab from './_components/AccessTab.svelte';
import AlertsTab from './_components/AlertsTab.svelte';
import AutomationTab from './_components/AutomationTab.svelte';
import DiscoveryTab from './_components/DiscoveryTab.svelte';
import GeneralTab from './_components/GeneralTab.svelte';
import type { PageProps } from './$types';

let { data, form }: PageProps = $props();

const tabs = [
	{
		id: 'general',
		label: 'General',
		icon: SettingsIcon,
		accent: 'oklch(0.7 0.15 250)',
		description: 'App identity & preferences'
	},
	{
		id: 'discovery',
		label: 'Discovery',
		icon: CompassIcon,
		accent: 'oklch(0.7 0.18 145)',
		description: 'Search behavior & priorities'
	},
	{
		id: 'access',
		label: 'Access',
		icon: ShieldIcon,
		accent: 'oklch(0.7 0.16 30)',
		description: 'Security & API keys'
	},
	{
		id: 'automation',
		label: 'Automation',
		icon: CogIcon,
		accent: 'oklch(0.7 0.14 280)',
		description: 'Throttle, backup & maintenance'
	},
	{
		id: 'alerts',
		label: 'Alerts',
		icon: BellIcon,
		accent: 'oklch(0.7 0.17 60)',
		description: 'Notification channels'
	}
] as const;

type TabId = (typeof tabs)[number]['id'];

const validTabIds = new Set<string>(tabs.map((t) => t.id));

const activeTab = $derived.by(() => {
	const tabParam = page.url.searchParams.get('tab');
	if (tabParam && validTabIds.has(tabParam)) {
		return tabParam as TabId;
	}
	return 'general';
});
const activeTabConfig = $derived(tabs.find((t) => t.id === activeTab) ?? tabs[0]);

let mobileMenuOpen = $state(false);

function setTab(tabId: string) {
	const url = new URL(page.url);
	if (tabId === 'general') {
		url.searchParams.delete('tab');
	} else {
		url.searchParams.set('tab', tabId);
	}
	goto(url.toString(), { replaceState: true, noScroll: true });
}
</script>

<svelte:head>
	<title>Settings - Comradarr</title>
</svelte:head>

<!-- Ambient glow background -->
<div
	class="fixed inset-0 pointer-events-none transition-all duration-700 ease-out z-0"
	style="background: radial-gradient(ellipse 80% 50% at 50% -20%, color-mix(in oklch, {activeTabConfig.accent} 8%, transparent), transparent);"
></div>

<!-- Grain texture overlay -->
<div
	class="fixed inset-0 pointer-events-none z-[9999] opacity-[0.015]"
	style="background-image: url(&quot;data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E&quot;);"
></div>

<div class="container relative z-10 mx-auto p-6 lg:p-8 max-w-4xl">
	<!-- Page Header -->
	<header class="mb-8 animate-float-up" style="animation-delay: 0ms;">
		<div class="flex items-center gap-3">
			<div
				class="p-2.5 rounded-xl transition-colors duration-500"
				style="background-color: color-mix(in oklch, {activeTabConfig.accent} 15%, transparent);"
			>
				<SettingsIcon
					class="h-6 w-6 transition-colors duration-500"
					style="color: {activeTabConfig.accent};"
				/>
			</div>
			<div>
				<h1 class="font-display text-3xl font-semibold tracking-tight md:text-4xl">Settings</h1>
				<p class="text-muted-foreground mt-1 text-sm md:text-base">
					{activeTabConfig.description}
				</p>
			</div>
		</div>
	</header>

	<!-- Mobile Tab Selector -->
	<div class="md:hidden mb-6 animate-float-up" style="animation-delay: 50ms;">
		<DropdownMenu.Root bind:open={mobileMenuOpen}>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<Button
						variant="outline"
						class="w-full justify-between bg-glass/50 backdrop-blur-sm border-glass-border/30 hover:bg-glass/70"
						{...props}
					>
						<span class="flex items-center gap-2">
							<activeTabConfig.icon class="h-4 w-4" style="color: {activeTabConfig.accent};" />
							{activeTabConfig.label}
						</span>
						<MenuIcon class="h-4 w-4 text-muted-foreground" />
					</Button>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content class="w-[calc(100vw-3rem)] max-w-sm">
				{#each tabs as tab}
					<DropdownMenu.Item
						class="flex items-center gap-3 py-3 cursor-pointer {activeTab === tab.id
							? 'bg-accent'
							: ''}"
						onclick={() => {
							setTab(tab.id);
							mobileMenuOpen = false;
						}}
					>
						<div
							class="p-1.5 rounded-lg"
							style="background-color: color-mix(in oklch, {tab.accent} 15%, transparent);"
						>
							<tab.icon class="h-4 w-4" style="color: {tab.accent};" />
						</div>
						<div class="flex flex-col">
							<span class="font-medium">{tab.label}</span>
							<span class="text-xs text-muted-foreground">{tab.description}</span>
						</div>
					</DropdownMenu.Item>
				{/each}
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	</div>

	<!-- Desktop Tabs -->
	<Tabs.Root value={activeTab} onValueChange={setTab} class="animate-float-up" style="animation-delay: 100ms;">
		<Tabs.List
			class="hidden md:inline-flex w-full h-auto p-1.5 bg-glass/50 backdrop-blur-sm border border-glass-border/30 rounded-xl mb-6"
		>
			{#each tabs as tab}
				<Tabs.Trigger
					value={tab.id}
					class="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg transition-all duration-200 data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=inactive]:hover:bg-glass/50"
				>
					<tab.icon
						class="h-4 w-4 transition-colors duration-300"
						style="color: {activeTab === tab.id ? tab.accent : 'currentColor'};"
					/>
					<span class="font-medium">{tab.label}</span>
				</Tabs.Trigger>
			{/each}
		</Tabs.List>

		<Tabs.Content value="general" class="mt-0 focus-visible:outline-none focus-visible:ring-0">
			<GeneralTab data={data.general} {form} accentColor={tabs[0].accent} />
		</Tabs.Content>

		<Tabs.Content value="discovery" class="mt-0 focus-visible:outline-none focus-visible:ring-0">
			<DiscoveryTab data={data.search} {form} accentColor={tabs[1].accent} />
		</Tabs.Content>

		<Tabs.Content value="access" class="mt-0 focus-visible:outline-none focus-visible:ring-0">
			<AccessTab
				security={data.security}
				apiKeys={data.apiKeys}
				{form}
				accentColor={tabs[2].accent}
			/>
		</Tabs.Content>

		<Tabs.Content value="automation" class="mt-0 focus-visible:outline-none focus-visible:ring-0">
			<AutomationTab
				throttle={data.throttle}
				backup={data.backup}
				maintenance={data.maintenance}
				{form}
				accentColor={tabs[3].accent}
			/>
		</Tabs.Content>

		<Tabs.Content value="alerts" class="mt-0 focus-visible:outline-none focus-visible:ring-0">
			<AlertsTab channels={data.notifications.channels} {form} accentColor={tabs[4].accent} />
		</Tabs.Content>
	</Tabs.Root>
</div>
