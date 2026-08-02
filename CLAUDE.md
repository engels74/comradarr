# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Status

This repository is **specification-only**. `git ls-files` returns eleven files: two design documents, three vendored API specs, two stack-rule files, a README, an icon, `.gitignore`, and `renovate.json`. There is no application source, no `pyproject.toml`, no `package.json`, no lockfiles, no `LICENSE`, and no `.github/`. Phase 0 of the implementation plan is unstarted.

Consequences:

- Nothing here is executable. Do not report that a build, lint, or test was run.
- Before writing code, establish whether the task is "scaffold Phase 0" or "edit the specification" — they are different jobs with different review expectations.
- The README's License badge links to a `LICENSE` file that does not exist yet; adding AGPL-3.0 is plan task §5.0.1.

## Source of Truth and Precedence

Three document sets govern this project. When they disagree, higher wins:

1. `.augment/rules/backend-dev-pro.md` and `.augment/rules/frontend-dev-pro.md` — hard `RULE-*` / `ANTI-*` gates, self-described as strict law. The plan states all work "strictly conforms" to them.
2. `docs/comradarr-implementation-plan.md` — the newer document. It explicitly resolves PRD open questions and supersedes PRD wording (RFC 7807 → RFC 9457, `/schema/openapi.json` → `/api/schema`, backend package layout).
3. `docs/comradarr-prd.md` — architectural rationale and the reasoning behind each decision.

Both rules files are large (1389 and 956 lines). Each opens with a "How to Search This Document" index mapping a task to a section — use it and read the matching `RULE-*` / `PATTERN-*` / `RECIPE-*` IDs instead of the whole file.

## Essential Commands

No command in this table runs today. These are the canonical invocations the specification commits to — use exactly these when scaffolding Phase 0 or authoring CI, and do not substitute equivalents.

| Purpose | Command | Notes |
|---|---|---|
| Install backend deps | `uv sync --frozen` | in `backend/`; CI and production both use `--frozen` |
| Install frontend deps | `bun install --frozen-lockfile` | in `frontend/` |
| Full static suite | `prek run --all-files` | identical to the CI fast lane |
| Lint / format (Python) | `uv run ruff check` / `uv run ruff format --check` | ruff is also the formatter |
| Type-check (Python) | `uv run basedpyright` | `recommended` mode; findings are errors |
| Full test suite | `uv run pytest -n auto` | |
| Unit only | `uv run pytest tests/unit -n auto` | budgeted at under 1s; fastest loop |
| Integration | `uv run pytest tests/integration -n auto` | needs a real PostgreSQL 16 instance |
| Vulnerability scan | `uv run pip-audit` / `bun audit` | high-severity findings block merge |
| Frontend gates | `bunx biome ci`, `bunx svelte-check --threshold warning`, `bunx tsc --noEmit` | |
| Frontend tests | `bun test` | Vitest browser mode + axe-core |
| Serve backend | `granian --interface asgi --host 0.0.0.0 --port 8000 --workers 1 --loop uvloop --log-access <target>` | flag set is fixed by `RULE-SRV-001` |

Once `dev_cli/` exists it becomes the entry point, with the command surface pinned in plan §3 (`check`, `format`, `lint`, `typecheck`, `test`, `test-fast`, `db-up`, `db-down`, `migrate`, `pg`, `regen-types`, `i18n extract`, `serve`, `record-fixture`, `replay-canary`, `snapshot-export`, `snapshot-import`). `dev_cli check` must run exactly the CI fast lane so a local pass implies a CI pass.

Per-file and per-test selection is not pinned by any repository document; only the suite-level invocations above are specified.

## Architecture Overview

Comradarr is a single-container service that continuously rotates every item in a Sonarr/Radarr library through search, mirroring *arr state in PostgreSQL.

Planned monorepo layout (PRD §5, Appendix A): `backend/` (uv package `comradarr`, src layout), `frontend/` (SvelteKit, deferred), `dev_cli/` (uv package, not shipped), `shared/` (OpenAPI spec + generated types), `docs/`, `.github/`.

Backend layers, with dependencies flowing strictly inward (PRD §6): `api/` controllers (thin — no business logic) → `services/` (sync engine, rotation engine, budget, Prowlarr health) → `repositories/` (all SQL, generic `Repository[T]`) → `models/` (SQLAlchemy, never exposed through the API). `connectors/` isolates the *arr HTTP APIs; `core/` holds DB lifecycle, DI, event bus, crypto, auth, cursor encoding, and the exception hierarchy.

Load-bearing runtime relationships:

- Backend and frontend share **no code**. The sole contract is the OpenAPI spec Litestar serves at `/api/schema`, from which frontend TypeScript types are generated. Changing a response schema means regenerating `schema.d.ts`; a CI gate fails on drift.
- Background work (sync coordinator, rotation engine, Prowlarr health monitor) runs as `asyncio.TaskGroup` tasks inside the Litestar lifespan — not separate processes or workers. All their state persists in PostgreSQL, so a crash resumes from stored fingerprints and `last_searched_at`.
- PostgreSQL is the only data store. No Redis, no message broker.
- Real-time updates flow through an in-process event bus into SSE. WebSockets are explicitly rejected (PRD §13).

