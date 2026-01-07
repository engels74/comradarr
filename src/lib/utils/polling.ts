import { invalidate } from '$app/navigation';

export interface PollingConfig {
	interval?: number;
	dependencyKey: string;
	immediate?: boolean;
}

export interface PollingController {
	start(): void;
	stop(): void;
	pause(): void;
	resume(): void;
	refresh(): Promise<void>;
	readonly isRefreshing: boolean;
	readonly isActive: boolean;
	readonly isPaused: boolean;
}

/** Pauses when tab is hidden and resumes when visible. */
export function createPollingController(config: PollingConfig): PollingController {
	const { interval = 5000, dependencyKey, immediate = false } = config;

	let intervalId: ReturnType<typeof setInterval> | null = null;
	let isActive = false;
	let isPaused = false;
	let isRefreshing = false;

	async function refresh(): Promise<void> {
		if (isRefreshing || isPaused) return;

		isRefreshing = true;
		try {
			await invalidate(dependencyKey);
		} finally {
			isRefreshing = false;
		}
	}

	function handleVisibilityChange(): void {
		if (document.hidden) {
			clearPollingInterval();
		} else if (isActive && !isPaused) {
			refresh();
			startPollingInterval();
		}
	}

	function startPollingInterval(): void {
		if (intervalId !== null) return;
		intervalId = setInterval(refresh, interval);
	}

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

			if (typeof document !== 'undefined') {
				document.addEventListener('visibilitychange', handleVisibilityChange);

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

export const POLLING_INTERVALS = {
	FAST: 5000,
	STANDARD: 10000,
	SLOW: 30000
} as const;
