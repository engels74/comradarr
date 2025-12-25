/**
 * Toast notification store for managing application-wide notifications.
 * Uses Svelte 5 Runes for reactive state management.
 */

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
	id: string;
	type: ToastType;
	message: string;
	duration: number;
	dismissible: boolean;
}

export interface ToastOptions {
	type?: ToastType;
	duration?: number;
	dismissible?: boolean;
}

const DEFAULT_DURATION = 4000; // 4 seconds
const ERROR_DURATION = 6000; // 6 seconds for errors
const MAX_TOASTS = 5;

class ToastStore {
	/** Active toasts */
	toasts = $state<Toast[]>([]);

	/** Timeout handlers for auto-dismiss */
	private timeouts = new Map<string, ReturnType<typeof setTimeout>>();

	/** Whether we're in a browser environment */
	private isBrowser = typeof window !== 'undefined';

	/** Generate unique ID */
	private generateId(): string {
		return `toast-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
	}

	/** Add a new toast */
	add(message: string, options: ToastOptions = {}): string {
		const { type = 'info', duration, dismissible = true } = options;

		// Use type-specific default duration if not specified
		const finalDuration = duration ?? (type === 'error' ? ERROR_DURATION : DEFAULT_DURATION);

		const id = this.generateId();
		const toast: Toast = {
			id,
			type,
			message,
			duration: finalDuration,
			dismissible
		};

		// Limit max toasts (remove oldest if exceeded)
		if (this.toasts.length >= MAX_TOASTS) {
			const oldest = this.toasts[0];
			if (oldest) this.dismiss(oldest.id);
		}

		this.toasts = [...this.toasts, toast];

		// Set auto-dismiss timeout
		if (finalDuration > 0 && this.isBrowser) {
			const timeout = setTimeout(() => this.dismiss(id), finalDuration);
			this.timeouts.set(id, timeout);
		}

		return id;
	}

	/** Dismiss a toast by ID */
	dismiss(id: string): void {
		// Clear timeout
		const timeout = this.timeouts.get(id);
		if (timeout) {
			clearTimeout(timeout);
			this.timeouts.delete(id);
		}

		this.toasts = this.toasts.filter((t) => t.id !== id);
	}

	/** Clear all toasts */
	clear(): void {
		// Clear all timeouts
		for (const timeout of this.timeouts.values()) {
			clearTimeout(timeout);
		}
		this.timeouts.clear();
		this.toasts = [];
	}

	// Convenience methods
	success(message: string, duration?: number): string {
		const options: ToastOptions = { type: 'success' };
		if (duration !== undefined) options.duration = duration;
		return this.add(message, options);
	}

	error(message: string, duration?: number): string {
		const options: ToastOptions = { type: 'error' };
		if (duration !== undefined) options.duration = duration;
		return this.add(message, options);
	}

	warning(message: string, duration?: number): string {
		const options: ToastOptions = { type: 'warning' };
		if (duration !== undefined) options.duration = duration;
		return this.add(message, options);
	}

	info(message: string, duration?: number): string {
		const options: ToastOptions = { type: 'info' };
		if (duration !== undefined) options.duration = duration;
		return this.add(message, options);
	}
}

export const toastStore = new ToastStore();