## Project Boundaries

| Path | Status |
|---|---|
| `docs/api-docs/*.json` | Vendored upstream OpenAPI specs (Sonarr, Radarr, Prowlarr; GPL-3.0). Read-only reference for writing connector msgspec models. Refresh by re-downloading from upstream — never hand-edit. |
| `.augment/rules/*.md` | Binding stack law (see precedence above). Change only when the maintainer changes the stack. |
| `docs/comradarr-prd.md`, `docs/comradarr-implementation-plan.md` | The specification. Edits are product and architecture decisions, not chores. |
| `renovate.json` | Standardized fleet-wide policy (commit `b2104a4`). Do not add repo-local tweaks without the maintainer. |

## Common Change Workflows

**Editing the specification.** Both documents use `- [ ]` / `- [x]` checkboxes as their tracking mechanism. To resolve an open question in plan §3, flip the box and rewrite the bullet to state the resolution inline — the resolved entries for "OpenAPI spec source location" and "Bun lockfile format" show the established shape. Bullets carrying `[needs maintainer confirmation]` must not be silently decided.

**Scaffolding Phase 0.** Plan §5.0 is the ordered checklist: `uv init comradarr --build-backend uv_build` inside `backend/`, `bun create svelte@latest frontend`, `prek.toml` copied verbatim from PRD §23, then `.github/workflows/ci.yaml` running `prek run --all-files` plus `pip-audit`. Do not improvise a different toolchain.

**Sequencing later work.** Plan §7.3 is a hard dependency graph: auth depends on crypto; the setup wizard depends on auth plus HTTP-boundary middleware; rotation depends on sync; every frontend phase depends on the API layer's OpenAPI surface. Plan §8 is the Definition of Done.

## Implementation Decisions

| Situation | Use | Avoid |
|---|---|---|
| Serialization, validation, API schemas | msgspec Structs | Pydantic, dataclasses-as-API, TypedDict-as-API |
| Python dependencies and locking | `uv` with committed `uv.lock` | pip, poetry, pdm, hatch, conda |
| Frontend dependencies | `bun` with text `bun.lock` | npm, pnpm, yarn, binary `bun.lockb` |
| Logging | structlog with structured kwargs | stdlib `logging`; f-strings in event text or kwargs |
| Database driver URL | `postgresql+asyncpg://` | psycopg / psycopg2; bare `postgresql://` |
| SvelteKit adapter | `svelte-adapter-bun` | adapter-auto, adapter-node |
| Error responses | RFC 9457 Problem Details | RFC 7807 citations (PRD prose is stale; a CI grep gate rejects them in source) |
| Backend package layout | concern-flat `api/`, `services/`, `repositories/`, `db/` | `domain/<context>/` nesting — rules §7's directory shape is waived for v1 in plan §3.1, though its layering laws still bind |

## Critical Gotchas

- **`from __future__ import annotations` is banned.** PEP 649 in Python 3.14 makes it dead weight. Ruff `FA100`/`FA102` plus a grep gate at `tools/lint/no_future_annotations.sh` enforce its absence; just omit it.
- **Ruff's `S` category is enabled in full and errors the build.** `pickle`/`marshal`/`shelve`, `eval`/`exec`, `subprocess(shell=True)`, string-formatted SQL, `yaml.load` without a safe loader, and md5/sha1 for security use are all banned. Where an exception is genuinely required, write `# noqa: S### - <justification>`; an unjustified `# noqa` is itself a project violation.
- **Secrets are `Secret[bytes]`, never `str`.** basedpyright `recommended` is what makes the wrapper load-bearing — `.expose()` may appear only at the single call site that hands the value to the consuming library.
- **Git tags carry no `v` prefix** (`0.1.0`, not `v0.1.0`); the `v` appears only in human-facing release titles.
- **The Granian target module is unresolved.** Plan §5.1.7 writes `app.main:app`, copied verbatim from the rules' generic `RECIPE-GRANIAN-RUN`; PRD §5 gives `comradarr.app:app` for this package. The PRD form matches the actual package name — use it, and flag the plan's placeholder when you touch that task.
- **`prek.toml`, once added, blocks direct commits to `main`** via `no-commit-to-branch`. Current history commits straight to `main`; after Phase 0 lands, branch first.

## Additional Documentation

- `docs/comradarr-implementation-plan.md` — Read the §5.x subsection for the phase you are implementing, §7.3 before sequencing, and §8 before claiming a workstream done.
- `docs/comradarr-prd.md` — Read the numbered section for the subsystem you are touching: §7 connectors and SSRF defenses, §8 data model, §9–11 sync/rotation/budget, §15–16 auth and HTTP hardening, §19 configuration surface, §22 testing, §23 supply chain, Appendix A backend tree, Appendix B database schema.
- `.augment/rules/backend-dev-pro.md` — Read the matching §0.1 index row before writing any Python.
- `.augment/rules/frontend-dev-pro.md` — Read before any SvelteKit, Svelte 5 Runes, UnoCSS, or shadcn-svelte work.
- `docs/api-docs/sonarr-api-docs.json`, `radarr-api-docs.json`, `prowlarr-api-docs.json` — Read when writing or correcting connector request/response models.
