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
	toasts = $state<Toast[]>([]);
	private timeouts = new Map<string, ReturnType<typeof setTimeout>>();
	private isBrowser = typeof window !== 'undefined';

	private generateId(): string {
		return `toast-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
	}

	add(message: string, options: ToastOptions = {}): string {
		const { type = 'info', duration, dismissible = true } = options;
		const finalDuration = duration ?? (type === 'error' ? ERROR_DURATION : DEFAULT_DURATION);

		const id = this.generateId();
		const toast: Toast = {
			id,
			type,
			message,
			duration: finalDuration,
			dismissible
		};

		if (this.toasts.length >= MAX_TOASTS) {
			const oldest = this.toasts[0];
			if (oldest) this.dismiss(oldest.id);
		}

		this.toasts = [...this.toasts, toast];

		if (finalDuration > 0 && this.isBrowser) {
			const timeout = setTimeout(() => this.dismiss(id), finalDuration);
			this.timeouts.set(id, timeout);
		}

		return id;
	}

	dismiss(id: string): void {
		const timeout = this.timeouts.get(id);
		if (timeout) {
			clearTimeout(timeout);
			this.timeouts.delete(id);
		}

		this.toasts = this.toasts.filter((t) => t.id !== id);
	}

	clear(): void {
		for (const timeout of this.timeouts.values()) {
			clearTimeout(timeout);
		}
		this.timeouts.clear();
		this.toasts = [];
	}

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
