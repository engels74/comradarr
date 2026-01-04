import extractorSvelte from '@unocss/extractor-svelte';
import { presetWind } from '@unocss/preset-wind3';
import { defineConfig } from 'unocss';
import presetAnimations from 'unocss-preset-animations';
import { presetShadcn } from 'unocss-preset-shadcn';

export default defineConfig({
	extractors: [extractorSvelte()],
	presets: [presetWind({ preflight: false }), presetAnimations(), presetShadcn()],
	theme: {
		fontFamily: {
			sans: ['Plus Jakarta Sans', 'system-ui', 'sans-serif'],
			display: ['Outfit', 'system-ui', 'sans-serif']
		}
	},
	shortcuts: {
		// Glass panels - Crystalline Observatory theme
		// Note: glass-panel is defined in app.css with proper OKLCH syntax
		// These shortcuts provide additional layout utilities
		'glass-solid': 'bg-card border border-border rounded-xl',

		// Glass hover states
		'glass-active': 'bg-primary/15 border-primary/40 shadow-[0_0_20px_oklch(var(--primary)/0.2)]',

		// Connector-specific glow effects
		'glow-sonarr': 'shadow-[0_0_20px_oklch(var(--accent-sonarr)/0.35)]',
		'glow-radarr': 'shadow-[0_0_20px_oklch(var(--accent-radarr)/0.35)]',
		'glow-whisparr': 'shadow-[0_0_20px_oklch(var(--accent-whisparr)/0.35)]',
		'glow-prowlarr': 'shadow-[0_0_20px_oklch(var(--accent-prowlarr)/0.35)]',
		'glow-primary': 'shadow-[0_0_20px_oklch(var(--primary)/0.3)]',
		'glow-success': 'shadow-[0_0_15px_oklch(var(--success)/0.4)]',
		'glow-destructive': 'shadow-[0_0_15px_oklch(var(--destructive)/0.4)]',

		// Buttons with glass treatment
		btn: 'py-2 px-4 font-medium rounded-lg transition-all duration-200',
		'btn-primary':
			'btn bg-primary text-primary-foreground hover:bg-primary/90 hover:shadow-md hover:shadow-primary/25 active:scale-[0.98]',
		'btn-secondary':
			'btn bg-secondary text-secondary-foreground hover:bg-secondary/80 active:scale-[0.98]',
		'btn-destructive':
			'btn bg-destructive text-destructive-foreground hover:bg-destructive/90 hover:shadow-md hover:shadow-destructive/25 active:scale-[0.98]',
		'btn-ghost': 'btn hover:bg-accent/50 hover:text-accent-foreground active:scale-[0.98]',
		'btn-outline': 'btn border border-border bg-transparent hover:bg-accent/30 active:scale-[0.98]',
		'btn-glass': 'btn glass-panel active:scale-[0.98]',

		// Cards
		'card-base': 'rounded-xl border bg-card text-card-foreground shadow-sm',
		'card-glass': 'glass-panel text-card-foreground',

		// Status indicators with glow
		'status-healthy': 'bg-success/20 text-success border border-success/30',
		'status-degraded': 'bg-warning/20 text-warning border border-warning/30',
		'status-unhealthy': 'bg-destructive/20 text-destructive border border-destructive/30',
		'status-offline': 'bg-muted text-muted-foreground border border-border',

		// Status dots with glow
		'status-dot': 'size-2.5 rounded-full',
		'status-dot-healthy': 'status-dot bg-success shadow-[0_0_8px_oklch(var(--success)/0.6)]',
		'status-dot-degraded': 'status-dot bg-warning shadow-[0_0_8px_oklch(var(--warning)/0.6)]',
		'status-dot-unhealthy':
			'status-dot bg-destructive shadow-[0_0_8px_oklch(var(--destructive)/0.6)] animate-pulse',
		'status-dot-offline': 'status-dot bg-muted-foreground',

		// Connector type badges with accent colors
		'badge-sonarr':
			'bg-[oklch(var(--accent-sonarr)/0.15)] text-[oklch(var(--accent-sonarr))] border border-[oklch(var(--accent-sonarr)/0.3)]',
		'badge-radarr':
			'bg-[oklch(var(--accent-radarr)/0.15)] text-[oklch(var(--accent-radarr))] border border-[oklch(var(--accent-radarr)/0.3)]',
		'badge-whisparr':
			'bg-[oklch(var(--accent-whisparr)/0.15)] text-[oklch(var(--accent-whisparr))] border border-[oklch(var(--accent-whisparr)/0.3)]',
		'badge-prowlarr':
			'bg-[oklch(var(--accent-prowlarr)/0.15)] text-[oklch(var(--accent-prowlarr))] border border-[oklch(var(--accent-prowlarr)/0.3)]',

		// Layout
		'page-container': 'container mx-auto p-4 md:p-6 lg:p-8',
		'page-header': 'flex flex-col gap-1 mb-6',
		'page-title': 'text-2xl md:text-3xl font-display font-semibold tracking-tight',
		'page-description': 'text-muted-foreground text-sm md:text-base',

		// Sidebar navigation
		'sidebar-item':
			'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 text-muted-foreground hover:text-foreground hover:bg-accent/50',
		'sidebar-item-active':
			'bg-primary/15 text-primary border-l-2 border-primary shadow-[inset_0_0_20px_oklch(var(--primary)/0.1)]',

		// Input fields with glass effect
		'input-glass':
			'glass-subtle px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-primary/50 transition-all',

		// Animation utilities
		'animate-float-up': 'animate-[float-up_0.4s_ease-out_forwards]',
		'animate-pulse-glow': 'animate-[pulse-glow_2s_ease-in-out_infinite]',
		'animate-shimmer': 'animate-[shimmer_2s_ease-in-out_infinite]'
	}
});
