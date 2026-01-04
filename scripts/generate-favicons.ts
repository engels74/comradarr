/**
 * Generate PNG favicons from the simplified SVG favicon.
 * Run with: bun run scripts/generate-favicons.ts
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const faviconSvg = readFileSync(join(import.meta.dir, '../static/favicon.svg'), 'utf-8');

const sizes = [
	{ name: 'favicon-16x16.png', size: 16 },
	{ name: 'favicon-32x32.png', size: 32 },
	{ name: 'apple-touch-icon.png', size: 180 },
	{ name: 'android-chrome-192x192.png', size: 192 },
	{ name: 'android-chrome-512x512.png', size: 512 }
];

for (const { name, size } of sizes) {
	const resvg = new Resvg(faviconSvg, {
		fitTo: { mode: 'width', value: size },
		background: 'transparent'
	});
	const pngData = resvg.render();
	const pngBuffer = pngData.asPng();
	writeFileSync(join(import.meta.dir, '../static', name), pngBuffer);
	console.log(`Generated ${name} (${size}x${size})`);
}

console.log('All favicons generated!');
