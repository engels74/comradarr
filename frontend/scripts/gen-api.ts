/**
 * Generates `src/lib/api/schema.d.ts` from the running Litestar OpenAPI
 * spec via openapi-typescript v7.
 *
 * Usage (developer + CI codegen step):
 *   bun run gen:api
 *
 * The Litestar dev server must be reachable at http://localhost:8000.
 * The URL path comes from `OPENAPI_URL` (single source of truth — see
 * `./openapi-url.ts`); the host/port are dev-environment defaults.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import openapiTS, { astToString } from 'openapi-typescript';

import { OPENAPI_URL } from './openapi-url';

const HOST = process.env.COMRADARR_DEV_HOST ?? 'http://localhost:8000';
const OUTPUT = resolve(import.meta.dirname, '../src/lib/api/schema.d.ts');

async function main(): Promise<void> {
	const url = new URL(OPENAPI_URL, HOST);
	const ast = await openapiTS(url);
	const contents = astToString(ast);
	await mkdir(dirname(OUTPUT), { recursive: true });
	await writeFile(OUTPUT, contents, 'utf8');
	console.log(`Wrote ${OUTPUT} from ${url.href}`);
}

await main();
