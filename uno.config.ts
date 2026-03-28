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
		},
		colors: {
			// Glass surfaces - enables bg-glass, border-glass-border, etc.
			glass: 'oklch(var(--glass) / <alpha-value>)',
			'glass-border': 'oklch(var(--glass-border) / <alpha-value>)',
			'glass-highlight': 'oklch(var(--glass-highlight) / <alpha-value>)',
			// Status colors - enables text-success, bg-warning, etc.
			success: 'oklch(var(--success) / <alpha-value>)',
			warning: 'oklch(var(--warning) / <alpha-value>)'
		}
	},
	shortcuts: {
		// Connector-specific glow effects
		'glow-sonarr': 'shadow-[0_0_20px_oklch(var(--accent-sonarr)/0.35)]',
		'glow-radarr': 'shadow-[0_0_20px_oklch(var(--accent-radarr)/0.35)]',

		// Animation utilities
		'animate-float-up': 'animate-[float-up_0.4s_ease-out_forwards]'
	}
});
