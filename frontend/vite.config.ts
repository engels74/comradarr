import { sveltekit } from '@sveltejs/kit/vite';
import UnoCSS from 'unocss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	// UnoCSS MUST be registered before sveltekit() per RULE-UNO-001 / docs.
	plugins: [UnoCSS(), sveltekit()]
});
