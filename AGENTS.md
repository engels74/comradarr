# AGENTS.md

This file provides guidance to AI coding agents when working with code in this
repository.

## Repository status: specification only

`git ls-files` returns eleven files — two design documents, three vendored \*arr API specs,
two stack-rule files, `README.md`, an icon, `.gitignore`, and `renovate.json`. There is no
`backend/`, `frontend/`, `dev_cli/`, `pyproject.toml`, `package.json`, lockfile, `LICENSE`,
or `.github/`. Phase 0 of the implementation plan is unstarted.

- Nothing here builds, lints, or runs. Never report that you ran a build, test, or lint.
- Establish first whether the task is "scaffold Phase 0" or "edit the specification" — they
  are different jobs with different review bars.
- The README badges advertise TypeScript / Bun / SvelteKit and PostgreSQL 15, and omit the
  backend language. The backend is **Python 3.14 + Litestar** (PRD §4) and the PostgreSQL
  floor is **16** (plan §3.1). The badges are stale; the specs win.

## Source of truth and precedence

Three document sets govern this project. When they disagree, higher wins:

1. `.agents/rules/backend-dev-pro.md`, `.agents/rules/frontend-dev-pro.md` — hard `RULE-*` /
   `ANTI-*` gates, self-described as strict law. The plan states all work "strictly conforms".
2. `docs/comradarr-implementation-plan.md` — the newer document. It explicitly resolves PRD
   open questions and supersedes PRD wording (RFC 7807 → RFC 9457, `/schema/openapi.json` →
   `/api/schema`, backend package layout).
3. `docs/comradarr-prd.md` — architectural rationale and the reasoning behind each decision.

## Commands

No command below runs today. These are the invocations the specification commits to — use
exactly these when scaffolding Phase 0 or authoring CI, and do not substitute equivalents.

| Purpose | Command | Notes |
|---|---|---|
| Install backend deps | `uv sync --frozen` | in `backend/`; CI and prod both use `--frozen` |
| Install frontend deps | `bun install --frozen-lockfile` | in `frontend/` |
| Full static suite | `prek run --all-files` | identical to the CI fast lane |
| Lint / format (Python) | `uv run ruff check` / `uv run ruff format --check .` | ruff is also the formatter |
| Type-check (Python) | `uv run basedpyright` | `recommended` mode; findings are errors |
| Full test suite | `uv run pytest -q -n auto` | |
| Unit only | `uv run pytest tests/unit -n auto` | budgeted under 1s; fastest loop |
| Integration | `uv run pytest tests/integration -n auto` | needs a real PostgreSQL 16 |
| Single test file | `uv run pytest tests/unit/test_foo.py` | |
| Single test case | `uv run pytest -q -k <name>` | rules §13.1; `--lf` reruns last failures |
| Migrations | `uv run alembic upgrade head` | async env template (`RULE-MIGR-001`) |
| Vulnerability scan | `uv run pip-audit` / `bun audit` | high-severity findings block merge |
| Frontend gates | `bun run check` (svelte-check), `bunx biome ci`, `bunx tsc --noEmit` | |
| Frontend component tests | `bun run test` | Vitest browser mode + axe-core |
| Frontend pure-TS tests | `bun test src/lib/**/*.test.ts` | `bun:test`; not for Svelte components |
| Serve backend | `granian --interface asgi --host 0.0.0.0 --port 8000 --workers 1 --loop uvloop --log-access comradarr.app:app` | flag set fixed by `RULE-SRV-001` |

Once `dev_cli/` exists it becomes the entry point, with the surface pinned in plan §3:
`check / format / lint / typecheck / test / test-fast / db-up / db-down / migrate / pg /
regen-types / i18n extract / serve / record-fixture / replay-canary / snapshot-export /
snapshot-import`. `dev_cli check` must run exactly the CI fast lane so local-pass implies
CI-pass.

## Load-bearing invariants

- Backend and frontend share **no code**. The sole contract is the OpenAPI spec Litestar
  serves at `/api/schema` (JSON at `/api/schema/openapi.json`, Swagger at `/api/docs`, ReDoc
  at `/api/redoc`) — all authenticated and rate-limited to 10 req/hr/IP. Frontend
  `schema.d.ts` is generated from it and a CI gate fails on drift, so a response-schema change
  means regenerating types in the same commit.
- Background work (sync coordinator, rotation engine, Prowlarr health monitor) runs as
  `asyncio.TaskGroup` tasks inside the Litestar lifespan — not separate processes or workers.
  All their state persists in PostgreSQL so a crash resumes from stored fingerprints and
  `last_searched_at`.
- PostgreSQL is the only data store. No Redis, no message broker. Real-time updates flow
  through an in-process event bus into SSE; WebSockets are explicitly rejected (PRD §13).
