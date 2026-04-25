<div align="center">
  <img src="public/comradarr-icon.svg" alt="Comradarr Icon" width="240" height="240" />

# Comradarr (WIP)

[![License](https://img.shields.io/badge/License-AGPL%203.0-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-1.0%2B-FBF0DF?logo=bun&logoColor=black)](https://bun.sh)
[![SvelteKit](https://img.shields.io/badge/SvelteKit-2.x-FF3E00?logo=svelte&logoColor=white)](https://kit.svelte.dev)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15%2B-336791?logo=postgresql&logoColor=white)](https://www.postgresql.org/)

</div>

A media library completion service that integrates with \*arr applications (Sonarr, Radarr, Whisparr) to systematically identify and request missing or upgradeable content.

> Phase 0 (Foundations) is the active milestone. Runtime backend code lands in
> Phase 1; the frontend is scaffold-only until Phase 14. See
> [`docs/comradarr-implementation-plan.md`](docs/comradarr-implementation-plan.md)
> for the full phase plan.

## Documentation

- [Product Requirements (PRD)](docs/comradarr-prd.md)
- [Implementation plan](docs/comradarr-implementation-plan.md)
- [Contributing guide](CONTRIBUTING.md)
- [Changelog](CHANGELOG.md)

## Prerequisites

- Python 3.14.x (see [`.tool-versions`](.tool-versions))
- Bun 1.3.x (see [`.tool-versions`](.tool-versions) and `frontend/package.json#engines.bun`)
- uv (see [`.tool-versions`](.tool-versions))
- prek (`uv tool install prek`)

## Build, dev, test

### Backend

```sh
cd backend
uv sync --frozen        # install locked deps
uv run ruff check .
uv run ruff format --check .
uv run basedpyright
../tools/lint/run-pip-audit.sh
```

### Frontend

```sh
cd frontend
bun install --frozen-lockfile
bun run dev             # local dev server
bun run build           # production build
bun run check           # svelte-check
bun run lint            # biome
bun test                # bun test
bun run gen:api         # regenerate OpenAPI types (requires backend running)
```

### Repo-wide

```sh
prek run --all-files
tools/lint/check-bun-pin-parity.sh
```

## Definition of Done — Phase 0

A third-party deterministic "Phase 0 done" check (plan §5):

```sh
git clone <repo> && cd <repo>
prek run --all-files                                                                              # exits 0
( cd backend && uv sync --frozen && uv run ruff check . && uv run ruff format --check . && uv run basedpyright && ../tools/lint/run-pip-audit.sh )            # exits 0
( cd frontend && bun install --frozen-lockfile && bun run check && bunx tsc --noEmit && bun run lint && bun test )                                            # exits 0
tools/lint/check-bun-pin-parity.sh                                                                # exits 0
# OPENAPI_URL is *imported* by gen-api.ts (not just mentioned) — match the import statement, not a substring:
grep -E "import\s*\{[^}]*\bOPENAPI_URL\b[^}]*\}\s*from\s*['\"]\./openapi-url(\.js)?['\"]" frontend/scripts/gen-api.ts   # exits 0
# `tsc --noEmit` with `verbatimModuleSyntax: true` (tsconfig.json) is the type-checked backstop: an unused import would error.
```

`pip-audit` is wrapped in `tools/lint/run-pip-audit.sh` because the editable
local package + an unfixable transitive CVE in pip 26.0.1 make the bare
`uv run pip-audit --strict` invocation incompatible with the current toolchain.
See `docs/comradarr-implementation-plan.md` §3.1 for the documented deviation
and follow-up F-11 for the unwinding plan.

## License

[AGPL-3.0-or-later](LICENSE).
