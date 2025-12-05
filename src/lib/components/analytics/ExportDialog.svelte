<script lang="ts">
	/**
	 * Export dialog for downloading analytics data as CSV.
	 * Provides date range selection and triggers CSV download.
	 *
	 * Requirements: 12.4, 20.4
	 */

	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Dialog from '$lib/components/ui/dialog';
	import DownloadIcon from '@lucide/svelte/icons/download';

	interface Props {
		class?: string;
	}

	let { class: className = '' }: Props = $props();

	// Dialog state
	let dialogOpen = $state(false);

	// Form state
	let isExporting = $state(false);
	let errorMessage = $state<string | null>(null);

	// Date range state - default to last 30 days
	const today = new Date();
	const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

	let startDate = $state(formatDate(thirtyDaysAgo));
	let endDate = $state(formatDate(today));

	// Validation
	const isValidRange = $derived(() => {
		if (!startDate || !endDate) return false;
		const start = new Date(startDate);
		const end = new Date(endDate);
		return start <= end;
	});

	/**
	 * Formats a Date to YYYY-MM-DD string.
	 */
	function formatDate(date: Date): string {
		return date.toISOString().split('T')[0]!;
	}

	/**
	 * Handles the export action.
	 */
	async function handleExport() {
		if (!isValidRange()) {
			errorMessage = 'Start date must be before or equal to end date.';
			return;
		}

		isExporting = true;
		errorMessage = null;

		try {
			// Build the export URL with date range parameters
			const url = `/api/analytics/export?startDate=${startDate}&endDate=${endDate}`;

			// Fetch the CSV file
			const response = await fetch(url);

			if (!response.ok) {
				const text = await response.text();
				throw new Error(text || `Export failed with status ${response.status}`);
			}

			// Get the filename from the Content-Disposition header or use a default
			const contentDisposition = response.headers.get('Content-Disposition');
			let filename = `comradarr-analytics-${startDate}-to-${endDate}.csv`;
			if (contentDisposition) {
				const match = contentDisposition.match(/filename="(.+)"/);
				if (match?.[1]) {
					filename = match[1];
				}
			}

			// Create a blob and trigger download
			const blob = await response.blob();
			const downloadUrl = window.URL.createObjectURL(blob);
			const link = document.createElement('a');
			link.href = downloadUrl;
			link.download = filename;
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
			window.URL.revokeObjectURL(downloadUrl);

			// Close dialog on success
			dialogOpen = false;
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'An error occurred during export.';
		} finally {
			isExporting = false;
		}
	}

	/**
	 * Resets form state when dialog opens.
	 */
	function handleDialogChange(open: boolean) {
		dialogOpen = open;
		if (open) {
			errorMessage = null;
			// Reset to default date range
			const now = new Date();
			const thirtyDaysBack = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
			startDate = formatDate(thirtyDaysBack);
			endDate = formatDate(now);
		}
	}
</script>

<Dialog.Root open={dialogOpen} onOpenChange={handleDialogChange}>
	<Dialog.Trigger>
		{#snippet child({ props })}
			<Button {...props} variant="outline" size="sm" class={className}>
				<DownloadIcon class="size-4 mr-1.5" />
				Export CSV
			</Button>
		{/snippet}
	</Dialog.Trigger>
	<Dialog.Portal>
		<Dialog.Overlay />
		<Dialog.Content class="sm:max-w-md">
			<Dialog.Header>
				<Dialog.Title>Export Analytics Data</Dialog.Title>
				<Dialog.Description>
					Download analytics data as a CSV file for the selected date range.
				</Dialog.Description>
			</Dialog.Header>

			<div class="grid gap-4 py-4">
				<!-- Start Date -->
				<div class="grid gap-2">
					<Label for="start-date">Start Date</Label>
					<Input
						id="start-date"
						type="date"
						bind:value={startDate}
						disabled={isExporting}
					/>
				</div>

				<!-- End Date -->
				<div class="grid gap-2">
					<Label for="end-date">End Date</Label>
					<Input
						id="end-date"
						type="date"
						bind:value={endDate}
						disabled={isExporting}
					/>
				</div>

				<!-- Error message -->
				{#if errorMessage}
					<p class="text-sm text-destructive">{errorMessage}</p>
				{/if}

				<!-- Info text -->
				<p class="text-xs text-muted-foreground">
					The exported CSV will include daily statistics for all connectors within the selected date range.
					Maximum date range is 1 year.
				</p>
			</div>

			<Dialog.Footer>
				<Dialog.Close>
					{#snippet child({ props })}
						<Button {...props} variant="outline" disabled={isExporting}>
							Cancel
						</Button>
					{/snippet}
				</Dialog.Close>
				<Button onclick={handleExport} disabled={isExporting || !isValidRange()}>
					{#if isExporting}
						<svg class="size-4 mr-1.5 animate-spin" fill="none" viewBox="0 0 24 24">
							<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
							<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
						</svg>
						Exporting...
					{:else}
						<DownloadIcon class="size-4 mr-1.5" />
						Download CSV
					{/if}
				</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
