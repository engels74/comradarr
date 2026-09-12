# Comradarr project guidance

Comradarr is planning-only. Read `README.md`, `docs/comradarr-prd.md` and
`docs/comradarr-implementation-plan.md` before implementation. Historical checked
tasks and example commands do not establish that application code or runtime
data exists in this checkout.

## Shared guidance and precedence

Use these shared files from `edbfi/agent-rules` when present:

- `.agents/rules/python-3_14-litestar-api.md` for the backend.
- `.agents/rules/svelte5-sveltekit-app.md` for the frontend.

This file and Comradarr's explicit architectural decisions take precedence over
generic recipes in those rules. In the implementation plan, the resolutions in
section 3.1 supersede older checklist instructions on the same topic. Shared
rule updates do not authorize changes to project requirements or toolchain
versions. Reconcile version choices explicitly when implementation begins;
the plan currently describes Bun 1.3.x and msgspec 0.20. Do not silently adopt
newer versions from rule examples, or restore historical vulnerability exceptions.

Keep shared files byte-identical to their canonical versions; record project
exceptions here instead of maintaining a separate copy of the shared rules.
Historical `.augment/rules` references are context, not another active ruleset.

## Project-specific decisions

- Backend: Python 3.14+, Litestar, direct Granian serving, msgspec schemas,
  SQLAlchemy 2.0 async with asyncpg, PostgreSQL 16+, and Alembic. Preserve the
  planned custom repository/service layers and pytest-asyncio test model.
  Generic Advanced Alchemy and GranianPlugin recipes do not replace those
  choices without a deliberate architecture change.
- Preserve the concern-flat backend layout and layering described in plan
  section 3.1. Use PEP 735 dependency groups rather than older uv dev-dependency
  examples. The OpenAPI JSON path is `/api/schema/openapi.json`.
- Frontend: SvelteKit 2, Svelte 5 runes, Bun and `svelte-adapter-bun`, UnoCSS
  with presetWind4 and unocss-preset-shadcn. Follow section 3.1's component
  vendoring/theme resolution; do not reintroduce the superseded Tailwind stub
  and shadcn CLI bootstrap merely because a generic recipe uses them.
- Python owns application/database logic. SvelteKit provides the SSR interface
  and same-origin API integration using the typed OpenAPI client and REST/SSE.
  The detailed deployment plan (section 5.24.1) calls for separate supervised
  Granian and Bun processes, plus bundled PostgreSQL unless an external database
  is configured. Do not interpret older static-file wording as Granian executing
  the Bun SSR frontend. Reconcile remaining contradictory deployment prose before
  implementing it.

## Review and checks

Preserve `prek.toml` and run `prek run --all-files` on a working branch for
content changes. Add application checks only when actual application code is
introduced. Do not configure branch protections, rulesets or automatic merging.
Review exact head/base, the full diff, authors/sign-offs, every expected CI job
and relevant artifacts before using the maintainer's reviewed `ghmerge` process;
verify the published tree and final CI afterwards.
