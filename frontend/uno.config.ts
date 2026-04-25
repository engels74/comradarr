import presetWind4 from '@unocss/preset-wind4';
import { defineConfig } from 'unocss';
import { presetShadcn } from 'unocss-preset-shadcn';

export default defineConfig({
	presets: [presetWind4(), presetShadcn()]
});