- Backend layering (PRD §6) is one-directional: `api/` controllers (thin, no business logic)
  → `services/` → `repositories/` (all SQL) → `db/models/` (never exposed through the API).
  `connectors/` isolates the \*arr HTTP APIs; `core/` holds DB lifecycle, DI, event bus,
  crypto, auth, cursor encoding, and the exception hierarchy.

## Implementation decisions

| Situation | Use | Not |
|---|---|---|
| Serialization, validation, API schemas | msgspec Structs | Pydantic, dataclasses-as-API, TypedDict-as-API |
| Python deps and locking | `uv` with committed `uv.lock` | pip, poetry, pdm, hatch, conda |
| Frontend deps | `bun` with text `bun.lock` | npm, pnpm, yarn, binary `bun.lockb` |
| Logging | structlog with structured kwargs | stdlib `logging`; f-strings in event text or kwargs |
| Database URL | `postgresql+asyncpg://` | psycopg / psycopg2; bare `postgresql://` |
| SvelteKit adapter | `svelte-adapter-bun` | adapter-auto, adapter-node |
| shadcn-svelte components | `bunx shadcn-svelte@latest add <name>` | hand-pasted or vendored component sources |
| Error responses | RFC 9457 Problem Details | RFC 7807 citations (a CI grep gate rejects them in source) |
| Backend package layout | concern-flat `api/`, `services/`, `repositories/`, `db/` | `domain/<context>/` — rules §7's directory shape is waived for v1 by plan §3.1; its layering laws still bind |

## Critical gotchas

- **`from __future__ import annotations` is banned.** PEP 649 in Python 3.14 makes it dead
  weight. Ruff `FA100`/`FA102` plus a grep gate at `tools/lint/no_future_annotations.sh`
  enforce its absence; just omit the import.
- **Ruff's `S` category is enabled in full and errors the build** — `pickle`/`marshal`,
  `eval`/`exec`, `subprocess(shell=True)`, string-formatted SQL, `yaml.load` without a safe
  loader, md5/sha1 for security use. Where an exception is genuinely required write
  `# noqa: S### - <justification>`; an unjustified `# noqa` is itself a violation.
- **Secrets are `Secret[bytes]`, never `str`.** basedpyright `recommended` is what makes the
  wrapper load-bearing; `.expose()` may appear only at the single call site that hands the
  value to the consuming library.
- **The Granian target module is unresolved in the plan.** Plan §5.1.7 writes `app.main:app`,
  copied verbatim from the rules' generic `RECIPE-GRANIAN-RUN`; PRD §5 gives
  `comradarr.app:app`, which matches the actual package name. Use the PRD form and flag the
  plan's placeholder when you touch that task.
- **Git tags carry no `v` prefix** (`0.1.0`, not `v0.1.0`); the `v` appears only in
  human-facing release titles.
- **`prek.toml`, once added, blocks direct commits to `main`** via `no-commit-to-branch`.
  Current history commits straight to `main`; after Phase 0 lands, branch first.
- **Editing the specification:** both documents track work with `- [ ]` / `- [x]` checkboxes.
  Resolving an open question means flipping the box and rewriting the bullet to state the
  resolution inline (plan §3's resolved entries show the shape). Bullets carrying
  `[needs maintainer confirmation]` must not be silently decided.
- **`renovate.json` is fleet-wide standardized policy** (commit `b2104a4`). Do not add
  repo-local tweaks without the maintainer.

## Reference documents

- `.agents/rules/backend-dev-pro.md` — binding Litestar / Granian / msgspec / SQLAlchemy 2.0
  async / Python 3.14 law (1389 lines). Read the matching §0.1 index row and the cited
  `RULE-*` / `PATTERN-*` / `RECIPE-*` IDs before writing any Python — not the whole file.
- `.agents/rules/frontend-dev-pro.md` — binding SvelteKit 2 / Svelte 5 Runes / Bun / UnoCSS /
  shadcn-svelte law (956 lines). Same §0.1 index discipline. Read before any frontend work.
- `docs/comradarr-implementation-plan.md` — read the §5.x subsection for the phase you are
  implementing, §7.3 before sequencing anything, §8 before claiming a workstream done.
- `docs/comradarr-prd.md` — read the numbered section for the subsystem you are touching:
  §7 connectors and SSRF defenses, §8 data model, §9–11 sync/rotation/budget, §15–16 auth and
  HTTP hardening, §19 configuration surface, §22 testing, §23 supply chain, Appendix A backend
  tree, Appendix B database schema.
- `docs/api-docs/{sonarr,radarr,prowlarr}-api-docs.json` — vendored upstream OpenAPI specs
  (GPL-3.0), read-only reference for connector msgspec models. Refresh by re-downloading from
  upstream; never hand-edit.
