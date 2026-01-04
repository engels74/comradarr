import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import adapter from 'svelte-adapter-bun';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),

	kit: {
		adapter: adapter({
			out: 'build',
			precompress: true,
			envPrefix: ''
		}),
		alias: {
			$components: 'src/lib/components',
			$server: 'src/lib/server'
		}
	}
};

export default config;
