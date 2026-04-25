/**
 * Single source of truth for the Litestar OpenAPI spec URL.
 *
 * Deviation from RECIPE-OAPI-CLIENT default `/schema/openapi.json`:
 * implementation plan §5.1.4 mounts the controller at `/api/schema` —
 * see `docs/comradarr-implementation-plan.md` §3.1
 * "RECIPE-OAPI-CLIENT URL override" entry.
 *
 * All consumers (including `gen-api.ts`) MUST import this constant
 * rather than hardcode the path. `tsconfig.json` sets
 * `verbatimModuleSyntax: true`, so an unused import surfaces as a
 * type error at `tsc --noEmit` time.
 */
export const OPENAPI_URL = '/api/schema/openapi.json' as const;
