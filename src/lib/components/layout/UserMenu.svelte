<script lang="ts">
import LogOutIcon from '@lucide/svelte/icons/log-out';
import UserIcon from '@lucide/svelte/icons/user';
import { Button } from '$lib/components/ui/button';
import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
import ThemeMenu from './ThemeMenu.svelte';

interface Props {
	user: { id: number; username: string } | null;
}

let { user }: Props = $props();
</script>

{#if user}
	<DropdownMenu.Root>
		<DropdownMenu.Trigger>
			{#snippet child({ props })}
				<Button variant="ghost" class="w-full justify-start gap-3 px-3" {...props}>
					<UserIcon class="h-5 w-5" />
					<span class="truncate">{user.username}</span>
				</Button>
			{/snippet}
		</DropdownMenu.Trigger>
		<DropdownMenu.Content align="start" class="w-52">
			<DropdownMenu.Label>My Account</DropdownMenu.Label>
			<DropdownMenu.Separator />
			<ThemeMenu />
			<DropdownMenu.Separator />
			<DropdownMenu.Item>
				<a href="/logout" class="flex w-full items-center gap-2">
					<LogOutIcon class="h-4 w-4" />
					<span>Log out</span>
				</a>
			</DropdownMenu.Item>
		</DropdownMenu.Content>
	</DropdownMenu.Root>
{:else}
	<Button variant="ghost" class="w-full justify-start gap-3 px-3" href="/login">
		<UserIcon class="h-5 w-5" />
		<span>Log in</span>
	</Button>
{/if}
