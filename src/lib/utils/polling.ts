/**
 * Polling utility for real-time data updates.
 * Provides visibility-aware polling with automatic pause/resume.
 */

import { invalidate } from '$app/navigation';

/**
 * Configuration for polling behavior.
 */
export interface PollingConfig {
	/** Polling interval in milliseconds when tab is visible (default: 5000) */
	interval?: number;
	/** Custom dependency key to invalidate (e.g., 'app:queue') */
	dependencyKey: string;
	/** Whether to poll immediately on start (default: false) */
	immediate?: boolean;
}

/**
 * Polling controller interface.
 */
export interface PollingController {
	/** Start polling. Safe to call multiple times. */
	start(): void;
	/** Stop polling completely. Call on component unmount. */
	stop(): void;
	/** Temporarily pause polling (e.g., during form submission). */
	pause(): void;
	/** Resume polling after a pause. */
	resume(): void;
	/** Trigger an immediate refresh. */
	refresh(): Promise<void>;
	/** Check if currently refreshing. */
	readonly isRefreshing: boolean;
	/** Check if polling is active. */
	readonly isActive: boolean;
	/** Check if polling is paused. */
	readonly isPaused: boolean;
}

/**
 * Creates a polling controller for SvelteKit data invalidation.
 * Automatically pauses when the tab is hidden and resumes when visible.
 *
 * Usage in Svelte 5 component:
 * ```svelte
 * <script lang="ts">
 *   import { createPollingController } from '$lib/utils/polling';
 *   import { onMount } from 'svelte';
 *
 *   const polling = createPollingController({ dependencyKey: 'app:queue' });
 *
 *   onMount(() => {
 *     polling.start();
 *     return () => polling.stop();
 *   });
 *
 *   // Pause during form submissions
 *   function handleActionStart() {
 *     polling.pause();
 *   }
 *
 *   function handleActionComplete() {
 *     polling.resume();
 *   }
 * </script>
 * ```
 */
export function createPollingController(config: PollingConfig): PollingController {
	const { interval = 5000, dependencyKey, immediate = false } = config;

	let intervalId: ReturnType<typeof setInterval> | null = null;
	let isActive = false;
	let isPaused = false;
	let isRefreshing = false;

	/**
	 * Perform a single refresh cycle.
	 */
	async function refresh(): Promise<void> {
		if (isRefreshing || isPaused) return;

		isRefreshing = true;
		try {
			await invalidate(dependencyKey);
		} finally {
			isRefreshing = false;
		}
	}

	/**
	 * Handle visibility change - pause polling when tab is hidden.
	 */
	function handleVisibilityChange(): void {
		if (document.hidden) {
			clearPollingInterval();
		} else if (isActive && !isPaused) {
			// Tab became visible - refresh immediately and restart polling
			refresh();
			startPollingInterval();
		}
	}

	/**
	 * Start the polling interval.
	 */
	function startPollingInterval(): void {
		if (intervalId !== null) return;
		intervalId = setInterval(refresh, interval);
	}

	/**
	 * Clear the polling interval.
	 */
	function clearPollingInterval(): void {
		if (intervalId !== null) {
			clearInterval(intervalId);
			intervalId = null;
		}
	}

	return {
		start(): void {
			if (isActive) return;

			isActive = true;
			isPaused = false;

			// Add visibility listener
			if (typeof document !== 'undefined') {
				document.addEventListener('visibilitychange', handleVisibilityChange);

				// Only start if tab is visible
				if (!document.hidden) {
					if (immediate) {
						refresh();
					}
					startPollingInterval();
				}
			}
		},

		stop(): void {
			isActive = false;
			isPaused = false;
			clearPollingInterval();

			if (typeof document !== 'undefined') {
				document.removeEventListener('visibilitychange', handleVisibilityChange);
			}
		},

		pause(): void {
			if (!isActive) return;
			isPaused = true;
			clearPollingInterval();
		},

		resume(): void {
			if (!isActive) return;
			isPaused = false;

			if (typeof document !== 'undefined' && !document.hidden) {
				startPollingInterval();
			}
		},

		refresh,

		get isRefreshing(): boolean {
			return isRefreshing;
		},

		get isActive(): boolean {
			return isActive;
		},

		get isPaused(): boolean {
			return isPaused;
		}
	};
}

/**
 * Default polling intervals for different use cases.
 */
export const POLLING_INTERVALS = {
	/** Fast polling for actively changing data (5 seconds) */
	FAST: 5000,
	/** Standard polling interval (10 seconds) */
	STANDARD: 10000,
	/** Slow polling for less critical data (30 seconds) */
	SLOW: 30000
} as const;
