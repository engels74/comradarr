/**
 * Theme store for managing application color scheme.
 * Uses Svelte 5 Runes for reactive state management.
 */

export type Theme = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'theme';
const DEFAULT_THEME: Theme = 'dark';

class ThemeStore {
	/** The user's selected theme preference */
	current = $state<Theme>(DEFAULT_THEME);

	/** Whether we're in a browser environment */
	private isBrowser = typeof window !== 'undefined';

	/** Media query for system dark preference */
	private mediaQuery: MediaQueryList | null = null;

	constructor() {
		if (this.isBrowser) {
			this.initialize();
		}
	}

	/** The actual applied theme (resolves 'system' to light/dark) */
	get resolved(): ResolvedTheme {
		if (this.current === 'system') {
			if (!this.isBrowser) return 'dark'; // SSR default
			return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
		}
		return this.current;
	}

	private initialize(): void {
		// Read stored preference
		const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
		if (stored && ['light', 'dark', 'system'].includes(stored)) {
			this.current = stored;
		}

		// Listen for system preference changes
		this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
		this.mediaQuery.addEventListener('change', this.handleSystemChange);

		// Apply theme on initialization
		this.applyTheme();
	}

	private handleSystemChange = (): void => {
		if (this.current === 'system') {
			this.applyTheme();
		}
	};

	private applyTheme(): void {
		if (!this.isBrowser) return;

		const resolved = this.resolved;
		document.documentElement.classList.toggle('dark', resolved === 'dark');
	}

	/** Set the theme and persist to localStorage */
	setTheme(theme: Theme): void {
		this.current = theme;

		if (this.isBrowser) {
			localStorage.setItem(STORAGE_KEY, theme);
			this.applyTheme();
		}
	}

	/** Cycle through themes: dark -> light -> system -> dark */
	toggle(): void {
		const cycle: Theme[] = ['dark', 'light', 'system'];
		const currentIndex = cycle.indexOf(this.current);
		const nextIndex = (currentIndex + 1) % cycle.length;
		// Safe assertion: nextIndex is always within bounds due to modulo
		this.setTheme(cycle[nextIndex]!);
	}
}

export const themeStore = new ThemeStore();
