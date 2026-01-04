import extractorSvelte from '@unocss/extractor-svelte';
import { presetWind } from '@unocss/preset-wind3';
import { defineConfig } from 'unocss';
import presetAnimations from 'unocss-preset-animations';
import { presetShadcn } from 'unocss-preset-shadcn';

export default defineConfig({
	extractors: [extractorSvelte()],
	presets: [presetWind({ preflight: false }), presetAnimations(), presetShadcn()],
	shortcuts: {
		// Buttons
		btn: 'py-2 px-4 font-semibold rounded-lg shadow-md transition-colors',
		'btn-primary': 'btn bg-primary text-primary-foreground hover:bg-primary/90',
		'btn-secondary': 'btn bg-secondary text-secondary-foreground hover:bg-secondary/80',
		'btn-destructive': 'btn bg-destructive text-destructive-foreground hover:bg-destructive/90',

		// Cards
		'card-base': 'rounded-lg border bg-card text-card-foreground shadow-sm',

		// Status indicators (Requirement 22.4)
		'status-healthy': 'bg-green-500 text-white',
		'status-degraded': 'bg-yellow-500 text-black',
		'status-unhealthy': 'bg-red-500 text-white',
		'status-offline': 'bg-gray-500 text-white',

		// Layout
		'page-container': 'container mx-auto p-4 md:p-6',
		'sidebar-item': 'flex items-center gap-2 px-3 py-2 rounded-md hover:bg-accent transition-colors'
	}
});
