export type Theme = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'theme';
const DEFAULT_THEME: Theme = 'dark';

class ThemeStore {
	current = $state<Theme>(DEFAULT_THEME);
	private isBrowser = typeof window !== 'undefined';
	private mediaQuery: MediaQueryList | null = null;

	constructor() {
		if (this.isBrowser) {
			this.initialize();
		}
	}

	get resolved(): ResolvedTheme {
		if (this.current === 'system') {
			if (!this.isBrowser) return 'dark'; // SSR default
			return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
		}
		return this.current;
	}

	private initialize(): void {
		const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
		if (stored && ['light', 'dark', 'system'].includes(stored)) {
			this.current = stored;
		}

		this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
		this.mediaQuery.addEventListener('change', this.handleSystemChange);
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

	setTheme(theme: Theme): void {
		this.current = theme;

		if (this.isBrowser) {
			localStorage.setItem(STORAGE_KEY, theme);
			this.applyTheme();
		}
	}

	toggle(): void {
		const cycle: Theme[] = ['dark', 'light', 'system'];
		const currentIndex = cycle.indexOf(this.current);
		const nextIndex = (currentIndex + 1) % cycle.length;
		this.setTheme(cycle[nextIndex]!);
	}
}

export const themeStore = new ThemeStore();
