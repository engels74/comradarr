# Contributing to Comradarr

Thanks for your interest in contributing. Comradarr is in early development; the contribution surface will expand as the project matures. This stub captures the Phase 0 essentials.

## Prerequisites

- Python 3.14.x (see `.tool-versions`)
- Bun 1.3.x (see `.tool-versions` and `frontend/package.json#engines.bun`)
- uv (see `.tool-versions`)
- prek (`uv tool install prek`)

## Local development

### Backend

```sh
cd backend
uv sync --frozen
uv run ruff check .
uv run ruff format --check .
uv run basedpyright
uv run pytest -q
../tools/lint/run-pip-audit.sh
```

### Frontend

```sh
cd frontend
bun install --frozen-lockfile
bun run check
bunx tsc --noEmit
bun run lint
bun test
```

### Repo-wide

```sh
prek run --all-files
tools/lint/check-bun-pin-parity.sh
```

## Pre-commit hooks

Comradarr uses [`prek`](https://prek.j178.dev/configuration/) for pre-commit
enforcement. `prek install` registers the hooks once per clone.

The frontend block (`svelte-check`, `tsc --noEmit`) uses `always_run = true` —
these hooks fire unconditionally and assume `frontend/` exists. Phase 0 lands
`frontend/` atomically with `prek.toml`. If a future contributor runs `prek run
--all-files` against a sparse-checkout that excludes `frontend/`, those hooks
will fail; treat that as the contributor's checkout problem, not a hook bug.
Follow-up F-7 re-evaluates if backend-only sparse-checkouts become supported.

## Bun pin parity

Bun's runtime range is pinned in three places that must agree:

- `frontend/bunfig.toml` — comment naming the runtime range
- `frontend/package.json` — `engines.bun`
- `.tool-versions` — `bun` line

`tools/lint/check-bun-pin-parity.sh` enforces this; it is wired into `prek.toml`
as a project-local hook (Refinement #4).
