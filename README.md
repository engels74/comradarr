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

## Definition of Done — Phase 1

A third-party deterministic "Phase 1 done" check (plan §3 step 12):

```sh
prek run --all-files                                                                              # exits 0
( cd backend \
  && uv sync --frozen \
  && uv run ruff check . \
  && uv run ruff format --check . \
  && uv run basedpyright \
  && uv run pytest -q -n auto \
  && ../tools/lint/run-pip-audit.sh )                                                             # exits 0
( cd frontend && bun install --frozen-lockfile && bun run check && bunx tsc --noEmit && bun run lint && bun test )                                            # exits 0
tools/lint/check-bun-pin-parity.sh                                                                # exits 0
tools/lint/no_future_annotations.sh                                                               # exits 0
# Boot smoke: app factory builds under stub env (NO real Postgres required — stub DSN never connects)
( cd backend \
  && COMRADARR_SECRET_KEY="$(python -c 'import secrets; print(secrets.token_hex(32))')" \
     DATABASE_URL='postgresql+asyncpg://stub:stub@localhost:1/stub' \
     uv run python -c "from comradarr.app import create_app; app = create_app(); assert app is not None; print('boot ok')" )   # prints 'boot ok'
```

> **⚠️ Security warning — Phase 1 is NOT production-ready.**
> The Phase 1 backend skeleton binds `0.0.0.0:8000` with NO authentication and
> exposes the OpenAPI spec (`/api/schema`), Swagger UI (`/api/docs`), and ReDoc
> (`/api/redoc`) UNAUTHENTICATED. Do **NOT** expose this image to a non-loopback
> network until Phase 5's setup gate ships and Phase 4 wires up authentication.
> Setting `COMRADARR_RUN_MODE=dev` binds `127.0.0.1:8000` instead — use that
> mode for any local development against an untrusted LAN.

## Definition of Done — Phase 2

A third-party deterministic "Phase 2 done" check (plan §3 Milestone 12, phase-2 plan §6):

```sh
prek run --all-files                                                                              # exits 0
( cd backend \
  && uv sync --frozen \
  && uv run ruff check . \
  && uv run ruff format --check . \
  && uv run basedpyright \
  && ../tools/lint/run-pip-audit.sh )                                                             # exits 0
# Integration suite — needs a live Postgres 16. The CI service container in
# .github/workflows/integration.yaml exposes port 5432 with the `postgres`
# superuser; locally, follow `docs/runbook/postgres-roles.md` §"Local
# development setup" for the equivalent docker run command.
export TEST_DATABASE_URL='postgresql+asyncpg://postgres:postgres@localhost:5432/postgres'
( cd backend \
  && uv run pytest tests/ -n auto -m "not e2e" --deselect tests/db/test_e2e_boot.py -q \
  && uv run pytest tests/db/test_e2e_boot.py -n 0 -q )                                            # exits 0
# Alembic upgrade/downgrade roundtrip + autogenerate-clean check — covered by
# tests/db/test_alembic_baseline.py inside the suite above. The manual-stage
# `check-alembic-clean` prek hook (opt-in: `prek run --hook-stage manual
# check-alembic-clean`) gives developers a fast local equivalent.
( cd backend \
  && export DATABASE_URL="$TEST_DATABASE_URL" \
  && uv run alembic upgrade head \
  && uv run alembic downgrade base \
  && uv run alembic upgrade head )                                                                # exits 0
# `migrate` console-script smoke (plan §3 Milestone 9): runs the same
# pre-flight + alembic upgrade as the CLI subcommand, then exits 0.
( cd backend && uv run migrate )                                                                  # exits 0
```

> **Operator note — managed Postgres without CREATEROLE:**
> The v1 baseline migration creates three NOLOGIN roles (`comradarr_migration`,
> `comradarr_app`, `comradarr_audit_admin`) and applies a per-table GRANT matrix
> per PRD §8. On managed Postgres providers that deny `CREATEROLE` to the
> connect user (RDS, Cloud SQL, Heroku, Supabase, Neon), an operator with
> elevated credentials must pre-create the roles before `alembic upgrade head`.
> See [`docs/runbook/postgres-roles.md`](docs/runbook/postgres-roles.md) for the
> idempotent SQL block and the pre-flight check that converts mid-migration
> `InsufficientPrivilege` failures into a clear configuration error.

## License

[AGPL-3.0-or-later](LICENSE).
