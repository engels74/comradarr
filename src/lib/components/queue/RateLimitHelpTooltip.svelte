<script lang="ts">
import InfoIcon from '@lucide/svelte/icons/info';
import * as Tooltip from '$lib/components/ui/tooltip';
</script>

<Tooltip.Provider>
	<Tooltip.Root>
		<Tooltip.Trigger>
			<span class="p-2 rounded-md hover:bg-glass/50 transition-colors inline-flex cursor-help">
				<InfoIcon class="h-4 w-4 text-muted-foreground" />
				<span class="sr-only">Rate limiting information</span>
			</span>
		</Tooltip.Trigger>
		<Tooltip.Portal>
			<Tooltip.Content side="left" class="max-w-xs p-4 bg-popover text-popover-foreground border border-border" arrowClasses="bg-popover">
				<div class="space-y-2">
					<p class="font-medium">Rate Limiting Explained</p>
					<p class="text-sm text-muted-foreground">
						Comradarr limits API requests to prevent overwhelming your *arr applications and
						indexers.
					</p>
					<dl class="text-sm space-y-1.5 mt-3">
						<div>
							<dt class="font-medium inline">Requests/min:</dt>
							<dd class="inline text-muted-foreground ml-1">
								Maximum searches per minute
							</dd>
						</div>
						<div>
							<dt class="font-medium inline">Daily budget:</dt>
							<dd class="inline text-muted-foreground ml-1">
								Maximum searches per day
							</dd>
						</div>
						<div>
							<dt class="font-medium inline">Paused:</dt>
							<dd class="inline text-muted-foreground ml-1">
								Temporarily stopped due to rate limit hit
							</dd>
						</div>
					</dl>
					<p class="text-xs text-muted-foreground pt-2 border-t border-border mt-3">
						Configure limits in Settings &rarr; Throttle Profiles
					</p>
				</div>
			</Tooltip.Content>
		</Tooltip.Portal>
	</Tooltip.Root>
</Tooltip.Provider>
