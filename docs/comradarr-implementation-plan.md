# Comradarr — Comprehensive Implementation Plan

## 1. Title and Objective

**Title:** Comradarr v0.1.0 implementation plan.

**Objective:** Deliver a single-container, self-hosted rotation/orchestration layer over Sonarr, Radarr, and (optionally) Prowlarr that continuously cycles every library item through search, mirrors *arr state in PostgreSQL, ships with a setup wizard, three authentication providers, an audit log, a notification system, an SSE-driven SvelteKit frontend, and the supply chain / observability / deployment posture documented in `docs/comradarr-prd.md` (sections 1–30 + appendices A–C). All work strictly conforms to `.augment/rules/backend-dev-pro.md` (Litestar 2.x / Granian 2.x / msgspec 0.20 / SQLAlchemy 2.0 async / Python 3.14+ / structlog / uv / ruff / basedpyright recommended) and `.augment/rules/frontend-dev-pro.md` (SvelteKit 2 + Svelte 5 Runes, **Bun 1.3.x runtime with `bun.lock` text-format lockfile floor of Bun 1.2** per RULE-BUN-001..004, UnoCSS presetWind4, unocss-preset-shadcn, shadcn-svelte 1.1.x, openapi-typescript + openapi-fetch, Biome 2.4.x, svelte-adapter-bun).

---

## 2. Scope Summary

- [ ] Backend monorepo package `comradarr` under `backend/src/comradarr/` (PRD Appendix A) implemented as a Litestar 2.x ASGI app served by Granian, with SQLAlchemy 2.0 async + asyncpg over PostgreSQL 16+, Alembic migrations, and msgspec everywhere on the API boundary.
- [ ] Connector subsystem covering Sonarr, Radarr, and Prowlarr with SSRF defenses, hostile-response defenses, normalized error model, recorded-fixture test approach, and per-connector TLS toggles.
- [ ] Sync engine (full / deep / incremental) with three-tier scheduling, fingerprint diffing, and idempotent appliers writing to mirror tables.
- [ ] Rotation engine with tier-based priority, planner protocol per arr type, dispatcher, tracker, budget abstraction (default + Prowlarr), and priority search bypass.
- [ ] Three authentication providers (local Argon2id + trusted-header + OIDC with mandatory PKCE), unified session model, persistent rate limits, API keys with scopes, audit log with role-separated DB privileges, AES-256-GCM field encryption with key versioning, and master-key denylist.
- [ ] Setup wizard with bootstrap-token + setup-claim cookie + admin-session three-credential bootstrap, three wizard phases (claim, HTTP boundary verification, admin account), and CSRF-exempt bootstrap claim only.
- [ ] HTTP boundary hardening: trusted proxy chain, public origin, allowed origins, allowed hosts, CORS, Origin/Referer CSRF validation, security headers, CSP, cookie attributes.
- [ ] In-process event bus + SSE endpoint feeding the dashboard.
- [ ] Notification system: apprise + webhook channels, template engine (`{{var}}` + `{{#if}}`), per-user routes, coalescing window, gettext integration.
- [ ] Frontend SvelteKit 2 + Svelte 5 Runes app shell with Northern Lights theme, sidebar layout, dashboard, content browser at scale (cursor pagination + virtual scrolling), connectors, settings, audit log, notifications, i18n via Weblate, WCAG 2.2 AA.
- [ ] Observability: structured logging (structlog), Prometheus `/metrics` (opt-in), OpenTelemetry traces (opt-in), `/health`, traceback hygiene, log redaction.
- [ ] RFC 9457 Problem Details error model end-to-end (per backend rules `RULE-API-002`; supersedes the obsoleted RFC 7807 wording carried in PRD §17 / §21 / Glossary — the on-the-wire shape is identical, the citation IETF tracks RFC 9457 since July 2023; PRD wording will be reconciled in a follow-up doc pass).
- [ ] Import/export: passphrase-encrypted snapshot via Argon2id + AES-256-GCM.
- [ ] Supply chain: `uv.lock` + `bun.lock` frozen installs, vulnerability scanning, code-level bans via ruff `S`, `prek` pre-commit using `prek.toml`, Biome + svelte-check + tsc.
- [ ] Single Docker image bundling Granian + pre-built SvelteKit assets + supervised PostgreSQL, with `DATABASE_URL` override path.
- [ ] AGPL-3.0 licensing, semver release tags (no `v` prefix on git tags), Weblate i18n integration.
- [ ] Comprehensive test suite: unit + property-based, integration with real Postgres, fixture-based connector tests with nightly canary, API tests with Litestar `AsyncTestClient`, frontend component + a11y tests.

Out of scope for v1 (explicitly captured for backlog): command palette (Cmd+K), Playwright E2E, mutation testing, partial import, optional pre-upgrade automatic backup, multi-role assignment UI, hash-chain audit tamper-evidence, custom icons.

---

## 3. Assumptions and Open Questions

- [ ] **Repo layout.** Assume the monorepo root contains `backend/` (PRD Appendix A) and `frontend/` (PRD §25 / frontend rules §7) as siblings, with `dev_cli/` (PRD §5) at the root. `[needs maintainer confirmation]` before scaffolding.
- [x] **OpenAPI spec source location.** Resolved per §5.1.4 / §5.13.4: Litestar's OpenAPI controller is mounted at `/api/schema` (JSON spec at `/api/schema/openapi.json`, Swagger UI at `/api/docs`, ReDoc at `/api/redoc`). All three routes are authenticated (no schema discovery before auth — PRD §15 / §16) and rate-limited at 10 req/hr/IP. The `/api/schema` prefix supersedes the earlier `/schema/openapi.json` placement; consume from this location everywhere (frontend rules `RULE-OAPI-001`).
- [x] **Frontend i18n library.** Resolved: **Paraglide (`@inlang/paraglide-js-adapter-sveltekit`)** is the chosen library — cleaner Svelte 5 Runes integration, per-message tree-shaking, and SSR locale resolution match the rest of the frontend stack. `svelte-i18n` is the documented fallback if Paraglide upstream stalls; revisit only on a Paraglide-specific blocker. PRD §28 wording reconciled in this plan.
- [ ] **`uv` version pin.** Backend rules pin `>=0.11,<0.12`. Confirm the exact 0.11.x to install via `uv self update` in CI. `[needs maintainer confirmation]`
- [x] **Bun lockfile format.** Resolved: text `bun.lock` (default since Bun 1.2) with `bun install --frozen-lockfile` for CI (backend rules canonical).
- [x] **shadcn-svelte CLI under UnoCSS workaround.** Resolved: per `RULE-SHADCN-002`, an empty `tailwind.config.js` stub is committed at the frontend root and excluded from Biome formatting via `biome.json` overrides.
- [x] **PostgreSQL major version inside the bundled image.** Resolved: PostgreSQL 16.x is the supported floor per PRD §24; the Dockerfile pins to 16.x.
- [x] **Granian worker count.** Resolved per PRD §24: single worker, single threaded, uvloop, 6h worker lifetime; no operator override in v1.
- [ ] **Telemetry library choices.** PRD §29 mentions Prometheus + OTLP. Assume `prometheus_client` for metrics and `opentelemetry-distro` + `opentelemetry-exporter-otlp` (OTLP-HTTP) for traces. `[needs maintainer confirmation]`
- [ ] **Encryption key denylist source.** PRD §15 references a weak-value denylist; assume an embedded list of 100–500 known-bad keys plus refusing all-zeros / all-FF / repeating-byte patterns. Corpus source `[needs maintainer confirmation]`.
- [x] **Apprise version.** Resolved: pin to >=1.9 (BSD-2-Clause; AGPL-compatible per PRD §14).
- [x] **OpenAPI annotations on Litestar.** Resolved: `litestar.openapi.OpenAPIController` is exposed; the setup-gate middleware allowlists `/schema`, `/api/schema`, `/api/docs`, `/api/redoc` (cross-ref §5.1.4 + §5.13.4).
- [x] **Renovate vs. Dependabot.** Resolved: Renovate (richer grouping rules; better fit for `uv.lock` + `bun.lock` + workflow files).
- [x] **Trusted-header role claim.** Resolved per PRD §26: in v1 ignore `X-Comradarr-Role` but reserve the schema column for post-v1.
- [x] **Friendly install name.** Resolved per PRD §15 + §30: store `install_name` as a key/value row in the `app_config` table, defaulting to `comradarr`. The setup wizard's confirmation step writes the initial value; the post-setup settings UI exposes it for later editing. Used in snapshot filenames (`<install_name>-<ISO timestamp>.comradarr-snapshot`).
- [x] **Dev CLI command surface.** Resolved: canonical command set pinned at `dev_cli check / format / lint / typecheck / test / test-fast / db-up / db-down / migrate / pg / regen-types / i18n extract / serve / record-fixture / replay-canary / snapshot-export / snapshot-import` (cross-ref §5.24.3). The `dev_cli check` umbrella runs the same gates as the CI fast lane so local-pass implies CI-pass per PRD §23.
- [ ] **Rotation backoff vs Prowlarr indexer status.** PRD §11 references Prowlarr health driving budget; confirm whether disabled indexers should remove their share from the budget immediately or after a debounce. `[needs maintainer confirmation]`

### 3.1 Architectural decisions

- [x] **Architectural decision: flat package layout over `domain/<bounded_context>/`.** Backend rules §7 prescribes a domain-bundled structure (`domain/<context>/{controllers,services,repositories,schemas}.py`) and the layering rules in §7 (db knows nothing about Litestar; schemas are msgspec-only; controllers→services→repositories→db) remain binding. Comradarr v1 is a single bounded context with several cross-cutting subsystems (connectors, rotation, security, notifications). Bundling all subsystems under one `domain/comradarr/` directory adds a redundant nesting level without separation benefit. The plan therefore uses concern-flat packages — `comradarr/api/controllers/`, `comradarr/services/<subsystem>/`, `comradarr/repositories/`, `comradarr/connectors/`, `comradarr/db/{base,models}.py` — that preserve every §7 layering invariant while collapsing the single-context wrapper. This is a documented v1-scoped layout deviation from §7's directory shape only; the layering rules themselves are not relaxed. If a second bounded context is added post-v1, the layout migrates to `domain/<context>/` per §7.
- [x] **PostgreSQL major-version pin.** PRD §4 / §24 specify "PostgreSQL" without a major-version pin. Plan resolves this to PostgreSQL 16+ for v1 (matches the bundled image at §5.24.1). Pre-v1 sign-off should confirm 16 is the floor; downgrading to 15 would invalidate features used in v1 schema (e.g. `gen_random_uuid()` reliance, multirange types if used by future migrations, current-shape `jsonb_path_query` usage in the audit-log filter path). If no 16-only feature is in use at sign-off time, the floor may be lowered to 15 — but the bundled image stays on 16 either way to match the supported floor of the supported install path.
- [x] **RECIPE-OAPI-CLIENT URL override (also affects RULE-OAPI-001).** Implementation plan §5.1.4 mounts the Litestar OpenAPI controller at `/api/schema` (JSON spec at `/api/schema/openapi.json`). Both `RULE-OAPI-001` (frontend-dev-pro.md) and RECIPE-OAPI-CLIENT (frontend-dev-pro.md) reference the recipe-default `/schema/openapi.json`. The plan's `/api/` prefix supersedes the recipe path because Litestar's standard mount keeps the OpenAPI spec under the same `/api/` namespace as REST endpoints, simplifying setup-gate middleware allowlists and rate-limit policies (§5.1.4 lines 657-658). The single source of truth is `frontend/scripts/openapi-url.ts` exporting `OPENAPI_URL = '/api/schema/openapi.json'`; all consumers (including `gen-api.ts`) import it. Future bumps of either `RULE-OAPI-001` or `RECIPE-OAPI-CLIENT` must check this constant.
- [x] **shadcn-svelte CLI architectural conflict — components.json omitted in Phase 0.** Plan §5.0.3 step 4 / §4 line 364 calls for `frontend/components.json` (shadcn-svelte init result). shadcn-svelte 1.1's CLI hard-requires Tailwind CSS v4 ("This CLI version requires Tailwind CSS v4 and Svelte v5 to initialize a project."), which conflicts with our UnoCSS choice (§5.14 line 80 / RULE-UNO-001..003). Resolution: theming via `unocss-preset-shadcn` (already in devDependencies) plus a manually generated `frontend/src/app.css` whose `:root` and `.dark` blocks are merged from a vendored theme JSON (`frontend/themes/northern-lights.json`, sourced from tweakcn.com). No `components.json` and no `tailwind.config.js` stub are committed — both exist solely to support the shadcn-svelte CLI we cannot run. Future shadcn-svelte component additions are vendored manually (copy-paste with className-to-uno conversion) until/unless the upstream CLI gains a UnoCSS path.
- [x] **pip-audit wrapper for editable local pkg + CVE-2026-3219 suppression.** Plan §5.0.2 step 8 / line 145 specifies bare `uv run pip-audit --strict`. Two adaptations are baked into `tools/lint/run-pip-audit.sh` and called from CI (.github/workflows/ci.yml) and the Definition of Done in lieu of the bare invocation: (1) `uv sync` installs `comradarr` editable; `pip-audit --strict` rejects this with "Dependency not found on PyPI: comradarr 0.0.0", and `--skip-editable` still fails under `--strict`. The wrapper feeds `pip-audit` the resolved deps without the local project (`uv export --no-emit-project | pip-audit --strict --disable-pip --requirement /dev/stdin`); `--disable-pip` requires hashes which `uv export` supplies. (2) `--ignore-vuln CVE-2026-3219` suppresses an unfixable vulnerability in pip 26.0.1 (latest available; transitive of pip-audit via pip-api; no upstream fix at Phase 0 sign-off). F-11 in §7 tracks unwinding the suppression once a fixed pip ships.
- [x] **Backend dev-deps migrated to PEP 735 `[dependency-groups]`.** Plan §5.0.2 step 2 specifies `[tool.uv] dev-dependencies = [...]`. uv 0.11.7 emits a deprecation warning for that key and recommends the PEP 735 standard `[dependency-groups] dev = [...]`. Both forms are uv-managed dev groups; intent of `RULE-TOOL-001` (uv as sole package/lock manager) and `RULE-TOOL-002` (ruff `S` rules in dev tree) is preserved. The plan was authored before the deprecation; this entry records the syntactic migration.
- [x] **PRD §23 prek block monorepo adaptation.** Plan §5.0.4 step 1 specifies "verbatim from PRD §23 lines 1808-1844". The verbatim block assumes a flat repo (single `pyproject.toml` and single `package.json` at root); Comradarr's monorepo has neither at the root, so `uv run X` and `bunx X` fail to resolve their config when prek invokes them from the repo root (basedpyright errors with "No such file or directory"; tsc dumps its --help text and exits non-zero). Each backend hook is wrapped as `bash -c 'cd backend && uv run X'` and each frontend hook as `bash -c 'cd frontend && bunx X'`. Hooks that previously had `pass_filenames = true` (`ruff-lint`, `ruff-format`, `biome-check`) are switched to `pass_filenames = false` because prek passes paths relative to the repo root (e.g. `backend/src/foo.py`) which would not resolve under the per-block cwd; an `^backend/` / `^frontend/.*\.(...)$` `files` regex preserves scoping (the hook still triggers only when the relevant subtree changes, but operates on the whole subproject). The intent of the §23 hook list (ruff lint+format, basedpyright, uv-lock; biome-check, svelte-check, tsc) is preserved bit-for-bit; only the invocation shape adapts to the monorepo cwd contract.
- [x] **Phase 1 — TaskGroup deferral to Phase 9.** Plan §5.1.5 hints at `asyncio.TaskGroup` + `BaseExceptionGroup` handler registration in `services_lifespan`. Phase 1 ships only the bare `yield` plus `# Phase N:` slot comments because no background services exist yet; the TaskGroup wiring lands with the sync coordinator in Phase 9 (§5.9.4). The contract preservation is captured in the lifespan module's docstring.
- [x] **Phase 1 — `comradarr_log_dedup_per_minute` Settings field added.** PRD §19 does not enumerate this field, but the structlog dedup-throttle processor (PRD §20 / RECIPE-STRUCTLOG) needs a per-event token-bucket capacity that operators can tune. Default 100/min/event; configurable via `COMRADARR_LOG_DEDUP_PER_MINUTE`. Folded into `Settings` so logging configuration stays single-source.
- [x] **Phase 1 — `comradarr_run_migrations_on_startup` Settings field added.** Plan §5.1.5 / §5.2.3 expects a Phase 2-controlled flag for "run pending Alembic migrations during `db_lifespan` startup". Field added in Phase 1 (default False ⇒ guaranteed no-op) so the lifespan stub can short-circuit cleanly without forward-referencing a Phase 2 setting; Phase 2 lights up the actual migration runner behind the same flag.
- [x] **Phase 1 — `ConfigurationError` substituted for `RuntimeError` in `migrations/env.py`.** RECIPE-ALEMBIC-ASYNC raises `RuntimeError` for missing-DSN / offline-mode guards. Plan replaces it with `comradarr.errors.configuration.ConfigurationError` (Q3) so all pre-lifespan configuration failures share one exception type that operators can grep for; `ConfigurationError` deliberately is NOT a `ComradarrError` subclass because it has no HTTP semantics (raised before the app boots).
- [x] **Phase 1 — `fileConfig(config.config_file_name)` stripped from `migrations/env.py`.** RECIPE-ALEMBIC-ASYNC's stock template imports `from logging.config import fileConfig` and applies the `[loggers]/[handlers]/[formatters]` section of `alembic.ini`. RULE-LOG-001 makes structlog the sole logging owner, so the stdlib logging-config call is removed. `tests/test_alembic_env.py` asserts both the import and the call are absent.
- [x] **Phase 1 — `from __future__ import annotations` stripped from `migrations/env.py` (RULE-PY-002).** RECIPE-ALEMBIC-ASYNC's stock template ships the import; PEP 649 deferred-evaluation in Python 3.14 makes it dead weight, and `tools/lint/no_future_annotations.sh` would otherwise flag the file. Removed atomically with the env.py customization.
- [x] **Phase 1 — `EventName._PLACEHOLDER` member.** Plan §5.0.5 / §5.1 require `comradarr/core/events.py` to exist as a typed cross-stack event-name surface, but Phase 11 owns the actual enum population. A single `_PLACEHOLDER = '__placeholder__'` member is added so the enum class is non-empty (Python 3.14 `enum.StrEnum` rejects empty enums) and basedpyright can type-check downstream imports; Phase 11 removes the placeholder atomically with the first real `EventName` member. Modelled as `enum.StrEnum` (not the literal `class EventName(str, Enum)` from the plan AC) because ruff `UP042` flags the legacy form on Python 3.11+.
- [x] **Phase 1 — `__version__` literal pinned, not derived from `importlib.metadata`.** PRD §24 / plan §5.1.7 imply `__version__` should match `pyproject.toml [project].version`. Phase 1 ships a literal `__version__: str = '0.0.0'` (C5 burndown) instead of `importlib.metadata.version('comradarr')` because the metadata path requires the package to be installed (works under `uv run` but fails under `python -c "import comradarr"` from a source checkout). Phase 20 (Observability) may swap to the metadata path once the install posture is locked.
- [x] **Phase 1 — `tools/lint/no_future_annotations.sh` added (RULE-PY-002 enforcement).** Plan §5.0.2 specifies `from __future__ import annotations` audit via ruff `FA100`/`FA102`. The shell script is an additional gate that greps for the literal `from __future__ import` substring across `backend/src/comradarr/`, `backend/migrations/`, and `backend/tests/` so a contributor who silences `FA` locally still gets caught at CI / prek time. Wired into `prek.toml` and `.github/workflows/ci.yml`.
- [x] **Phase 1 — OpenAPI unauthenticated window (R6 / C7).** Phase 1 mounts the OpenAPI controller at `/api/schema`, `/api/docs`, `/api/redoc` with NO authentication and NO rate limit. Phase 4 (auth) and Phase 5 (setup gate) wire up the gates. The README DoD block carries a security warning calling this out and explicitly says NOT to expose Phase 1 to a non-loopback network until the gates ship; `COMRADARR_RUN_MODE=dev` binds 127.0.0.1:8000 as a local guardrail.
- [x] **Phase 1 — `migrate` console script deferred to Phase 2.** Plan §5.0.2 step 5 lists `migrate` in the `[project.scripts]` set. Phase 1 ships only `comradarr = "comradarr.__main__:main"` because there are no migration revisions in `migrations/versions/` yet (the baseline migration lands in Phase 2 / §5.2.3). The `migrate` script lands atomically with the baseline migration so the script doesn't point at a no-op for one phase.
- [x] **Phase 1 — `httpx[http2]` deferred to Phase 7.** Plan §5.0.2 / §5.7.1 implies `httpx[http2]` is part of the backend runtime deps. Phase 1 omits it because no connector code exists yet and pulling in `h2` + `hpack` early would inflate the dependency surface for zero callers. Added atomically with the SSRF-defended HTTP client in Phase 7.

---

## 4. Workstreams and Phases

Phases are ordered so each one's outputs unblock the next. Workstreams (B = Backend, F = Frontend, S = Shared, I = Infrastructure, Q = QA/CI) run in parallel within a phase where possible.

- [x] **Phase 0 — Foundations.** Repo scaffold, tooling, CI fast lane, `prek.toml`, lockfiles, license, license headers (S, I, Q).
- [x] **Phase 1 — Backend skeleton.** Litestar app factory, lifespan, settings, structlog, exceptions module, Problem Details handler, health endpoint, Alembic async env (B).
- [x] **Phase 2 — Database, roles, models.** Models for every table in Appendix B; Alembic baseline with migration / application / audit-admin GRANTs; UUIDv7 PK helper; encrypted-field Mapped types (B).
- [x] **Phase 3 — Crypto, Secret type, audit log primitives.** `Secret[T]` wrapper, msgspec hook, structlog redaction, AES-256-GCM service with key versioning + AAD, master-key validation + denylist, audit log writer, retention vacuum (B, S).
- [ ] **Phase 4 — Auth providers, sessions, API keys, rate limits.** LocalPasswordProvider (Argon2id), TrustedHeaderProvider, OIDCProvider with PKCE + JWKS cache + replay window, session model, API keys + scopes, persistent rate limits, login flow (B).
- [ ] **Phase 5 — Setup gate + bootstrap + setup wizard backend.** Setup gate middleware allowlist, bootstrap token printer + consumer, setup-claim cookie, admin account creation, wizard endpoints for HTTP boundary verification (B, S).
- [ ] **Phase 6 — HTTP boundary hardening.** Trusted proxy resolver, public origin canonicalization, CORS, allowed-hosts middleware, Origin/Referer CSRF (no cookie-based double-submit pattern — see §5.6.4 / PRD §16), security headers, CSP, cookie attributes (B, S).
- [ ] **Phase 7 — Connector subsystem.** SSRF + hostile-response HTTP client wrapper, URL classifier with three policies, per-connector TLS toggles, connector factory, connector model + repository, error normalization, base shapes (B).
- [ ] **Phase 8 — Sonarr / Radarr / Prowlarr clients.** msgspec models, typed client methods, Prowlarr indexer health mapper, recorded-fixture replay infrastructure (B, Q).
- [ ] **Phase 9 — Sync engine.** Fingerprint computation, three-tier sync (full / deep / incremental), differ, applier, sync coordinator background task, mappers per arr type with semantic validation, schedule writer that materializes `search_schedule` rows from the applied diff (B).
- [ ] **Phase 10 — Rotation engine.** Tier classifier, schedule reader, planner protocol + Sonarr/Radarr planners, budget protocol + default + Prowlarr resolvers, dispatcher, tracker, priority search consumer, rotation engine background loop (B).
- [ ] **Phase 11 — Event bus + SSE.** Typed in-process event bus, SSE controller with per-client backpressure, event filter for SSE-safe payloads (B, F).
- [ ] **Phase 12 — Notifications.** Notification channels (apprise + webhook) with test-before-commit, routes, templates with constrained engine, dispatcher with coalescing window, gettext catalog wiring, notification audit hooks (B, S).
- [ ] **Phase 13 — API layer.** Litestar Controllers for auth, connectors, content, search, sync, settings, OIDC providers, audit log, API keys, notifications, BFF view endpoints (dashboard, content, rotation, settings), cursor pagination util, search composition (B).
- [ ] **Phase 14 — Frontend foundations.** Bun + Vite + UnoCSS + presetWind4 + unocss-preset-shadcn, shadcn-svelte init, Northern Lights theme, app shell, sidebar, theme SSR, motion contract scaffold, OpenAPI client generation script, hooks.server.ts session validation, route groups (F, I).
- [ ] **Phase 15 — Frontend setup wizard.** Bootstrap claim screen, setup-claim cookie handling, HTTP boundary verification UI with proposed/observed/testing/committed states, admin account form (F).
- [ ] **Phase 16 — Frontend dashboard.** SSE store, tint-on-change, rotation heartbeat, dashboard load function, dashboard cards, BFF integration (F).
- [ ] **Phase 17 — Frontend content browser.** URL-driven filter/sort/search state, cursor pagination, TanStack Virtual, density rules, debounced search (F).
- [ ] **Phase 18 — Frontend connectors + settings + audit log + API keys + OIDC + notifications.** Test-driven configuration UI, paginated audit log, API key creation modal with one-time reveal, OIDC provider editor, notification channels & routes & templates UI (F).
- [ ] **Phase 19 — i18n + accessibility.** Backend gettext, frontend i18n adapter, locale selector, axe-core in component tests, focus management, reduced-motion guards, keyboard navigation (F, B, Q).
- [ ] **Phase 20 — Observability.** structlog production JSON, request logging policy, redaction processor, `/health` final, `/metrics` opt-in, OTLP opt-in, traceback hygiene (B).
- [ ] **Phase 21 — Import/export.** Snapshot export endpoint, snapshot import wizard backend, `.comradarr-snapshot` format, schema versioning, audit logging (B, F).
- [ ] **Phase 22 — Testing matrix.** Unit + property-based coverage, integration tests with real Postgres + role-permission tests, fixture-based connector tests + recording tool, API tests for every Problem Details code, frontend component tests with axe-core, nightly canary (Q).
- [ ] **Phase 23 — Supply chain hardening.** uv lock CI gate, pip-audit, Biome / svelte-check / tsc gates, prek.toml hooks, GitHub Actions tag pinning, Renovate config (Q, I).
- [ ] **Phase 24 — Deployment artifacts.** Docker image with bundled PostgreSQL, init script, dev CLI, Granian launch, secret-key handling, multi-arch build, SBOM, image-tag policy (I).
- [ ] **Phase 25 — Release prep.** Release notes, AGPL headers, docs site for API reference, contribution guidelines, license matrix, semver tagging policy in CI (S, I).

---

## 5. Detailed Implementation Tasks

### 5.0 Phase 0 — Foundations

#### 5.0.1 Repo scaffold

- [ ] Confirm monorepo layout: `backend/`, `frontend/`, `dev_cli/`, `docs/`, `.github/`, `prek.toml`, `LICENSE`, `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `Dockerfile`, `compose.example.yaml`.
- [ ] Initialize backend with `uv init comradarr --build-backend uv_build` inside `backend/` (PRD Appendix A header) producing `pyproject.toml`, `uv.lock`, `.python-version` (`3.14`), `src/comradarr/__init__.py`, and a `py.typed` marker. Pin `requires-python = ">=3.14"` (RULE-PY-001). Commit `uv.lock` and gate CI on `uv sync --frozen` per **RULE-TOOL-001** (uv is the only sanctioned package/lock manager — pip, poetry, hatch, pdm, conda are forbidden; `uv.lock` committed and CI runs `uv sync --frozen`).
- [ ] **`from __future__ import annotations` audit (RULE-PY-002).** Verify zero source files under `comradarr/` carry the import; PEP 649 deferred-evaluation in Python 3.14 makes the import unused. Both ruff `FA100`/`FA102` (configured below) and a project-local CI grep gate enforce absence — the grep runs even if a contributor disables `FA` locally and catches `from __future__ import` of any subset including `annotations`. The grep gate lives at `tools/lint/no_future_annotations.sh` and runs in `.github/workflows/ci.yaml`.
- [ ] Initialize frontend with `bun create svelte@latest frontend` then convert to the canonical layout in frontend rules §7 (`uno.config.ts`, `vite.config.ts`, `svelte.config.js` using `svelte-adapter-bun`, `components.json`, empty `tailwind.config.js`, `bunfig.toml`, `bun.lock`) per **RULE-BUN-001** (Bun is the only package manager; text `bun.lock` committed), **RULE-BUN-002** (CI uses `bun install --frozen-lockfile`), **RULE-BUN-003** (`bun run dev` / `bun run build`), **RULE-BUN-004** (`trustedDependencies` for required postinstall), **ANTI-ADAPTER-001** (`svelte-adapter-bun`; adapter-auto / adapter-node forbidden), **ANTI-LOCK-001** (binary `bun.lockb` from older Bun versions is forbidden — only the text `bun.lock` format from Bun ≥ 1.3 is committed; pre-commit rejects any `bun.lockb` artifact), and **ANTI-PM-001 / ANTI-PM-002** — npm, pnpm, and yarn are forbidden anywhere in the frontend, including lockfile fragments, `package-lock.json` / `pnpm-lock.yaml` / `yarn.lock` artifacts, scripts that invoke them, or CI steps that fall through to them. Pre-commit blocks committing any of those files; CI fails on their presence.
- [ ] Add LICENSE (AGPL-3.0) at the repo root and a license header note in CONTRIBUTING.md per PRD §23.
- [ ] Create `.gitignore` covering `__pycache__/`, `.venv/`, `node_modules/`, `dist/`, `build/`, `.svelte-kit/`, `*.comradarr-snapshot`, `coverage*`, `.DS_Store`, `.env*`.

#### 5.0.2 Backend tooling

- [ ] Add `[tool.ruff]` to `backend/pyproject.toml` with `target-version = "py314"`, `line-length = 100`, and `select = ["E","W","F","I","UP","B","C4","SIM","RET","TID","TC","FA","ASYNC","N","PTH","S"]` (PRD §23, ruff `S` category in full; `TC` is the modern Ruff name — the legacy `TCH` alias is deprecated). **`FA` enforces the absence of `from __future__ import annotations` per RULE-PY-002** — on a Python 3.14 target the import is unused (PEP 649 deferred-evaluation handles forward refs natively), so `FA100` / `FA102` warn whenever the import or its compatibility-only equivalents appear. `ASYNC` enforces async-correctness (RULE-ASYNC-001 / RULE-ASYNC-002); `N` enforces standard Python naming (PEP 8); `PTH` enforces `pathlib`-over-`os.path`. The full ruff toolchain pin lives in RULE-TOOL-002.
- [ ] Add `[tool.basedpyright]` with `typeCheckingMode = "recommended"`, `enableTypeIgnoreComments = false`, `pythonVersion = "3.14"` (RULE-TOOL-003). `recommended` mode is the enforcement surface for **RULE-PY-003** — `typing.Any`, untyped parameters, and untyped returns are reported as errors, not silently allowed; any `# pyright: ignore` requires a justification comment.
- [ ] Add `[tool.pytest.ini_options]` with `asyncio_mode = "auto"`, `asyncio_default_fixture_loop_scope = "session"` (RULE-TEST-001).
- [ ] Add Alembic config (`alembic.ini`) and run `uv run alembic init -t async migrations` to bootstrap the async env template (**RULE-MIGR-001** — async env, sync migrations are Reject; **RULE-DB-002** — engine URL must be `postgresql+asyncpg://…`).
- [ ] Add `uv run` script entries for: `check`, `format`, `lint`, `typecheck`, `test`, `test-fast`, `migrate`, `serve` (RECIPE-GRANIAN-RUN).

#### 5.0.3 Frontend tooling

- [ ] Add `biome.json` keyed to schema 2.4 with `recommended` rules + nursery `useSortedClasses` warn; configure ignore for generated `schema.d.ts`.
- [ ] Configure `uno.config.ts` with `presetWind4`, `presetShadcn` (from `unocss-preset-shadcn`), `extractorSvelte`, dark-mode class strategy.
- [ ] Configure `svelte.config.js` to use `svelte-adapter-bun` (ANTI-ADAPTER-001 — drop adapter-auto/node).
- [ ] Configure `vite.config.ts` with `UnoCSS()` placed before `sveltekit()` (RULE-UNO-001).
- [ ] Add `tsconfig.json` strict mode, `moduleResolution: "bundler"`, `verbatimModuleSyntax: true`.
- [ ] Add empty `tailwind.config.js` stub for the shadcn-svelte CLI (RULE-SHADCN-002).
- [ ] Run `bunx shadcn-svelte@latest init` and commit the generated `components.json` (RULE-SHADCN-001 — components are added via the current CLI; hand-pasted shadcn-svelte sources or vendored copies are forbidden). Subsequent components are added with `bunx shadcn-svelte@latest add <component>` and land under `src/lib/components/ui/<name>/` with the generated `index.ts` barrel; imports use the barrel path (e.g. `import * as Accordion from '$lib/components/ui/accordion'`). **`data-slot` attributes (Svelte 5 + shadcn-svelte ≥ next) are preserved on every generated primitive** — they are the styling and CSS-targeting hook tweakcn themes (Northern Lights) rely on; project code never strips or rewrites `data-slot` on shadcn primitives, and a project-local lint flags any wrapper that re-emits the primitive without forwarding `data-slot`.
- [ ] Install Northern Lights theme: `bunx shadcn@latest add https://tweakcn.com/r/themes/northern-lights.json` and commit the resulting `globals.css` plus token additions (PRD §25).
- [ ] Add scripts: `dev`, `build`, `preview`, `check` (svelte-check), `lint` (biome check), `format` (biome check --write), `gen-api` (openapi-typescript), `test` (vitest).

#### 5.0.4 Pre-commit and CI fast lane

- [ ] Author `prek.toml` matching PRD §23 verbatim (three `[[repos]]` blocks: builtin, backend, frontend) including ruff `S` category enforcement per **RULE-TOOL-LINT-001** (security-relevant findings — eval, exec, hardcoded passwords, weak crypto, request timeout, SSL verify-disable, etc. — block on commit; no `# noqa` without justified comment).
- [ ] Add `.github/workflows/ci.yaml` invoking `prek run --all-files` plus `uv run pip-audit` for vulnerability scanning (PRD §23) — these are the **RULE-TOOL-LINT-001** enforcement points: pre-commit catches author-time, CI catches author-bypass.
- [ ] Add `.github/workflows/integration.yaml` running integration tests with a PostgreSQL service container.
- [ ] Add `.github/workflows/canary.yaml` scheduled nightly to run fixture-canary tests against demo upstream instances.
- [ ] Pin every `uses:` to a concrete tag per PRD §23 (e.g., `actions/checkout@v6`); document the tag-pinning posture in CONTRIBUTING.md.
- [ ] Add Renovate (or Dependabot — confirm) config at `.github/renovate.json` with separate groups for security updates (auto-PR) vs. routine bumps (manual review).

#### 5.0.5 Foundational shared utilities

- [ ] Define cross-stack typed event names (e.g., `sync.completed`, `rotation.dispatched`) in `comradarr/core/events.py` so backend emit sites and frontend SSE subscribers stay aligned (PRD §13, §20).
- [ ] Establish `correlation_id` middleware skeleton (`comradarr/api/middleware/correlation.py`) bound to structlog contextvars (RULE-LOG-001 + PRD §21 instance field).

### 5.1 Phase 1 — Backend skeleton

#### 5.1.1 Settings (`comradarr/config.py`)

- [ ] Define `Settings(msgspec.Struct, frozen=True, kw_only=True)` capturing all environment variables in PRD §19: `comradarr_secret_key` (Secret bytes; loaded from env-only per **RULE-SEC-001** — no secrets in code, `pyproject.toml`, or logs), `database_url` (default points at the bundled PG socket; must use the `postgresql+asyncpg://…` driver URL per **RULE-DB-002** — psycopg / psycopg2 are Reject), `comradarr_insecure_cookies`, `comradarr_csp_report_only`, `comradarr_log_level`, `comradarr_log_format`, `comradarr_recovery_mode`, `comradarr_disable_local_login`, OIDC provider env names. (Backend §8.1, no pydantic-settings.)
- [ ] Enumerate the OIDC env-var pattern explicitly per provider short-name `<PROVIDER>` (PRD §15 lines 855, 865): `COMRADARR_OIDC_<PROVIDER>_CLIENT_ID`, `COMRADARR_OIDC_<PROVIDER>_CLIENT_SECRET_FILE` (Docker-secret path — value is the path; loader reads the file's contents and **wraps the bytes in `Secret[bytes]` immediately**, never holds the literal string in any settings field, never logs the path's contents, and never echoes the secret on a config validation failure — only the path is logged at startup), `COMRADARR_OIDC_<PROVIDER>_DISCOVERY_URL`, `COMRADARR_OIDC_<PROVIDER>_REDIRECT_URI`, `COMRADARR_OIDC_<PROVIDER>_SCOPES` (space-delimited; defaults to `openid email profile`), `COMRADARR_OIDC_<PROVIDER>_LINK_POLICY` with values `link` (default) and `require_separate`. The OIDC settings model holds the secret as `Secret[bytes]` per **RULE-SEC-001**; the `expose()` call happens at the single call site that hands the secret to `authlib`'s token-exchange request and nowhere else.
- [ ] Master-key versioning pattern (PRD §15 lines 1034, 1084): `COMRADARR_SECRET_KEY_FILE` (v1), `COMRADARR_SECRET_KEY_V2_FILE` (v2), `COMRADARR_SECRET_KEY_V3_FILE`, etc., parsed into the key registry with one entry per version; the inline-value forms (`COMRADARR_SECRET_KEY`, `COMRADARR_SECRET_KEY_V2`, …) are also accepted but the `_FILE` form wins on conflict (logged warning). Settings exposes the registry plus the "current version" pointer for new encryptions.
- [ ] Implement `load_settings()` reading env, supporting `_FILE` suffix for every secret-bearing variable, and validating with `msgspec.convert`.
- [ ] Refuse to start when any registered key is missing, unparseable, below the 64-hex-char (32-byte) entropy threshold, or matches the leaked/weak denylist (PRD §15 line 1082: `changeme`, `secret`, `password`, all-zeros, sequential digits, obvious repetition, plus an extensible list of known-leaked keys); surface as a `ConfigurationError` raised before lifespan runs. There is no "weak key warning" continuation path.

#### 5.1.2 Logging (`comradarr/core/logging.py`)

- [ ] Configure structlog per RECIPE-STRUCTLOG: `merge_contextvars` first, JSON renderer in prod, console renderer in dev, `format_exc_info`, `dict_tracebacks`.
- [ ] Add a header-redaction processor and a secret-pattern redaction processor (PRD §20).
- [ ] Add a level-based filter and per-event ratelimit/dedup processor (PRD §20 log volume controls).
- [ ] Wire to Litestar via `StructlogPlugin(config=...)` (PATTERN-APP + **RULE-LOG-001** — structlog is the only sanctioned logging surface; the stdlib `logging` module is forbidden in app code).
- [ ] Every log emit site passes structured kwargs (`logger.info("event.name", user_id=...)`); f-string interpolation of the event text or kwarg values is forbidden (RULE-LOG-002). The constraint applies to every `info` / `warning` / `error` / `exception` / `debug` site and is enforced by ruff (`G` if enabled) plus a project-local lint in §5.23 — see "Anti-pattern lint gates".

#### 5.1.3 Exceptions and Problem Details (`comradarr/errors/`)

- [ ] Implement `ComradarrError` base with `code`, `default_message`, `status_code`, `context`.
- [ ] Define every domain error class listed in PRD §21 (`authentication.invalid_credentials`, `authentication.session_expired`, `authentication.api_key_revoked`, `authorization.forbidden`, `authorization.permission_required`, `connector.unavailable`, `connector.api_error`, `connector.url_rejected`, `validation.failed`, `validation.field_invalid`, `internal.unexpected`, etc.).
- [ ] Implement Litestar `exception_handler` for `ComradarrError` and a fallback handler for unhandled exceptions (PRD §21 unhandled exceptions section).
- [ ] Render Problem Details per **RFC 9457** (the active spec; obsoletes RFC 7807 — wire shape unchanged) with media-type `application/problem+json`: `type`, `title`, `status`, `detail`, `instance`, plus `errors[]` for validation, `context` for domain data, and a `retryable` boolean derived from connector classification (PRD §21). Backend rules `RULE-API-002` is the canonical citation; PRD §17 / §21 / Glossary still carry the older RFC 7807 wording — reconcile in a follow-up doc pass.

#### 5.1.4 Application factory (`comradarr/app.py`)

- [ ] Implement `create_app(settings: Settings | None = None) -> Litestar` per **PATTERN-APP** (the canonical app-factory recipe in backend rules). The factory is synchronous (returns the Litestar instance directly), accepts a settings override for tests (PRD §18 + §22), and never starts background work itself — all I/O-driven setup runs inside the lifespan context managers wired in below, satisfying **RULE-ASYNC-001** (only async functions perform outbound I/O) and **RULE-ASYNC-002** (no `asyncio.run` / `loop.run_until_complete` inside app code; the ASGI server owns the event loop). PRD §18 is the architectural cross-reference.
- [ ] Wire `lifespan=[db_lifespan, services_lifespan]` (PRD §18) producing single `AsyncIterator[None]` context managers.
- [ ] Register Plugins: `SQLAlchemyPlugin` (advanced-alchemy `before_send_handler="autocommit"`), `StructlogPlugin`.
- [ ] Register middleware order: correlation ID → logging → trusted proxy → setup gate → CORS → CSRF → security headers → auth → permission check (PRD §16, §15).
- [ ] Register exception handlers from `comradarr/errors/`.
- [ ] Register OpenAPI controller with title `Comradarr API`, version pulled from `pyproject.toml`, and serve the spec at **`/api/schema`** with Swagger UI at **`/api/docs`** and ReDoc at **`/api/redoc`** (PRD §15 / §16 — no schema discovery before authentication). These three routes require an authenticated session or API key; unauthenticated requests return **HTTP 401 with no response body and no CORS headers** (the auth middleware fails closed before CORS / problem-details rendering for this prefix). Apply a dedicated **per-IP rate limit of 10 requests/hour** to the `/api/schema`, `/api/docs`, and `/api/redoc` routes via the rate-limit machinery in §5.4.7 (scope `schema_ip`).
- [ ] Register controllers (deferred to Phase 13; placeholder import).

#### 5.1.5 Lifespan (`comradarr/core/lifespan.py`)

- [ ] Implement `db_lifespan(app)` as an `async` `@asynccontextmanager` (RULE-ASYNC-001 — async-only outbound I/O) creating `create_async_engine` + `async_sessionmaker(expire_on_commit=False)` (RULE-DB-001), running pending migrations conditionally, exposing on `app.state` (PRD §18). The DSN is constructed with the `postgresql+asyncpg://` driver scheme only — psycopg / psycopg2 / generic `postgresql://` are forbidden (RULE-DB-002). Yields exactly once between setup and teardown; teardown awaits engine disposal.
- [ ] Implement `services_lifespan(app)` as an `async` `@asynccontextmanager` (RULE-ASYNC-001) instantiating: event bus, crypto service, client factory, planners, dispatcher, tracker, sync coordinator, rotation engine, prowlarr health monitor, retention vacuum, notification dispatcher; storing on `app.state`; launching background tasks via `asyncio.TaskGroup`. Per **RULE-ASYNC-002** the lifespan never calls `asyncio.run` or `loop.run_until_complete`; the ASGI server owns the loop and the lifespan participates as an `async with` consumer.
- [ ] On shutdown, cancel tasks, await `TaskGroup` exit (RULE-ASYNC-001 — every cancellation/cleanup hop is awaited, never bridged through `run_coroutine_threadsafe` or sync wrappers), close httpx clients, dispose engine (PRD §18).

#### 5.1.6 Health endpoint (`comradarr/api/controllers/health.py`)

- [ ] Implement `@get("/health")` returning a small JSON object (PRD §20 Health Endpoint, §29 final paragraph) with status + components, excluded from auth via the setup gate's allowlist.

#### 5.1.7 Granian launch (`comradarr/__main__.py` + scripts)

- [ ] Add `granian --interface asgi --host 0.0.0.0 --port 8000 --workers 1 --loop uvloop --log-access app.main:app` invocation (RULE-SRV-001 + PRD §24). Flags match the canonical RECIPE-GRANIAN-RUN form in backend rules verbatim — no `--runtime-mode` / `--runtime-blocking-threads` overrides at v1 (Granian's defaults are correct for an asyncio-only ASGI app, and the rule's "exact flag set" requirement is what gates this task).
- [ ] Configure 6-hour `--workers-lifetime` and `--respawn-failed-workers` (PRD §24).

### 5.2 Phase 2 — Database, roles, and models

#### 5.2.1 Base and conventions

- [ ] Implement `comradarr/db/base.py` with `class Base(AsyncAttrs, DeclarativeBase)` and `type_annotation_map = {datetime: DateTime(timezone=True)}` (RULE-DB-005). ORM models live under `comradarr/db/models/<table>.py`; this matches the `db/base.py` + `db/models/` placement from backend rules §7 even though the broader package layout is concern-flat (see §3.1 Architectural decisions).
- [ ] Add UUIDv7 primary-key helper using `uuid.uuid7()` (RULE-DB-005, DECIDE-ID).
- [ ] Add encrypted-field type `EncryptedField` exposing four columns: `*_nonce`, `*_ciphertext`, `*_tag`, `*_version` per PRD §15.

#### 5.2.2 Models per Appendix B

- [ ] `users` (PRD App. B Auth Tables) — UUIDv7 PK, email, username, role, password_hash with sentinel for non-local accounts, provisioning_provider enum, timestamps.
- [ ] `sessions` — token_hash (sha256), user_id FK, auth_provider enum, oidc_provider_name, created_at, expires_at, last_seen_at, ip, user_agent; index on token_hash.
- [ ] `api_keys` — random-portion sha256 hash, prefix, last_four, user_id, name, expires_at, created_at, last_used_at; index on hash.
- [ ] `auth_rate_limits` — composite PK `(scope, key)`, counter, window_start, backoff_delay, last_failure_at; persistent.
- [ ] `oidc_providers` — short_name unique, issuer_url, client_id, encrypted client_secret (4 cols, AAD = provider name), display_name, scope_list (JSONB), discovery cache fields.
- [ ] `connectors` — UUID PK, name, type enum (`sonarr`/`radarr`/`prowlarr`), url, encrypted api_key (AAD = connector UUID), per-connector limits, `insecure_skip_tls_verify`, `tls_ca_bundle_path`.
- [ ] `mirror_series`, `mirror_episodes`, `mirror_movies` — keyed `(connector_id, arr_id)`; episodes index `(connector_id, series_arr_id, season_number)`.
- [ ] `search_schedule` — PK `(connector_id, content_type, content_arr_id)`, denormalized series_arr_id + season_number, tier, last_searched_at, search_count, paused; partial index `(connector_id, tier, last_searched_at NULLS FIRST) WHERE NOT paused`.
- [ ] `planned_commands` — UUID PK, connector_id, command_type, command_payload JSONB, status enum, arr_command_id, dispatched_at, resolved_at; partial index `(connector_id, status, created_at) WHERE status = 'pending'`.
- [ ] `priority_searches` — unique `(connector_id, content_type, content_arr_id)`.
- [ ] `sync_state` — one row per connector; last full / deep / incremental timestamps, fingerprint JSONB, status, last_error, items_synced, duration_ms.
- [ ] `app_config` — string key/value with updated_at; companion encrypted-secrets table with the same 4-col layout for setup-claim proof and other inline encrypted values.
- [ ] `role_permissions` — `(role_name, permission_name)` PK; granted_at.
- [ ] `api_key_scopes` — `(api_key_id, permission_name)` PK.
- [ ] `user_preferences` — `(user_id, key)` PK with `value`; locale, theme (`light`/`dark`/`system`), timezone.
- [ ] `notification_channels` — UUID PK, user_id FK, name, kind enum, enabled, encrypted config (AAD = channel UUID), per-channel TLS toggles, last_tested_at, last_test_status enum; indexes on `(user_id)` and `(enabled, kind)`.
- [ ] `notification_routes` — `(user_id, event_type, channel_id)` PK with enabled, predicate JSONB nullable; FK with `ON DELETE CASCADE`; composite index on `(user_id, event_type)`.
- [ ] `notification_templates` — `(user_id, event_type, channel_kind)` unique; subject_template, body_template.
- [ ] `audit_log` — UUID PK, timestamp, action enum, actor (user_id or ip), context JSONB, ip, user_agent, **`correlation_id`** (UUID nullable, propagated from the structlog request context per RULE-LOG-001 + PRD §21 instance field, so audit entries can be cross-referenced with the structured-log stream for the same request), `previous_hash` + `content_hash` nullable; indexes `(timestamp DESC)` and `(action, timestamp DESC)`. **`previous_hash` / `content_hash` columns are intentionally reserved-NULL in v1** — the hash-chain audit log is deferred to a future release per PRD §29 "Deferred to backlog"; the columns are pre-allocated so the v0.1.0 → v0.2.0 migration can populate them without an ALTER TABLE on a large historical table. The application role's INSERT path writes `NULL` for both; a future migration will retroactively chain them.

#### 5.2.3 Alembic baseline migration

- [ ] Generate the v1 baseline migration covering every table and index.
- [ ] In the baseline migration, add `op.execute("CREATE ROLE comradarr_migration ...")`, `... comradarr_app ...`, `... comradarr_audit_admin ...` and `GRANT` statements per PRD §8 (migration role: DDL; app role: DML on all tables except UPDATE/DELETE on audit_log; audit-admin role: DELETE on audit_log only).
- [ ] Document the role-creation fallback for managed external Postgres (operator runs the role-creation SQL once; init script detects existing roles).

#### 5.2.4 Repositories (`comradarr/repositories/`)

- [ ] `base.py` — generic async session-scoped base.
- [ ] `connector.py` — list/add/edit/pause connectors with encrypted api_key plumbing.
- [ ] `content.py` — cursor-paginated read APIs over mirror tables.
- [ ] `auth.py` — users, sessions, api_keys, rate_limits, oidc_providers.
- [ ] Use `selectinload` everywhere a relationship is read in the request path (RULE-DB-004).
- [ ] Every query uses 2.0-style `select()` + `session.execute()` / `session.scalars()` (RULE-DB-003); the legacy `Query` API (`session.query(...)`, `.filter_by(...)`) is forbidden in repositories and anywhere else.
- [ ] Add cursor-pagination helper using `(sort_value, id)` keyset (PRD §17 / §25 content browser).

### 5.3 Phase 3 — Crypto, Secret type, audit log primitives

#### 5.3.1 `Secret[T]` (PRD §15)

- [x] Implement generic `Secret[T]` in `comradarr/core/types.py` overriding `__repr__`, `__str__`, `__eq__`, hashing, msgspec encode hook (return redaction marker), and `expose() -> T`.
- [x] Add a structlog processor recognizing `Secret[T]` as a redaction marker.
- [x] Add a basedpyright check that `Secret[bytes]` cannot be passed where `bytes` is expected without `expose()` (rely on type system; add example unit test that fails to typecheck).

#### 5.3.2 Crypto service (`comradarr/core/crypto.py`)

- [x] AES-256-GCM encrypt/decrypt with version registry; in v1 register a single key derived from `COMRADARR_SECRET_KEY` (PRD §15 lines 1034–1038). Column layout pinned at **4 columns per encrypted field**: `<field>_nonce` (96-bit random, fresh per encryption — never derived, never counter-based, never reused under the same key — PRD §15 line 1017), `<field>_ciphertext` (AES-256-GCM output), `<field>_tag` (128-bit GCM authentication tag), `<field>_key_version` (smallint into the key registry). Reflected by the `EncryptedField` ORM helper in §5.2.1.
- [x] AAD wiring per call site, **bound to row identity** so an attacker with database write access cannot swap ciphertext between rows (PRD §15 lines 1024–1030). Convention: `f"{tablename}:{row_pk}:{column_name}"` — concretely `connectors:<uuid>:api_key`, `oidc_providers:<provider_name>:client_secret`, `notification_channels:<uuid>:config`, `app_config:setup_claim:proof` (fixed constant for the singleton claim row). AAD inputs must be stable for the lifetime of the row; mutable fields (name, URL) are never used as AAD.
- [x] **Key denylist + entropy enforcement** at startup for every registered version; raise `ConfigurationError` before lifespan starts (PRD §15 prd:1082). Reject `COMRADARR_SECRET_KEY` (and every `_V<n>` registered version) matching any of: literal `changeme`, `secret`, `password` (case-insensitive); all-zero bytes; monotonic sequential digits/bytes (e.g. `0123456789...`, `0x000102030405...`); obvious repetition (single byte/word repeated, e.g. `0xAAAA...AAAA` or `aaaaaaaa...`); plus an extensible list of known-leaked keys loaded from `comradarr/security/leaked_keys.dat`. Entropy floor: minimum **256 bits of distinct entropy** measured via Shannon estimate over the raw key bytes; below the floor is rejected with a structured error naming the failing check (the operator sees "denylist match" / "low entropy" — never the value itself, never a hex echo). Constants and the check function live in `comradarr/security/secret_key.py` so the denylist has one canonical site.
- [x] Argon2id helper using `argon2-cffi`. **Password / bootstrap-token / recovery-token hashing parameters are pinned in code** (not configurable — PRD §15 line 1090): **64 MiB memory cost, 3 iterations (time cost), 4 lanes (parallelism)**, matching current OWASP guidance for interactive auth. Parameters are encoded into each hash so login can detect drift and trigger rehash-on-login (§5.4.2). A **separate, stronger parameter set for snapshot key derivation** is owned by another agent (PRD §30) and intentionally not pinned here — the helper exposes distinct entry points so the two parameter sets cannot be cross-wired.

#### 5.3.3 Audit log writer (`comradarr/services/audit/`)

- [x] Implement `record(action, actor, context, ip, user_agent)` running through Secret-aware redaction before insert.
- [x] Wrap with the application role's connection (insert + select only); ensure the writer never attempts UPDATE/DELETE.
- [x] Implement retention vacuum background task using audit-admin role; default indefinite, configurable cap (PRD §15, App. B audit_log).
- [x] Define the action enum exhaustively (PRD §15 / App. B): bootstrap_token_generated, setup_claim_granted, setup_claim_rejected, admin_account_created, setup_completed, login_success/_failed (per provider), logout, password_changed, session_revoked, api_key_created/_revoked/_first_used, connector_added/_edited/_deleted, http_boundary_changed, oidc_provider_added/_edited/_deleted, manual_search_triggered, manual_sync_triggered, snapshot_exported, snapshot_imported, etc.

### 5.4 Phase 4 — Auth providers, sessions, API keys, rate limits

#### 5.4.1 Provider abstraction

- [ ] Define `AuthProvider` Protocol in `comradarr/core/auth/`: `async def authenticate(request) -> AuthOutcome`.
- [ ] Implement provider registry resolved in fixed order (PRD §15).

#### 5.4.2 Local password provider

- [ ] `LocalPasswordProvider` using Argon2id (parameters from §5.3.2); rehash on login when parameters drift (App. B users, PRD §15 line 1092); disabled when `COMRADARR_DISABLE_LOCAL_LOGIN=1` (login form not rendered, login endpoint returns 403 — PRD §15 line 825); users carrying the trusted-header sentinel password hash (§5.4.3) are structurally rejected here, not merely "fail to verify".
- [ ] Constant-time username-enumeration defense: when the username is unknown, run a dummy Argon2id verify against a fixed placeholder hash so failed-known and failed-unknown paths take indistinguishable time (PRD §15 line 821). All failures return a single generic `authentication.invalid_credentials` problem detail.
- [ ] Per-IP and per-username rate limit checks (PRD §15 lines 899–905) reading/writing `auth_rate_limits` with an in-memory hot cache.
- [ ] **Per-username deterministic backoff sequence pinned at `1s, 2s, 4s, 8s, 16s, capped at 60s`** (PRD §15 line 901). Driven by a counter persisted on `auth_rate_limits` keyed by `(scope='login_username', key=submitted_username_lowercased)`; the sleep before responding is a pure function of that counter so timing is identical for known and unknown usernames. The counter increments on every failed attempt and is **reset on successful authentication for that username**. No hard lockout (PRD §15 line 903) — backoff is the only friction.
- [ ] **Session rotation on privilege change** (PRD §15 lines 875, 911): on password change, mint a new session token (replacing the current row's hash and updating the response cookie) **AND revoke all other active sessions for that user** by deleting their rows in the same transaction. Emit `password_changed` and `session_revoked` audit entries for each killed session.

#### 5.4.3 Trusted-header provider

- [ ] Verify TCP socket peer is in `trusted_header_auth_proxy_ips` (the socket peer as Granian sees it — **never** XFF, X-Real-IP, or any header-based source — PRD §15 line 839). The check is the first thing the middleware does and runs before any header is read.
- [ ] Resolve user via configured username/email header; provision per `trusted_header_auth_provision_policy` (default auto-provision, strict-match available).
- [ ] On auto-provision, write a **non-hashable sentinel** value into `users.password_hash` for the new row (PRD §15 line 843) — a fixed string that is structurally not a valid Argon2id hash (e.g., `!locked-trusted-header!`) so `LocalPasswordProvider` short-circuits to reject these users before any verify call rather than relying on hash-mismatch timing. `LocalPasswordProvider` checks for this sentinel by exact equality.
- [ ] Logout redirects to the configured `trusted_header_auth_logout_url`. **Warning log on settings save when this URL is empty/missing** (PRD §15 line 847) — operator footgun: clicking logout with no logout URL just lands the user back on a page the proxy will immediately re-authenticate. The warning is structured (`logger.warning("trusted_header.logout_url_missing", ...)`) so it surfaces in the admin notifications panel as well.
- [ ] Backend accepts and validates the **typed-out IP allowlist confirmation** the settings UI requires (PRD §15 line 833 — the literal phrase the operator must type, e.g., `I understand` — verified server-side as a guard against accidental clicks). The settings UI itself lives in §5.18.2 (owned by another agent); this provider exposes the validation entry point. Audit log records both the authenticating user and the trusted-proxy IP that attached the identity header on every successful login.
- [ ] **Trusted-header threat model + startup warning (pinned).** The provider is opt-in (default off); when enabled and `trusted_header_auth_proxy_ips` is empty or contains `0.0.0.0/0`, the lifespan emits a **loud structured-log warning** (`logger.warning("trusted_header.world_readable_proxy_ips", ...)`) on every boot and a banner on the admin notifications panel — the failure mode is "any client can spoof identity headers and become any user" if a misconfigured reverse proxy or the default-empty allowlist lets the request reach Granian directly. The warning is unsuppressible (no env-var to silence it); operators who have intentionally chosen this posture for a single-tenant LAN deployment must dismiss it explicitly per-session. Document the threat model verbatim in `docs/auth-trusted-header.md`: socket-peer-only trust, header-only identity (never authentication), provisioning policy options, the typed-out confirmation guard, and the audit-log dual-actor record.

#### 5.4.4 OIDC provider

- [ ] Implement authorization code flow with **mandatory PKCE on every flow, S256 only — `plain` is never offered or accepted** (PRD §15 line 859, regardless of client_secret presence, regardless of what discovery advertises). The code_verifier is generated with `secrets.token_urlsafe(64)`; the challenge is the URL-safe base64 of its SHA-256 digest. There is no non-PKCE code path.
- [ ] **State + nonce on every authorize request, verified on callback** (PRD §15 line 859): `state` is a CSRF-protected nonce bound to the browser's pre-auth session and rejected on mismatch; `nonce` is included in the authorize URL and required to appear unchanged in the ID token's `nonce` claim. Both are single-use.
- [ ] JWKS cache: in-memory only, **24-hour periodic refresh** (PRD §15 line 857) **plus refresh-on-signature-failure** with a one-shot retry, throttled to **at most one refresh per 60 seconds per provider** to prevent a flood of bad tokens from triggering unbounded JWKS fetches.
- [ ] Validate issuer (`iss`), audience (`aud` matches our `client_id`), expiry (`exp`), not-before (`nbf`) when present, issued-at (`iat`), and the `nonce` claim. **Allow `60` seconds of clock-skew tolerance on `iat` / `nbf` / `exp` checks** (legitimate skew between the IdP and the Comradarr host is normal; tighter than this rejects valid tokens). **Explicitly reject `alg=none` even if the discovery document advertises it** (PRD §15 line 861 — `python-jose` rejected for this class of bug); the JOSE wrapper enforces an allowlist of asymmetric algs and treats `none` as a parse error before any signature path runs.
- [ ] Discovery doc cache in `oidc_providers` row (24h refresh; refetched on JWKS miss).
- [ ] Map OIDC `sub` + `iss` to the local `users` row; create on first login per provisioning policy. Provisioned users get the trusted-header-style non-hashable sentinel password hash so they cannot fall through to local-password auth.
- [ ] **Account-linking policy** (PRD §15 line 865) configurable per provider via `COMRADARR_OIDC_<PROVIDER>_LINK_POLICY`: `link` (default — when an existing local-password user shares the OIDC verified email, reuse that user row and record `auth_provider=oidc` on the new session; the local password remains usable for direct login but is not required for OIDC) and `require_separate` (refuse to authenticate via OIDC when a local-password user with the same email exists; the operator must delete the local user first). Linking only happens when the IdP-asserted email is verified (`email_verified=true`); unverified emails always fall through to provisioning under the OIDC identity.
- [ ] Logout calls provider `end_session_endpoint` when discovery advertises it; otherwise clears the local session only.
- [ ] **JOSE / OIDC library pinned: use `authlib`** (PRD §15 line 861 short-listed `authlib` and `joserfc` as defensible; `authlib` chosen here for its integrated OIDC client + JWKS + discovery handling and active CVE response history; `python-jose` is explicitly rejected). `joserfc` may be substituted for primitives if `authlib` later drops a relevant feature, but the v1 implementation targets `authlib` only.

#### 5.4.5 Sessions

- [ ] Issue session: random 256-bit token, hash on insert (sha256), set HttpOnly + Secure (gated by `COMRADARR_INSECURE_COOKIES` for dev) + SameSite=Lax cookie (PRD §16). **Session-fixation defense (pinned):** the login endpoint always issues a fresh session row + cookie on successful authentication regardless of any pre-login session cookie the client already carries; the previous (anonymous) session row, if any, is deleted in the same transaction. There is no path that "upgrades" a pre-existing session ID to authenticated; the post-login cookie value is unconditionally new.
- [ ] Validate session: constant-time hash lookup, idle + absolute timeout enforcement (defaults: 7-day idle, 30-day absolute — PRD §15 line 871), best-effort `last_seen_at` update (fire-and-forget; auth never fails because of the activity write).
- [ ] **Concurrent sessions** allowed without limit (PRD §15 line 877). Provide a `revoke_all_other_sessions(user_id, except_session_id)` operation that deletes every active session for the user except the caller's; surfaced in the sessions UI as "revoke all other sessions" and reused by §5.4.2's session-rotation-on-privilege-change path. IP and user-agent on session rows are informational only and never used for authorization.
- [ ] **Rotation on privilege change** mirrors §5.4.2: any operation that mutates security-relevant fields (password change, future role assignment) generates a new token, replaces the current row's hash, updates the response cookie, and revokes every other session row for that user (PRD §15 line 875).
- [ ] Revocation: delete the row (PRD §15 line 879 — no "expired" tombstone; replayed cookies find no row and 401).

#### 5.4.6 API keys

- [ ] Generate `cmrr_live_<random>`; return plaintext exactly once at creation (PRD §15 / §26). **Prefix literal pinned in code (`cmrr_live_`)** as a single module-level constant referenced by the issuer, the parser, and the audit log — never rebuilt by string concatenation at call sites. The random suffix is `secrets.token_urlsafe(32)` (256 bits of entropy) so the full key is 11 characters of prefix + 43 characters of url-safe base64, total ~54 chars; the parser rejects any `Authorization: Bearer ...` value that does not begin with the literal prefix before any DB lookup runs (cheap structural reject + cheap rate-limit increment).
- [ ] Persist hash, prefix, last_four; record optional scope rows in `api_key_scopes`.
- [ ] Authentication via `X-Api-Key` header or `Authorization: Bearer cmrr_live_...`.
- [ ] Permission resolution joins `api_key_scopes ∩ role_permissions(owner.role)` (PRD §26).
- [ ] First-use audit log entry per PRD action enum.

#### 5.4.7 Rate limit machinery

- [ ] Persistent counters keyed on `(scope, key)` survive restarts (PRD §15 line 905 — an attacker cannot reset state by cycling the container). Hot-path in-memory cache backs the `auth_rate_limits` table.
- [ ] **Login per-username: deterministic progressive backoff `1s, 2s, 4s, 8s, 16s, capped at 60s`** (PRD §15 line 901). The canonical implementation lives here and is invoked by §5.4.2 — counter on the row, identical timing for known and unknown usernames, cleared on success. No hard lockout.
- [ ] **Login per-IP: window cap of 10 attempts/minute and 50 attempts/hour** (PRD §15 line 899); 429 with `Retry-After` on exceedance.
- [ ] Schema-endpoint scope (`schema_ip`): 10 requests/hour/IP for `/api/schema`, `/api/docs`, `/api/redoc` (per §5.1.4).
- [ ] Bootstrap-IP scope used during setup wizard claim (PRD §15 / §16 / §15 setup details).
- [ ] API-key auth failures rate-limited per source IP (PRD §15 line 893 — per-key limiting is defeated by key rotation; per-IP catches the realistic abuse pattern).

### 5.5 Phase 5 — Setup gate + bootstrap + setup wizard backend

> **Phase ordering note (cross-ref §7.3).** Phase 5 numerically precedes Phase 6 but **logically depends on the Phase 6 HTTP-boundary middleware skeleton** (CSP nonce, Origin/Referer CSRF check, security headers, allowed-hosts, cookie attribute matrix) being in place — the wizard renders SSR pages, sets the `comradarr_setup_claim` cookie, and serves SSE updates that all flow through that middleware. The two phases must be implemented in this order: **(a) land the Phase 6 middleware skeleton first** (controllers can be empty stubs at this point — middleware order, CSP nonce plumbing, Origin/Referer validator, Host validator, three-cookie attribute matrix, security-header set), **(b) then build Phase 5 wizard endpoints + setup-gate allowlist on top of that skeleton.** Wizard backend tasks below assume the skeleton already exists; do not start Phase 5 controllers until Phase 6 §5.6.1–§5.6.7 land. The numbering is preserved for cross-reference stability — the phases run in the dependency order, not the numeric order.

#### 5.5.1 Setup gate middleware

- [ ] Read `setup_completed` from `app_config` once per request (cache invalidated on change). **Sentinel semantics (pinned):** the column stores the literal string `"true"` once the wizard's Phase 3 finalize step (admin user written) succeeds; every other value — absent row, empty string, `"false"`, `"0"`, `"yes"`, any case-variant of `"true"` — counts as **not completed** and the gate stays armed. Comparison is exact-string-equal `value == "true"` against the lower-cased trimmed read; this prevents an accidental `app_config` row mutation (capitalisation, whitespace, "True", boolean-typed JSONB cast) from silently lowering the gate.
- [ ] Allowlist while incomplete (minimal, per PRD §15 "Setup Gate Middleware"): `/setup` and frontend setup wizard pages, `/api/setup/*` (the only CSRF-exempt POST is the bootstrap claim within this prefix), `/api/health`, and the static assets required for the setup UI to render (`/static/*`, `/_app/*`). The OpenAPI schema is NOT in the allowlist — it lives at `/api/schema` under auth (see §5.1.4 / §5.13.4 owned by another agent).
- [ ] For HTML / browser-navigation requests outside the allowlist: redirect to `/setup` with 302.
- [ ] For API requests outside the allowlist: return **HTTP 503 Service Unavailable** (Problem Details body, `context.reason="setup_incomplete"`) — never 401, since 401 implies "authenticate" but no auth surface yet exists.

#### 5.5.2 Bootstrap token flow

- [ ] Generate token at startup if and only if `setup_completed != "true"`. Format: **Crockford base32** alphabet (no `0/O/1/I/L`), **80 bits of entropy = 16 base32 chars**, hyphenated into **5-character segments** as `XXXXX-XXXXX-XXXXX-X` (PRD §15 "Three Distinct Credentials").
- [ ] **TTL: 15 minutes** from process start (PRD §15 "TTL Ordering Is Intentional"); in-memory expiry timer clears the plaintext at TTL.
- [ ] Storage: keep only the **Argon2id hash** (same params as the password hasher — 64 MiB / 3 iters / 4 lanes, PRD §15 "Argon2id Parameters") for comparison; never compare in plaintext. The plaintext is held in process memory only long enough to write the startup banner, then dropped.
- [ ] Dual emission per PRD §15 "Token Generation and Visibility": **stdout banner** (canonical, captured by `docker logs`/`compose logs`) **and** a 0600-mode file at a documented path inside the container. The file is auto-deleted on token expiry, on successful Phase 3 completion, or on process restart. Stdout is the canonical stream because container log collectors default to capturing stdout; structured operational logs continue to go to stderr (the banner is intentionally cross-stream-aware so it surfaces under both default and reconfigured log routings).
- [ ] Banner contents (stdout) must include, inside a visually distinctive separator block: (a) the full bootstrap setup URL with `0.0.0.0` (or any bind-all address) substituted to `localhost`, with the bootstrap token as a query parameter; (b) the absolute UTC expiry timestamp (ISO 8601); (c) explicit text noting the token is single-use, validated without consume, and consumed only on successful Phase 3 wizard completion.
- [ ] **Token is consumed (cleared from memory + on-disk file deleted) ONLY on successful Phase 3 wizard completion (admin user written + `setup_completed="true"`).** It is NOT consumed on first claim — see §5.5.3 validate-without-consume.
- [ ] Audit log: `bootstrap_token_generated` at emission (no token value, no hash); single-worker warning logged if multi-worker mode is detected while setup is incomplete (PRD §15 "Single-Worker Requirement").
- [ ] **Stdout-leak operator warning (pinned).** The startup banner explicitly states inside the separator block: "this token is printed to stdout and to a 0600 file inside the container; treat container logs and the file path as setup-time secrets, do not paste this token into chat / issue trackers / shared screens, and rotate Comradarr by restarting the process if the token is exposed." The warning text is fixed in code (not configurable) so an operator cannot silence it. Structured logging routes the warning to stderr at `WARN` level **in addition to** the stdout banner so log collectors that split streams still capture the leak-risk notice.

#### 5.5.3 Setup-claim endpoint

- [ ] `POST /api/setup/claim` accepts the bootstrap token; CSRF-exempt (the only such POST in the application, per PRD §15 "CSRF During Setup"); per-IP rate-limited via the bootstrap-IP scope from §5.4.7 at **10 attempts/hour/IP** (returns 429 with `Retry-After`). **No hard lockout** — 429 only; the deterministic per-username login backoff does not apply to claim. **Simultaneous-claim race defense (pinned):** the persisted-proof write uses `INSERT INTO app_config (key, value) VALUES ('setup_claim_proof', :proof) ON CONFLICT (key) DO NOTHING`; the endpoint then reads the row and returns 200 only when the read-back proof matches the value the request just generated. A losing concurrent claim sees the conflict, fails the read-back equality check, and falls through to the second-browser 409 path (§5.5.3 below) without overwriting the winner's proof.
- [ ] **Validate-without-consume semantics (default):** verify the submitted token against the stored Argon2id hash with constant-time comparison; on success, issue a `comradarr_setup_claim` cookie (HttpOnly, Secure, SameSite=Strict, Path=`/setup`) carrying a random claim proof (UUIDv4) whose AES-GCM-encrypted form is persisted in `app_config` with a fixed-context AAD (PRD §15 "Claim Flow"). **Do NOT clear the bootstrap token.** The token remains valid until its 15-minute TTL or successful Phase 3 finalize.
- [ ] **10-minute sliding TTL** on the claim cookie: each successful wizard action that re-presents the cookie renews the cookie + persisted-proof timestamp by another 10 minutes.
- [ ] **Same-browser re-claim renews TTL:** if the request arrives bearing a still-valid `comradarr_setup_claim` cookie whose proof matches the persisted record, return 200, regenerate-or-refresh the proof timestamp, and reset the 10-minute window. Token re-validation still occurs so a stolen cookie cannot ride past its TTL without the token.
- [ ] **Second-browser claim returns HTTP 409 Conflict** (Problem Details, `context.reason="active_claim_from_other_origin"`) when an unexpired claim proof exists and the request does not bear the matching cookie. This is the claim-takeover defense from PRD §15 "Claim Flow".
- [ ] **Strict-mode override (operator escape hatch):** when `COMRADARR_BOOTSTRAP_STRICT_MODE=1` is set, the endpoint switches to single-shot consume-on-claim semantics — first successful claim clears the bootstrap token immediately and any subsequent claim attempt requires a process restart (PRD §15 "Validate Without Consume").
- [ ] **Three-credential admin-session bootstrap invariant:** every wizard endpoint under `/api/setup/*` (Phases 2 and 3) must validate all three of (a) the bootstrap token *not yet consumed*, (b) the `comradarr_setup_claim` cookie matching the persisted proof and not TTL-expired, and (c) — from Phase 3 onwards once the admin session is issued — the admin session cookie. The token is not cleared until the wizard's Phase 3 finalize step writes the admin user successfully.
- [ ] Audit log: `setup_claim_granted` on success (records whether claim was new vs. renewal vs. strict-mode consume); `setup_claim_rejected` on failure with `context.reason` ∈ {`bad_token`, `expired_token`, `rate_limited`, `claim_conflict`}.
- [ ] **No-body-log policy on setup endpoints (pinned).** Every endpoint under `/api/setup/*` (claim, boundary phases A–D, finalize) skips the structured-log "request body" capture path entirely — body bytes are never serialized into the structlog record, never echoed in error responses, and never cached for the request-summary access log. The bootstrap token, the encrypted claim proof, and the proposed admin password / username on the Phase 3 finalize endpoint are the most sensitive operator-typed values in the application; the `/api/setup/*` URL prefix is added to the structlog `body_redact_paths` allowlist so even an accidental `logger.bind(body=...)` from middleware emits `<redacted>`. Structured event names (`setup.claim.granted`, `setup.boundary.committed`, `setup.finalize.completed`) carry only non-sensitive shape fields (status, claim-was-renewal flag, audit correlation ID).

#### 5.5.4 HTTP boundary verification wizard (Phase 2 of PRD §15)

The wizard exposes exactly **four operator-visible steps** under `/api/setup/*`. Every step requires the three-credential admin-session bootstrap from §5.5.3 (token-not-consumed + claim cookie + — once Phase 3 issues it — admin session). Each step persists only on a successful live test; failure returns Problem Details with `context.proposed` and `context.error_kind`. Each successful step emits an `http_boundary_changed` audit entry.

- [ ] **Step A — Proxy trust configuration.** Configure trusted-proxy CIDRs and TCP socket peer ranges. Server captures the observed socket peer IP only (PRD §15 "Socket peer address, never headers" / §16). The endpoint **must reject any X-Forwarded-For input** from the operator form — proxy trust is determined by socket peer alone. Live-test: the operator's browser hits a verification endpoint and the server **echoes back the resolved client IP after applying the proposed proxy chain to the request** so the operator can visually confirm "yes, that is my actual IP" before the configuration is committed. The echoed IP is also written to the audit log entry for `http_boundary_changed` so a later forensic review can correlate the configuration change with the IP the operator's browser was reaching from at decision time.
- [ ] **Step B — Public origin.** Set the canonical public origin URL. Server proposes from observed `Host` + scheme (resolved through the now-trusted proxy chain from Step A). Live-test issues a redirect to the proposed origin and verifies the round trip.
- [ ] **Step C — Allowed origins AND allowed hosts (single combined step).** Both lists are configured together before the wizard advances: allowed origins feed the CORS allowlist + CSRF Origin/Referer check; allowed hosts feed Host-header validation. Defaults are seeded from Step B (`[public_origin]` for origins; the hostname seen in Step A's chain for hosts). Live-test: a credentialed fetch from each allowed origin completes including CORS pre-flight, AND a request bearing a non-allowed Host header is rejected with 421.
- [ ] **Step D — Rollup confirmation.** Display all settings persisted in Steps A/B/C. Require the operator to type a fixed confirmation string (per PRD §15 trusted-header friction model — typed-out, not click-through) before the rollup is committed. On confirm, persist the full HTTP boundary configuration atomically and unlock Phase 3 admin account creation.

#### 5.5.5 Admin account creation endpoint

- [ ] `POST /setup/admin` accepts username + email + password; enforces the password length minimum + denylist (PRD §15).
- [ ] On success: provision the admin user with `provisioning_provider="local"`, role=`admin`, issue a session immediately so the wizard can proceed without a separate login.
- [ ] Write the literal lower-case string `"true"` (not `True`, not boolean cast, not JSON-true) into `app_config.setup_completed` — matches the §5.5.1 sentinel comparator exactly; emit `admin_account_created` and `setup_completed` audit entries. **Idempotent-finalize replay defense (pinned):** the transaction begins with `SELECT value FROM app_config WHERE key='setup_completed' FOR UPDATE`; if the row already holds `"true"` (a prior finalize won), the endpoint releases the lock and returns **HTTP 409 Conflict** with `context.reason="setup_already_completed"` rather than re-creating the admin user or re-writing the sentinel. Only a row that resolves to "not completed" under the §5.5.1 sentinel rule proceeds to the admin insert + sentinel flip. This makes the endpoint safe against replayed finalize requests once the wizard has already succeeded.
- [ ] **DB role for the Phase 3 finalize write (pinned).** The atomic admin-user insert + `app_config('setup_completed','true')` flip runs through the **migration-role connection** (already loaded for Phase 1 setup) — the application role lacks the GRANTs needed for the cross-table transaction (see §5.2.3 GRANT layout: app role has DML on application tables only; `app_config` setup-row writes during bootstrap and the cross-table admin/users + app_config transaction together require migration-role privileges to keep the wizard's finalize step atomic). After the flip succeeds, the migration-role connection is closed and subsequent requests run under the application role per the normal lifespan pool.

### 5.6 Phase 6 — HTTP boundary hardening

#### 5.6.1 Trusted proxy resolver

- [ ] Resolve client IP using the **TCP socket peer only** as the trust input; consult `Forwarded`/`X-Forwarded-For` solely when the socket peer matches `trusted_proxy_ips`, never the other way around (PRD §16, "Resolution Algorithm After Configuration").
- [ ] When the peer is trusted, parse the `X-Forwarded-For` chain left-to-right and select the leftmost entry that is not itself in `trusted_proxy_ips`; honor `X-Forwarded-Proto`/`X-Forwarded-Host` only from trusted peers; on empty/malformed chain, fall back to the socket peer and log at INFO; on syntactically invalid (non-IP) entries, reject the chain and fall back to the socket peer.
- [ ] Stamp resolved (ip, scheme, host) onto request state in a single early middleware so the rate limiter, audit log, OIDC redirect builder, CSRF Origin check, and CORS comparator all read from the same source.
- [ ] Bind the resolved IP to structlog contextvars for every request.

#### 5.6.2 Public origin canonicalization

- [ ] Reject requests whose `Host` header is not in `allowed_hosts` with **HTTP 421 Misdirected Request** (PRD §16, "Host Header Validation"); reject lone-wildcard entries at config-write time.
- [ ] Build outgoing redirect URLs (OIDC callbacks, absolute links) from `public_origin`, never from request headers.

#### 5.6.3 CORS

- [ ] Configure Litestar CORS with `allowed_origins` (exact-string allowlist after lowercase scheme/host + default-port elision; **no wildcards**), `allow_credentials=True`, `allow_methods` matching the API surface, `allowed_headers` minimal (including the API key and content-type headers), and **`max_age=600`** (10-minute preflight cache per PRD §16).
- [ ] On every CORS response (allowed and disallowed alike), emit **`Vary: Origin`** so intermediate caches do not cross-pollinate responses between origins; echo the request's `Origin` back verbatim on allowed origins (never `*`); emit no CORS headers on disallowed origins (do not leak the allowlist).
- [ ] Treat requests with no `Origin` header as non-CORS (no CORS headers emitted); apply the same middleware to the SSE endpoint.

#### 5.6.4 CSRF

- [ ] Implement CSRF defense as **`Origin`/`Referer` header validation** against `allowed_origins` on every state-changing verb (POST, PUT, PATCH, DELETE) (PRD §16, "CSRF"). Do **not** implement a double-submit cookie/token pattern; there is no `comradarr_csrf` cookie. Per **RULE-AUTHZ-MATCH-001** the matcher is exact-string equality against the explicit `allowed_origins` list (no `String.prototype.includes`/substring/contains-style checks) and the comparator never falls back to a permissive default — empty/missing `allowed_origins` rejects every cross-origin write rather than allowing all.
- [ ] On a mutating request: require `Origin`; if absent, fall back to `Referer`'s origin component; if both are absent or neither matches `allowed_origins`, reject with 403 and a generic "missing or invalid origin" message (do not distinguish absent from wrong).
- [ ] Exempt only two paths from this check: (a) `POST /setup/claim` (the bootstrap claim, which runs before `allowed_origins` exists and is protected by the bootstrap token + SameSite=Strict claim cookie + per-IP rate limit); (b) requests authenticated by `Authorization: Bearer <api_key>` / `X-Api-Key` whose API key validation succeeded — detect via the resolved auth mechanism on request state, not via header presence, so a bogus key falls back to the cookie path where CSRF still applies.
- [ ] Ensure the SvelteKit `hooks.server.ts` forwards the user's original `Origin` on backend calls so the backend's check sees the genuine browser origin (PRD §16, "SvelteKit Form Actions"). **SvelteKit-side posture (frontend RULE-SEC-001 + ANTI-SEC-001):** SvelteKit's built-in CSRF protections stay on; `kit.csrf.checkOrigin` is **never** set to `false` (per ANTI-SEC-001 — disabling `checkOrigin` is the explicit anti-pattern, not an opt-in switch). The deploy-time `ORIGIN` env-var is set to the canonical public origin, and any external trusted origins are added to `kit.csrf.trustedOrigins` rather than disabling the check. The Litestar Origin/Referer comparator above is a defense-in-depth backstop for the SvelteKit guard, not a replacement.

#### 5.6.5 Security response headers

- [ ] Apply on every response: **`Strict-Transport-Security: max-age=31536000; includeSubDomains`** (NO `preload` directive — preload is a deliberate operator decision, not an automatic opt-in; PRD §16) and emit it only when the request was received over HTTPS.
- [ ] Apply on every response: `X-Content-Type-Options: nosniff`; `Referrer-Policy: strict-origin-when-cross-origin`; `X-Frame-Options: DENY`; `Permissions-Policy: accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()`; `Cross-Origin-Opener-Policy: same-origin`; `Cross-Origin-Resource-Policy: same-origin`.
- [ ] Suppress the `Server` header (no `granian/x.y.z` advertisement) and never emit `X-Powered-By`.

#### 5.6.6 CSP

- [ ] Generate a fresh **128-bit cryptographic nonce per request** in a Litestar middleware, stamp it onto request state, and have the SvelteKit SSR layer read it from request state to emit on every inline `<script>` and `<style>` tag it serves.
- [ ] Build the production CSP header verbatim as: `default-src 'self'; img-src 'self' data:; style-src 'self' 'nonce-<value>'; script-src 'self' 'nonce-<value>'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; upgrade-insecure-requests`. **Forbid `'unsafe-inline'` and `'unsafe-eval'` everywhere** — both keywords MUST NOT appear in any directive.
- [ ] Implement `POST /api/csp-report` to receive browser violation reports (rate-limited per source IP at **60 requests/minute/IP and 600 requests/hour/IP** via the same persistent counter machinery as §5.4.7, scope `csp_report_ip`; bounded context fields: violated directive, blocked URI, document URI only — never user-content fields); use this endpoint during a parallel report-only rollout window before flipping to enforce mode. **Auth posture (pinned):** the endpoint is **unauthenticated and CSRF-exempt** (browsers post CSP reports without cookies and without a custom Origin), and is **explicitly allowlisted in the setup gate** (§5.5.1) so it stays reachable while `setup_completed != "true"`. Body parsing accepts only `application/csp-report` and `application/reports+json` content-types with a hard 8 KB body cap; any other content-type or oversized body is silently dropped (no error response — a hostile client must not learn whether the endpoint exists). On rate-limit exceedance the endpoint also drops silently (no 429 body, no `Retry-After` header) for the same hostile-client-fingerprinting reason.
- [ ] Switch to `Content-Security-Policy-Report-Only` when `COMRADARR_CSP_REPORT_ONLY=1`; emit a startup warning (PRD §16, §19).

#### 5.6.7 Cookie attribute matrix

- [ ] Document and apply exactly **three** cookies (PRD §16, "Cookie Attributes"); there is no `comradarr_csrf` cookie:
  - `comradarr_session`: `HttpOnly` + `Secure` + `SameSite=Lax` + `Path=/`, no `Domain` attribute, no `Expires`/`Max-Age` (server-side session row enforces lifetime).
  - `comradarr_setup_claim`: `HttpOnly` + `Secure` + `SameSite=Strict` + `Path=/setup`, 10-minute TTL renewed on each successful wizard action.
  - `comradarr_theme_pref`: non-`HttpOnly` + `SameSite=Lax` (UI preference only; carries no security data).
- [ ] `COMRADARR_INSECURE_COOKIES=1` disables only the `Secure` attribute on the two HttpOnly cookies (development over HTTP); `HttpOnly` and `SameSite` remain enforced; emit a loud startup warning.

### 5.7 Phase 7 — Connector subsystem (HTTP client, factory, errors)

#### 5.7.1 SSRF-defended HTTP client (`comradarr/connectors/http.py`)

- [ ] Build an `httpx.AsyncClient` factory (RULE-ASYNC-001 — async-only outbound I/O; RULE-HTTP-001 — `httpx.AsyncClient` is the only sanctioned outbound HTTP primitive, sync `requests`/`urllib3` are forbidden) that:
  - [ ] **Pins `trust_env=False` on every constructed client.** httpx otherwise reads `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` / `SSL_CERT_FILE` / netrc from the process environment, and a hostile or misconfigured operator environment could route every connector request through an attacker-controlled proxy or pin a malicious CA bundle. Per-connector proxy and CA configuration is provided explicitly via the connector row (`connectors.proxy_url`, `connectors.tls_ca_bundle_path`); environment-driven overrides are forbidden.
  - [ ] **Pins `follow_redirects=False` on every connector request** (PRD §7 "Redirect Policy", prd:L261-L263). The *arr APIs do not legitimately use HTTP redirects, and a malicious or compromised *arr clone returning `302 Location: http://evil.example/api/v3/series` would otherwise cause the connector's `Authorization` / `X-Api-Key` header to be sent to the attacker's host (httpx forwards auth headers across redirects by default). Any 3xx response is wrapped in a transient `ConnectorRedirectError` with the redirect target stripped from the message before logging — the operator sees only "redirect refused; check upstream proxy configuration" and a structured `connector.redirect_refused` log event so they can investigate. Per-hop IP reclassification is a defence-in-depth backstop **only** — under no URL classification policy (default / strict / permissive) is httpx ever permitted to follow a redirect.
  - [ ] re-resolves DNS on every outbound request and classifies every resolved IP against the private-IP / link-local / loopback / metadata denylist — RFC 1918 (`10/8`, `172.16/12`, `192.168/16`), `127.0.0.0/8`, IPv6 `::1` and `fe80::/10`, CGN `100.64.0.0/10`, `169.254.0.0/16` (covers AWS/GCP/Azure metadata at `169.254.169.254`), broadcast/multicast, IPv4-mapped exotic ranges (PRD §7 + Glossary);
  - [ ] **DNS-rebind defense (pinned).** After classification succeeds, the client opens the TCP connection to one of the pre-classified IPs from the resolution result rather than re-resolving the hostname inside `httpx`/`httpcore` (which would re-query DNS and could land on a freshly-rotated rebound IP). After the socket connects, the connector reads the kernel-reported peer address (`socket.getpeername()`) and **re-runs the URL classifier against that peer IP**; any mismatch between the pre-resolved set and the actual peer aborts the request with `SSRFRebindError` before the TLS handshake completes. This closes the classify→connect race that a sub-TTL rebind attack exploits.
  - [ ] enforces the URL classification policy (default / strict / permissive) configured by `COMRADARR_CONNECTOR_URL_POLICY`;
  - [ ] applies explicit timeouts — `httpx.Timeout(connect=5.0, read=30.0, write=10.0, pool=5.0)` and a per-host bounded connection pool `httpx.Limits(max_connections=10, max_keepalive_connections=5)` (RULE-HTTP-002 / RULE-HTTP-003); the streaming reader additionally enforces a **per-chunk idle-byte timeout of 5 s** so a slow-loris upstream that sends one byte per ~30 s (under the read-timeout's reset clock) cannot tie up a connection indefinitely — every gap between received bytes longer than 5 s aborts the stream with a transient connector error. **Absolute wall-clock cap (pinned):** every connector request — including its full streaming-body read — is wrapped in `asyncio.wait_for(..., timeout=60.0)` so a pathological upstream that drip-feeds bytes just under the per-chunk idle threshold cannot exceed 60 s end-to-end. The httpx `Timeout(...)` knobs above govern per-phase behaviour; the wait_for is the global ceiling. Exceeding the ceiling raises a transient `ConnectorTimeoutError` and increments the same hostile-response counter as malformed-payload defenses.
  - [ ] **Pinned Content-Type allow-list (security rationale).** The streaming reader rejects any response whose `Content-Type` (matched media-type only, parameters parsed and verified separately) is not in `{application/json, application/problem+json}`. `text/html`, `text/plain`, `application/xml`, `application/octet-stream`, multipart, and unknown types abort with `HostileResponseError` *before* the body is consumed — the *arr APIs return JSON only, so an HTML/XML response is signal that the connector hit a captive portal, a misconfigured reverse proxy, or a redirect target that bypassed `follow_redirects=False`. The `charset` parameter, if present, must be `utf-8` (case-insensitive); any other charset is rejected. A leading UTF-8 BOM in the body is stripped once before msgspec parsing; multiple BOMs or BOMs after the first byte are rejected. **Header / cookie size caps:** total response header bytes capped at 64 KiB, individual `Set-Cookie` header capped at 8 KiB; HTTP/1.1 trailer headers (`Trailer:` + chunked trailers) are silently ignored — the parsed body never sees them and they never reach the audit log. **JSON node count:** in addition to the 64-deep / 100 000-element-per-container limits, the parser enforces a **total-node ceiling of 1 000 000 across the entire document** so a flat-but-wide hostile payload (millions of one-key objects) is rejected at the same memory bound as a deeply nested one.
  - [ ] sets `User-Agent: comradarr/0.1.0 (+https://github.com/engels74/comradarr)` on every outbound request;
  - [ ] respects per-connector TLS toggles (`insecure_skip_tls_verify`, `tls_ca_bundle_path`);
  - [ ] caps the response body at **256 MB by default, configurable per connector** (`COMRADARR_CONNECTOR_RESPONSE_CAP_BYTES = 256 * 1024 * 1024` at the global default; `connectors.response_cap_bytes` overrides per row), enforced as a **true byte budget over the streamed body regardless of `Content-Length`** (PRD §7 lines 275, 319), and aborts with `HostileResponseError` on oversized, malformed-JSON, or unexpected-content-type responses (PRD §7 — gzip bombs, recursive nesting, oversized JSON). The cap is the byte ceiling for legitimate Sonarr/Radarr large-payload responses (history pages, full library refreshes); per-connector overrides exist so an operator running an unusually large Sonarr instance can raise it without globally relaxing the SSRF posture;
  - [ ] **decompression-bomb defense.** When a Content-Encoding (gzip / deflate / br / zstd) is present, the streaming decoder enforces a **decompressed:compressed ratio cap of 100:1** in addition to the absolute 256 MB ceiling — a 1 MB compressed body that expands beyond 100 MB aborts with `HostileResponseError` mid-stream, before the full payload is buffered. The ratio cap is a code constant; per-connector overrides apply only to the absolute cap (PRD §7 hostile-response defenses). A decompressed-size-exceeded event increments the same hostile-response counter as oversized responses.
  - [ ] runs JSON parsing through msgspec with hard limits — **max nesting depth 64**, **max object/array length 100 000 elements** — plus `strict=True` and the per-Struct `msgspec.Meta` size constraints from PRD §7, rejecting hostile payloads *before* the parse completes.
- [ ] Maintain a per-connector consecutive-hostile-response counter (incremented on malformed JSON, oversized response, unexpected content-type, or msgspec validation failure):
  - [ ] **5 consecutive hostile responses → connector marked `degraded`** (rotation dispatch rate reduced; UI badge yellow);
  - [ ] **20 consecutive hostile responses → connector marked `unhealthy`** (rotation engine stops dispatching; only health probes continue);
  - [ ] every successful response decrements the counter; reaching zero restores `healthy` status (PRD §7 "Health Degradation Rather Than Crash").
- [ ] Implement error normalization: every httpx exception is wrapped in a `ComradarrError` subclass with request/response stripped from the message (PRD §20 traceback hygiene) and a transient/permanent classification (PRD §21).
- [ ] One app-scoped client per connector type; created in lifespan (RULE-HTTP-003 + DECIDE-HTTP-CLIENT).

#### 5.7.2 URL classifier (`comradarr/connectors/url_policy.py`)

- [ ] Implement `default`, `strict`, `permissive` per PRD §16 / Glossary.
- [ ] URL classifier rejects (in addition to the categories already listed in §5.7.1) the full PRD §7 enumeration as a code-level CIDR constant in `comradarr/connectors/url_classifier.py`: link-local `169.254.0.0/16` and `fe80::/10` (covers AWS/GCP/Azure/Oracle/DigitalOcean cloud metadata at `169.254.169.254`); multicast `224.0.0.0/4` and `ff00::/8`; unspecified `0.0.0.0` and `::`; broadcast `255.255.255.255`; documentation/test ranges `192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`, `2001:db8::/32`; benchmarking `198.18.0.0/15`; IPv4-mapped IPv6 `::ffff:0:0/96`. The constant set lives at one site and is consumed by the `default` and `strict` policy paths; `permissive` skips this denylist (PRD §7 / Glossary).
- [ ] **IPv4-mapped IPv6 normalization (pinned).** Before any CIDR comparison, every resolved IPv6 address that falls in `::ffff:0:0/96` is unmapped to its embedded IPv4 form (`ipaddress.IPv6Address.ipv4_mapped`) and re-classified against the IPv4 denylist; an attacker cannot bypass `127.0.0.0/8` rejection by submitting `::ffff:127.0.0.1`. Compatibility forms (`::a.b.c.d`) and 6to4 (`2002::/16`) are mapped to their embedded IPv4 and re-classified the same way. Any IPv6 address whose unmapped IPv4 form is in any rejected IPv4 range is rejected even though the original literal is technically in the IPv6 address space.
- [ ] **IDN / punycode handling (pinned).** Hostnames are parsed via `idna.encode(uts46=True, std3_rules=True)` so an attacker cannot smuggle an internal-name lookup through Unicode lookalikes. Reject any hostname whose IDNA-encoded form differs from its lower-cased ASCII input only by punycode (`xn--*` segments) when `COMRADARR_CONNECTOR_URL_POLICY=strict`. Trailing-dot hostnames (`example.com.`) are normalised to `example.com` before classification so a trailing dot cannot bypass an exact-host allowlist match. Hostname-only literals that parse as raw IPv4 / IPv6 (with or without brackets) skip IDNA and route directly to the IP classifier.
- [ ] When DNS resolution returns multiple A/AAAA records, ALL resolved IPs must classify as allowed; if any record falls in a rejected category, reject the URL — never select an allowed subset (PRD §7 prd:249 — mixed dual-stack classification is a refusal signal, not a "pick the safe one" hint).
- [ ] Reject schemes other than http/https.
- [ ] Reject userinfo in URL.
- [ ] Reject any URL carrying a fragment component (`#…`); fragments are not transmitted on the wire but their presence in a stored connector URL signals the operator pasted a browser-bar URL into the connector form and the actual *arr endpoint is in the path, not the fragment — fail-closed at config-write time so the misconfiguration cannot reach `httpx`.

#### 5.7.3 Connector factory (`comradarr/connectors/factory.py`)

- [ ] Resolve connector → typed client (Sonarr / Radarr / Prowlarr) based on the discriminator.
- [ ] Decrypt API key via crypto service using connector UUID as AAD.
- [ ] Run health probe at construction time.

### 5.8 Phase 8 — Sonarr / Radarr / Prowlarr clients

#### 5.8.1 Shared models (`comradarr/connectors/shared/`)

- [ ] Define msgspec Structs for the **shared command-status response shape** consumed by the rotation tracker (`CommandResource`-equivalent: `id`, `name`, `status` enum, `started_at`, `ended_at`, `errors[]`) and the **shared system-status shape** consumed by health probes. Note: the *arr download-queue surface (`/api/v3/queue`) is **out of scope for v1** — Comradarr only schedules searches, it does not introspect or manipulate the *arr download queue (PRD §6 / §11).

#### 5.8.2 Sonarr client (`comradarr/connectors/sonarr/`)

- [ ] msgspec models: Series, Season, Episode, Tag, QualityProfile, Command, SystemStatus.
- [ ] Methods: `list_series`, `get_series`, `list_episodes`, `command_episode_search`, `command_season_search`, `command_series_search`, `command_status`, `system_status`.
- [ ] Strict response validation (RULE-SER-001) — every connector-response Struct **explicitly sets `forbid_unknown_fields=True`** (this is **NOT** the msgspec default — `msgspec.Struct`'s default is `forbid_unknown_fields=False`, so the flag must be set per Struct via `class Foo(msgspec.Struct, forbid_unknown_fields=True): ...`) so a hostile or compromised *arr returning extra/unexpected fields is rejected with `ConnectorApiError` *before* the parse completes (PRD §7 hostile-response defenses; backend rules RECIPE-CRUD shows the explicit flag form). Mirror-table ORM rows have no equivalent constraint because they own their schema; the strict policy applies only to the on-the-wire connector response Structs that consume external bytes.

#### 5.8.3 Radarr client (`comradarr/connectors/radarr/`)

- [ ] msgspec models: Movie, QualityProfile, Command, SystemStatus.
- [ ] Methods: `list_movies`, `get_movie`, `command_movies_search`, `command_status`, `system_status`.

#### 5.8.4 Prowlarr client (`comradarr/connectors/prowlarr/`)

- [ ] msgspec models: Indexer, Tag, IndexerStatus.
- [ ] Methods: `list_indexers`, `get_indexer`, `system_status`.
- [ ] **In-memory indexer cache with a 5-minute TTL** (PRD §12 line 617 — operators tweak indexer lists frequently, so the cache must refresh quickly enough to reflect adds/removes/disables). Cache is invalidated on Prowlarr-emitted health events and on explicit operator-triggered refresh from the connector detail page; never persisted across process restarts.
- [ ] `mapper.py` mapping Prowlarr indexer → Sonarr/Radarr "indexer in this connector?" via tag matching.
- [ ] `health.py` background task polling Prowlarr indexer status; emits events to the bus when status changes.

#### 5.8.5 Recorded-fixture infrastructure

- [ ] Implement `tests/fixtures/recorder.py` capturing real request/response pairs from a configured upstream; redact the API key to a placeholder; commit fixture files under `tests/fixtures/<connector>/<scenario>/`.
- [ ] Implement `tests/fixtures/replay.py` matching method/path/headers and substituting the placeholder API key.
- [ ] Document the recording workflow in `CONTRIBUTING.md`.

### 5.9 Phase 9 — Sync engine

#### 5.9.1 Fingerprints (`comradarr/services/sync/fingerprint.py`)

- [ ] Compute a fingerprint over (series count, episode count, last-edit timestamps, monitored counts) per connector.
- [ ] Persist the previous fingerprint in `sync_state.fingerprint_json`.

#### 5.9.2 Differ (`comradarr/services/sync/differ.py`)

- [ ] Compare current vs. stored fingerprint and emit a structured changeset (added / removed / modified) per content type.
- [ ] Property-test invariants per PRD §22.

#### 5.9.3 Applier (`comradarr/services/sync/applier.py`)

- [ ] Idempotent upserts to `mirror_series`, `mirror_episodes`, `mirror_movies` plus `search_schedule` row creation/deletion and tier reassignment.

#### 5.9.4 Engine + coordinator

- [ ] `engine.py`: orchestrates one sync run per connector with full / deep / incremental modes (PRD §6).
- [ ] `coordinator.py`: background task tick that decides which connector needs which mode given timestamps in `sync_state` and configured intervals (PRD §6).
- [ ] Per-tick summarization log event (PRD §20).
- [ ] Emits `sync.started`, `sync.progress`, `sync.completed`, `sync.failed` events on the event bus.

#### 5.9.5 Mappers (`comradarr/services/sync/mappers/`)

- [ ] `sonarr.py`: connector model → mirror tables. The mapper validates **semantic invariants the wire schema cannot express** (PRD §6) — `season_number >= 0`, `episode_number >= 1` on aired episodes, `runtime_minutes >= 0`, monitored-flag consistency between series and its episodes — and rejects an offending row with `ConnectorSemanticError` so the differ never feeds malformed state into the applier. msgspec `Meta` constraints catch the structural floor; the mapper catches the cross-field invariants.
- [ ] `radarr.py`: connector model → mirror tables. Same semantic-validation discipline as sonarr — `runtime_minutes >= 0`, monitored flag well-formed, no negative IDs, no empty title strings.
- [ ] **Aggregate-count recomputation** (PRD §7 prd:343 — defends against `episodeCount: 999999999`-class semantic poisoning). Mapper recomputes aggregate counts (`seasonCount` from `seasons[]`, `episodeCount` from `episodes[]`) and trusts the recomputed value over any wire-provided value; wire `seasonCount` / `episodeCount` fields are read for telemetry only (recorded on a structured log event for drift visibility, never written to mirror tables or fed into rotation/sizing decisions). Applies to both `sonarr.py` and `radarr.py` mappers.
- [ ] **Date-plausibility coercion window** (PRD §7 prd:339). Air/release date fields outside `[1900-01-01, 2100-01-01]` are coerced to `None` rather than rejected — a malformed `airDate: 9999-12-31` would otherwise corrupt tier computation downstream. The mapper logs a structured `date_out_of_window` event with the original value bounded to 64 chars (longer values are truncated with an ellipsis marker; never the raw oversized string). The window bounds are code constants shared between Sonarr and Radarr mappers.

#### 5.9.6 Schedule writer (`comradarr/services/sync/schedule_writer.py`)

- [ ] Materialize `search_schedule` rows from the applied mirror diff in the **same database transaction** as the applier write (PRD §6 — schedule and mirror state must never disagree across a sync boundary). For every added mirror row, insert a `(connector_id, content_type, content_arr_id)` schedule row at tier 0 (MISSING) — or the tier classifier's chosen tier if the row arrives already monitored — with `last_searched_at = NULL`. For every removed mirror row, delete the corresponding schedule row. For modified rows, re-evaluate the tier and update only the `tier` column; never reset `last_searched_at` on a tier change (avoids re-spamming searches on a benign edit).
- [ ] Idempotent across replays: the writer is keyed on the same `(connector_id, content_type, content_arr_id)` PK as the schedule table, so a re-run on the same diff is a no-op. Emit a per-tick summary log event with insert/delete/tier-update counts.

### 5.10 Phase 10 — Rotation engine

> **Continuous-rotation principle (cross-ref PRD §10 / §11).** The rotation engine is a **continuous tier-prioritised cycle** over `search_schedule`, not a queue with a head and a tail. There is no "next-up batch," no FIFO ordering across the library, and no operator-visible "queue depth." The dispatcher selects eligible rows on every tick by `(tier ASC, last_searched_at NULLS FIRST)` and the cycle never pauses unless the budget is exhausted, the connector is `unhealthy`, or the operator pauses individual rows. Wording across this phase uses "schedule," "tier," "dispatch," "tick" — never "queue" — to keep the implementation aligned with PRD §10's invariant.

#### 5.10.1 Tier classifier

- [ ] Implement tier assignment per PRD §10: tier 0 MISSING, tier 1 RECENT, tier 2 MONITORED, tier 3 COMPLETED.
- [ ] Tier reassignment runs at sync apply time.

#### 5.10.2 Planner protocol + implementations (`comradarr/services/rotation/planners/`)

- [ ] Protocol `Planner.plan(eligible_items, budget) -> list[Command]` (PRD §11). **Cover-all contract (pinned, enforced by §6.1 property tests):** for every input item the planner MUST emit at least one `Command` whose payload covers it. The planner is allowed to fold N items into one command when the underlying *arr API supports a batched search (e.g. `EpisodeSearch` over an episode list, `SeasonSearch` over a whole season, `MoviesSearch` over a movie batch), but it MUST NOT silently drop, deduplicate-via-loss, or reorder-with-loss any input item. Output cardinality is `1 ≤ |commands| ≤ |items|`; aggregate per-item coverage is exactly the input set.
- [ ] Sonarr planner groups episodes → seasons → series; respects per-command limits; minimises commands (planner invariants per PRD §22 property tests). Grouping promotion thresholds match PRD §10 verbatim (no drift): **promote a season-search when 2 or more, or more than 30% of the season's episodes are eligible; promote a series-search when more than half of the series' seasons would be promoted, or at least 3.** The thresholds are code constants, not configuration; cross-reference PRD §10 in a comment at the constant declaration site so a future edit cannot silently re-tune them.
- [ ] Radarr planner groups movies into batched MoviesSearch commands sized to the per-command limit of the connector.
- [ ] Property tests (cross-ref §6.1): (a) output covers every eligible item exactly once across the resulting command set; (b) no command crosses connectors; (c) total commands ≤ items; (d) re-running the planner with the same input produces a permutation-equivalent plan (deterministic up to set-equivalence).

#### 5.10.3 Budget protocol + implementations (`comradarr/services/budget/`)

- [ ] `protocol.py`: `Budget.available_for(connector_id) -> int`.
- [ ] `default.py`: per-connector defaults — **daily limit 100 commands**, **max 2 concurrent in-flight commands**, **30-second minimum interval between commands** (PRD §11 line 577). Daily budget is spread evenly across the 24-hour window (no burst consumption — PRD §11 line 579).
- [ ] `prowlarr.py`: derives budget from Prowlarr indexer limits read via the 5-minute-TTL mapper cache; the effective per-connector budget is the **most restrictive indexer** serving that connector (PRD §12 line 619), and a **20% safety margin is subtracted off each indexer's own cap** before the minimum is taken — i.e. `effective_indexer_budget = floor(indexer_limits_max * 0.80) - usage_today` — to leave headroom for non-Comradarr traffic (Sonarr RSS sync, manual searches, other tools); reduces budget further when indexers flip to disabled (PRD §12 lines 633–635).
- [ ] `resolver.py`: chooses the right Budget at startup based on whether a Prowlarr connector is configured; can re-resolve when connectors change.

#### 5.10.4 Dispatcher (`comradarr/services/rotation/dispatcher.py`)

- [ ] Pull eligible rows from `search_schedule` ordered by `(tier ASC, last_searched_at NULLS FIRST)` (PRD §10).
- [ ] Consume `priority_searches` first (PRD §11 priority bypass).
- [ ] Hand off to the appropriate planner; insert resulting `planned_commands` rows; call connector client.

#### 5.10.5 Tracker (`comradarr/services/rotation/tracker.py`)

- [ ] Poll arr command status until terminal; update `planned_commands.status`; on success, advance `search_schedule.last_searched_at` for every covered item; on failure or timeout, log + emit event but do not advance (PRD §11).

#### 5.10.6 Engine loop

- [ ] Background task with bounded sleep tick; no-op when setup is incomplete; emits `rotation.dispatched`, `rotation.tracked`, `rotation.idle`.
- [ ] Per-tick summarization log event (PRD §20).

#### 5.10.7 Manual operations

- [ ] Endpoint to enqueue priority searches for a single item or filter.
- [ ] Endpoint to pause/unpause individual `search_schedule` rows.

### 5.11 Phase 11 — Event bus + SSE

#### 5.11.1 Event bus (`comradarr/core/events.py`)

- [ ] **In-process pub/sub** keyed on a typed enum of event names; subscribers are async iterators (PRD §13). **No external message broker** in v1 — Redis, RabbitMQ, NATS, etc. are explicitly out of scope; the bus lives in the same Python process as the rotation/sync/notification subscribers.
- [ ] **No event Struct contains a `Secret[T]` field.** The `msgspec` encode hook would refuse to serialize a `Secret[T]` (PRD §15 line 1058), and event payloads are emitted on-the-wire to the browser via SSE — secrets must never reach that surface. Enforced at code review **and** at runtime startup: a unit test scans every Struct annotation under `comradarr.core.events` for `Secret[...]` types and fails the test suite if any are found; the same scan runs as a startup self-check that aborts boot with a `ConfigurationError`.

#### 5.11.2 SSE controller (`comradarr/api/controllers/events.py`)

- [ ] `GET /api/events/stream` returning `text/event-stream`. The handler is `async def` per **RULE-ASYNC-001** and uses an `async` generator yielding `bytes` chunks; the generator awaits `asyncio.Queue.get()` with a timeout for the heartbeat tick — never `time.sleep`, never sync I/O, never thread-pool offload (RULE-ASYNC-002). **Per-client bounded queue with drop-on-full backpressure** — when a client's send queue fills (slow consumer), new events for that client are silently dropped rather than blocking the bus (PRD §13 line 663). The bus itself never awaits a client send. SSE clients reconnect and re-fetch state via regular API calls, so dropped events do not break correctness.
- [ ] Filters events by **scope + permission** (PRD §13 + §14 lines 685–687 — system-scope vs user-scope split). System-scope events (`connector.*`, `sync.*`, `rotation.*`, `auth.failed.*`, `audit_log.gap`, `notifications.suppressed`) are visible to **admins only** regardless of which user opens the SSE stream — they describe the install, not the user. User-scope events (`notification.delivery.*` for the operator's own channels, `priority_search.completed` for their own queued search, `session.opened`/`.revoked` for their own sessions) are visible to the owning user only. The filter is per-event-name with the scope encoded on the event Struct itself (system|user) so a future event automatically inherits the right routing.
- [ ] **Emit a heartbeat keepalive every 15 seconds** (`: heartbeat\n\n` SSE comment line) to keep idle reverse proxies and load balancers from closing the long-lived connection.

### 5.12 Phase 12 — Notifications

#### 5.12.1 Channels (`comradarr/services/notifications/channels/`)

- [ ] Apprise channel: lazy import `apprise`, encrypted config (URL). Supports any apprise URI scheme, including a **guided SMTP flow** that builds `mailto://` and `mailtos://` apprise URIs from a structured form (host, port, username, password, from-address, recipient list, TLS mode) — the operator never has to hand-craft the apprise URL.
- [ ] Webhook channel: encrypted bundle (URL, method, headers, body template). The dispatcher's outbound httpx call **pins `follow_redirects=False` on every webhook request** — same posture as the connector client (§5.7.1, PRD §7 redirect policy) — so a compromised webhook destination returning `302 Location: http://internal.example/secret` cannot trick the channel into leaking the operator's auth headers or reaching an internal SSRF target on the next hop. Any 3xx is wrapped in a transient `NotificationRedirectError` (target stripped from message) and counted as a delivery failure for retry; the operator sees `notification.delivery.redirect_refused` in the structured log.
- [ ] Per-channel TLS toggles wired through (`insecure_skip_tls_verify`, `tls_ca_bundle_path`) — same shape as connector TLS overrides per PRD §7 "Reuse by the Notification System".
- [ ] **URL classification re-runs at SAVE AND at SEND.** Both the channel-write path (`POST` / `PATCH /api/notifications/channels`) and the per-dispatch path re-classify every outbound URL — including every redirect hop — against the same SSRF denylist used by connectors (§5.7.1). A previously-saved channel config can become hostile if the denylist or `COMRADARR_CONNECTOR_URL_POLICY` is tightened, so write-time checks alone are not sufficient (PRD §7 "Reuse by the Notification System"). Send-time rejection logs a structured `notification.delivery.blocked_ssrf` event and counts as a permanent failure — no retries.
- [ ] Test-before-commit: `POST /api/notifications/channels/test` runs a one-shot send through the same dispatcher (including SSRF re-classification); only persists when successful (PRD §14).

#### 5.12.2 Routes

- [ ] `(user, event_type, channel)` rows; absence is the off-switch.
- [ ] Predicate column null in v1.
- [ ] **Default routing profile for security-critical events** seeded on first-channel-creation per user (PRD §14 lines 725–733). Operators inherit the profile out of the box; each row can be toggled off per-channel afterward. The profile enables, on the user's first channel:
  - **Security events** (always-on by default): login anomalies (new session opened, burst of 5+ failed logins within 5 minutes), password change, API key created/revoked, **OIDC failures** (provider authentication errors, token validation failures), **audit-log gaps** (missed/dropped audit-log writes), **recovery-mode usage** (any successful recovery-token redemption or recovery-mode session start);
  - **Operational health** (admin only): connector reachability flips, indexer disabled/re-enabled (coalesced — see §5.12.4), 3+ consecutive sync failures, 80% daily-cap budget threshold;
  - **User-initiated**: priority search completed.
- [ ] The defaults are seeded **once per `(user, channel)` pair on first-channel creation**, not on every channel; subsequent channels start with all routes off so an operator who silenced "new session" on channel A does not get it re-enabled on channel B (PRD §14 line 727).

#### 5.12.3 Templates

- [ ] Constrained engine — accepts **only** three constructs: `{{variable_name}}` substitution, `{{#if variable_name}}…{{/if}}` conditional blocks (no nesting, no `else`, no expressions), and gettext built-ins resolved at render time (PRD §14 lines 747–751). Any other syntax — method calls, attribute access, computed values, loops, macros, partials, `{{>...}}`, `{{!...}}`, or anything else — is **rejected at parse time** with `TemplateValidationError`. The renderer is a regex-driven pass with no expression evaluator, by construction eliminating the SSTI surface.
- [ ] Lookup order at send: user override → translated built-in for recipient locale → English (PRD §14).
- [ ] Built-in defaults registered as gettext message keys under `notification.{event_type}.{channel_kind}.{subject|body}` (PRD §28).

#### 5.12.4 Dispatcher

- [ ] Subscribes to the event bus; resolves routes per event; renders templates; sends. **Fire-and-forget** from the bus subscriber's perspective — sends are scheduled on an `asyncio.TaskGroup` so a slow destination cannot backpressure the bus (PRD §14 line 775).
- [ ] **Retry sequence pinned in code** (PRD §14 line 773): initial attempt with **10 s timeout**; on failure, retry after **1 s with 15 s timeout**, then after **5 s with 20 s timeout**, then after **30 s with 30 s timeout**. **3 retries total after the initial attempt**, then abandon and log a `notification.delivery.failed` WARN entry. **No dead-letter queue, no delivery-attempt table** — the structured log stream is the only delivery record (PRD §14 line 777).
- [ ] **`notifications_enabled` global kill-switch** in the `app_config` table (PRD §14 line 801, default `true`). When `false`, the dispatcher's bus subscriber stays attached but every delivery short-circuits to a no-op before any adapter is invoked. The audit log still records that the originating event fired and that the notification was suppressed (`notification.dispatch.suppressed`); the structured log stream records nothing per-attempt because there is no attempt. The settings UI surfaces the toggle prominently and renders a banner on every notification-related settings page whenever the switch is off.
- [ ] **60-second rolling coalescing window for operational-health events** (PRD §14 lines 781–787): when the first event in the operational-health category arrives, a coalescing timer starts; subsequent operational-health events arriving during the window are accumulated in memory; on window expiry, a single grouped notification is rendered from the summary template. The 60-second value is a code constant, not configuration.
- [ ] **Security events and user-initiated events bypass coalescing entirely** — each fires its own notification regardless of category volume (PRD §14 line 785). The dispatcher routes by event-category tag, not by event name, so adding a new security event automatically inherits the bypass.
- [ ] Audit-log delivery success/failure under `notification.delivery.sent` and `.failed` (PRD §20); kill-switch suppression under `notification.dispatch.suppressed`.

### 5.13 Phase 13 — API layer

#### 5.13.1 Controller layout (`comradarr/api/controllers/`)

- [ ] Implement Controllers per PRD App. A: `auth`, `connectors`, `events`, `health`, `sync`, `search`, plus `views/` BFF controllers (`dashboard`, `content`, `rotation`, `settings`).
- [ ] Permission-check middleware reads `role_permissions` + `api_key_scopes` and returns 403 for missing permissions (PRD §26).
- [ ] **Dependency injection (RULE-DI-001 pinned).** Controllers and route handlers receive their collaborators (services, repositories, the audit writer, the dispatcher) exclusively via Litestar's `dependencies={...}` map declared on the `Controller` class or `Router`, never by reaching into `request.app.state.<name>` from inside a handler body and never via module-level singletons. Provider callables that build per-request scopes return an `AsyncGenerator[T, None]` so cleanup runs on response finalize. Tests substitute fakes by overriding the same `dependencies={...}` map on the test app — there is no monkey-patch surface in production code.

#### 5.13.2 Schemas (`comradarr/api/schemas/`)

- [ ] `auth.py`, `connectors.py`, `content.py`, `views.py`, `common.py` — every request and response is a `msgspec.Struct` (RULE-SER-001); Pydantic models and stdlib `dataclasses` are forbidden at the API boundary (RULE-SER-002).
- [ ] DTOs only when shape projection differs from the Struct (DECIDE-DTO).
- [ ] **`msgspec.Meta` constraint enumeration on every input field — defense in depth alongside the streaming byte budget from §5.7.1** (PRD §15.6 / §7 hostile-response defenses). Required `Annotated[..., msgspec.Meta(...)]` constraints by category:
  - **Strings**: `max_length` on every free-form text field (usernames ≤ 64; passwords ≤ 1024; display names ≤ 200; URLs ≤ 2048; CIDRs ≤ 43; arbitrary notes ≤ 4096). `pattern` regex on identifier-shaped fields (provider short-names: `^[a-z][a-z0-9_-]{0,31}$`; connector names; permission names). `min_length=1` wherever empty is invalid.
  - **Integers**: `ge`/`le` on every numeric field (port `ge=1, le=65535`; per-connector daily limit `ge=1, le=10000`; concurrent in-flight `ge=1, le=100`; pagination `size` `ge=1, le=500`; budget percentages `ge=0, le=100`).
  - **Collections**: `max_length` on every list/dict field (allowed_origins ≤ 50; trusted-proxy IPs ≤ 100; api_key_scopes ≤ 32; oidc scopes ≤ 16; route predicates ≤ 16). Reject empty lists where the schema requires at least one entry.
  - **Discriminated unions**: `tag_field` + `tag` on every polymorphic Struct (connector type, notification channel kind, OIDC provider kind) so msgspec rejects unknown tags before any handler runs.
  - **Forbid extras**: every Struct **explicitly sets `forbid_unknown_fields=True`** as a class kwarg (`class Foo(msgspec.Struct, forbid_unknown_fields=True): ...`). This is **NOT** the msgspec default — `msgspec.Struct`'s default is `forbid_unknown_fields=False`, so omitting the flag silently accepts hostile extra fields. The convention is "explicit on every Struct that crosses an external boundary" — request bodies, response bodies, connector parsers, settings — matching the form in backend rules RECIPE-CRUD.
- [ ] Constraint regression test: a Hypothesis property test that round-trips arbitrary JSON through every input Struct and asserts that any payload exceeding any declared `Meta` bound is rejected with `msgspec.ValidationError` *before* the handler runs (covers the bound is wired, not just declared).

#### 5.13.3 Cursor pagination

- [ ] Implement `(sort_key, id)` keyset cursor encoder/decoder using `base64url(json)` with HMAC.
- [ ] Stable sort keys per resource (date, name, tier, last_searched_at).

#### 5.13.4 Endpoint surface

- [ ] **Auth:** login, logout, session validate, password change, OIDC start, OIDC callback, trusted-header probe, recovery flow (gated by `COMRADARR_RECOVERY_MODE`).
- [ ] **Recovery-mode acknowledgement.** Per PRD §15 "On successful recovery, the recovery-mode flag is cleared": because the backend cannot mutate the operator's environment, on a successful recovery-token claim the backend writes a `recovery_mode_acknowledged_at` timestamp row to `app_config`. On every subsequent boot, if `COMRADARR_RECOVERY_MODE=1` is still set in the environment, the bootstrap path compares the acknowledgement timestamp against the process start time: when the acknowledgement is newer than process start, the backend logs a prominent warning instructing the operator to unset the env var and refuses to issue a new recovery token (the recovery flow is inert until the env var is cleared and the next boot writes a new process-start timestamp). This preserves the "log access = privilege" trust model while preventing the env var from re-arming a recovery flow that has already been consumed.
- [ ] **API keys:** create (returns plaintext once), list, revoke (own + admin all).
- [ ] **Sessions:** list active sessions for the current user (creation time, last-seen, source IP, user-agent — all informational per PRD §15), revoke individual session, "revoke all other sessions" action.
- [ ] **Connectors:** list, add (with live test), edit, delete, pause, manual sync trigger.
- [ ] **Content:** search/filter/sort with cursor pagination at scale (500k+ items); detail view; trigger manual search; pause/unpause item.
- [ ] **Sync:** status per connector, manual full/deep/incremental.
- [ ] **Search:** dispatcher status, in-flight commands, history.
- [ ] **Settings (HTTP boundary):** get/set + live test (mirrors wizard step UX in post-setup).
- [ ] **OIDC providers:** CRUD with secret rotation.
- [ ] **Audit log:** paginated list, filters by action, time range, actor; JSON-lines export.
- [ ] **Notifications:** channels CRUD + test, routes CRUD, templates CRUD.
- [ ] **Snapshots:** export, import (Phase 21).
- [ ] **Users:** v1 self-service only; admin-level management deferred but endpoints stub permission checks.
- [ ] **OpenAPI documentation routes (cross-ref §5.1.4).** `/api/schema`, `/api/docs`, `/api/redoc` are authenticated, rate-limited at 10/hr/IP, and on unauthenticated access return `401` with no response body and no CORS headers (per the §5.1.4 owner's decision). The setup-gate middleware allowlists these routes pre-setup-completion so the wizard's API client can introspect the schema.

#### 5.13.5 BFF endpoints

- [ ] `GET /api/views/dashboard` — single composed payload with summary stats + activity feed + per-connector status.
- [ ] `GET /api/views/content` — paginated rows with the exact columns the content browser needs.
- [ ] `GET /api/views/rotation` — current schedule snapshot + next-up items.
- [ ] `GET /api/views/settings/http-boundary` — current values + observed values for inline test cards.

### 5.14 Phase 14 — Frontend foundations

#### 5.14.1 SvelteKit setup

- [ ] Confirm folder layout per frontend rules §7 and **RULE-SK-FILES-001** (route files: `+page.svelte`, `+page.ts` universal, `+page.server.ts` server-only, `+layout.svelte`, `+layout.ts`, `+layout.server.ts`, `+server.ts` endpoints, `+error.svelte`, `hooks.server.ts`, `hooks.client.ts`; shared lib code in `src/lib/`, server-only code in `src/lib/server/`): `src/lib/`, `src/lib/server/`, `src/lib/state/`, `src/lib/api/`, `src/lib/components/ui/`, route groups `(app)/`, `(auth)/`, `(setup)/`, `(public)/`.
- [ ] **Server-first load posture (RULE-SK-LOAD-001 + RULE-SK-SERVERONLY-001).** Any load function that touches the database, cookies, private env vars, or internal backend APIs lives in `+page.server.ts` / `+layout.server.ts`; only loads that consume an already-public, safe-to-expose surface use `+page.ts` / `+layout.ts`. Server-only imports (private env from `$env/static/private` / `$env/dynamic/private`, DB clients, secret handlers) come from `src/lib/server/` or `*.server.ts` modules — SvelteKit's compiler rejects accidental client leaks (**RULE-SEC-002** — prefer `$env/static/private` over `$env/dynamic/private` to enable dead-code elimination at build time; reach for `$env/dynamic/*` only when the value must change between build and runtime). The Comradarr default is server-first: a contributor adding a new route reaches for `+page.server.ts` first and downgrades to `+page.ts` only when the data is provably non-sensitive.
- [ ] Configure `app.html` with the inline 4-line theme-resolution script (PRD §25 SSR theme handling).
- [ ] Configure `hooks.server.ts` to: read session cookie, call backend session-validate, populate `event.locals.user` / `event.locals.session`, redirect non-public routes to login when missing (RULE-SEC-003 + **RULE-AUTHZ-MATCH-001** — route-allow checks use exact-pathname or `URL.pathname.startsWith(prefix)` against a fixed allowlist, never `String.includes("login")` / regex / fuzzy matches that an attacker can satisfy with a crafted path; the comparator is fail-closed — if the session-validate call fails with anything other than 401/403 the hook treats it as `not authenticated` and redirects, never as `authenticated by default`).
- [ ] Configure `app.d.ts` `App.Locals`, `App.PageData`, `App.Error`. **Canonical `App.Locals` shape (pinned):** `{ user: SessionUser | null; session: ActiveSession | null; csp_nonce: string; correlation_id: string; locale: string; theme: 'light' | 'dark' | 'system'; }` — `user` and `session` are populated by `hooks.server.ts` after the backend session-validate call and are `null` for unauthenticated requests; `csp_nonce` is read from the request state injected by the Phase 6 CSP middleware (§5.6.6) so SSR can stamp it on inline `<script>` / `<style>` tags; `correlation_id` mirrors the structlog request context so client-side error reports can be cross-referenced with backend logs; `locale` and `theme` resolve in `+layout.server.ts` from user preferences or `Accept-Language` / cookie. Nothing else lives in `App.Locals` — no encrypted secrets, no API keys, no raw cookie values, no role permissions arrays (those are derived per-request from the backend, never cached on locals).
- [ ] Any frontend code reading the current page must import from `$app/state`, never `$app/stores` (RULE-SK-STATE-001, ANTI-SK1-002). Read `page`, `navigating`, `updated` as plain properties (e.g. `page.url.pathname`, `page.data`) — the legacy `$page.url.pathname` reactive-store form is forbidden in Svelte 5 + SK ≥ 2.12 code.
- [ ] Configure `src/lib/utils.ts` `cn()` helper for shadcn class composition (frontend rules §10).

#### 5.14.2 Theme + UnoCSS

- [ ] Confirm `presetWind4` + `unocss-preset-shadcn` + `extractorSvelte` registered (RULE-UNO-001 / RULE-UNO-002 / RULE-UNO-003 — preset order, preset-shadcn integration, extractor for Svelte components); per **ANTI-RESET-001**, never import `@unocss/reset/*` alongside `presetWind4` — the preset ships its own preflight and a stacked reset double-applies normalisation.
- [ ] Move tweakcn Northern Lights tokens into `src/app.css` `:root` and `[data-theme="dark"]`.
- [ ] Add `--spacing-local` override mechanism per surface (PRD §25 density scales).
- [ ] Implement `useReducedMotion` composable (PRD §25 motion contract).

#### 5.14.3 OpenAPI client (`src/lib/api/`)

- [ ] `scripts/gen-api.ts` runs `openapi-typescript http://localhost:8000/api/schema/openapi.json -o src/lib/api/schema.d.ts` (**RULE-OAPI-001** — consume Litestar's OpenAPI surface at the canonical `/api/schema` mount from §5.1.4) and emits the file with **`@ts-nocheck`/checksum header** so **RULE-OAPI-002** (generated types are machine-owned — never hand-edited) is enforceable as a CI lint: a pre-commit / CI step diffs the regenerated file against the committed copy and fails on any drift, so a developer who hand-edits `schema.d.ts` is caught at PR time. Per **RULE-OAPI-002** the openapi-fetch wrapper never silently coerces a non-2xx response into success — every consumer must check the discriminated `{ data, error }` union before reading the body; a "no-error-field-so-it-must-be-fine" default is forbidden, and a project-local lint catches `result.data!` non-null assertions and bare `.then(r => r.data)` patterns at PR time.
- [ ] `client.ts` exports `createBrowserClient()` returning `createClient<paths>({ baseUrl: '' })` (RULE-OAPI-002 — typed `createClient<paths>()` with discriminated `{ data, error }` reads on every call site). **Same-origin BFF pattern (pinned):** `baseUrl: ''` is intentional — Comradarr's frontend and backend are served from the **same origin** (the SvelteKit Bun adapter's server reverse-proxies `/api/*` to the Litestar backend, or both are mounted under one Granian process), so relative paths route through the browser's same-origin policy without CORS preflight, the `comradarr_session` cookie is sent automatically, and a misconfigured `baseUrl: 'http://localhost:8000'` (cross-origin) would either drop the session cookie or trigger a CORS reject. The empty string also lets the same-origin posture from PRD §16 (CORS allowlist defaults to `[public_origin]`) hold without a separate frontend-config knob.
- [ ] `server.ts` exports `createServerClient(event)` returning `createClient<paths>({ baseUrl: '', fetch: event.fetch })` (**RULE-OAPI-002** + **RULE-OAPI-003** + **RULE-SK-FETCH-001** — load functions and server endpoints use the framework-provided `event.fetch`, never global `fetch`, so cookies / headers propagate, relative URLs work during SSR, and internal `+server.ts` calls coalesce without an HTTP round-trip; the typed paths binding is identical to the browser client). **Why no auth middleware on `createServerClient` itself:** authentication is cookie-based and `event.fetch` automatically forwards the request's `Cookie` header to the backend, so the server client does not need to inject a token or read `event.locals.user` — the backend's session middleware (Phase 6) is the single authority. The hooks in `hooks.server.ts` (§5.14.1) populate `event.locals.user` for SvelteKit's downstream loads / actions, but the openapi-fetch client itself stays auth-agnostic. Per RULE-SK-FETCH-001 a global `fetch(...)` call inside any `+*.server.ts` or `+server.ts` is a defect — code review and an ast-grep gate (registered in §5.23) reject it.
- [ ] Add the `gen-api` script to dev-CLI and to a CI step that fails when the regenerated file diffs from the committed one.

#### 5.14.4 App shell

- [ ] Implement sidebar navigation in `src/routes/(app)/+layout.svelte` using shadcn Sidebar primitive; collapses below `md`, hamburger below `sm` (PRD §25 app shell). All Svelte 5 component code in this layout follows **RULE-SNIPPETS-001** — render fragments use `{#snippet}` / `{@render}` (Svelte 5 native), never the legacy `<svelte:fragment slot="…">` / `<slot />` slot API which is deprecated for new code on a Svelte 5 target. Existing shadcn-svelte components that still expose slot props are wrapped at the consumer site with snippet-bridges, never copied into local code as slot-based.
- [ ] Sidebar consumes only `sidebar-*` tokens.
- [ ] Implement persistent rotation heartbeat indicator near the wordmark — bound to a `RotationStatusStore` derived from SSE.
- [ ] Implement focus-ring style using `ring` token (a11y baseline).

#### 5.14.5 Motion contract scaffolding

- [ ] Implement `tint-on-change` directive: wrap a card in `<TintOnChange watch={value}>`; CSS keyframe + atomic value swap (PRD §25).
- [ ] Implement page-load cascade utility for above-the-fold reveals; only on hard loads / route-group crossings.
- [ ] Universal `prefers-reduced-motion: reduce` collapse to atomic state swaps (PRD §25 + §28).

#### 5.14.6 Theme SSR

- [ ] Implement `comradarr_theme_pref` cookie read in `hooks.server.ts`.
- [ ] Resolve `data-theme` attribute server-side for authenticated users; for `system` users + unauthenticated visitors use the cookie (PRD §25).
- [ ] Add a form-action endpoint to update theme preference (writes DB row + cookie). **RULE-SK-FORMS-001:** the mutation is implemented as a SvelteKit form action — server logic lives in `+page.server.ts` `actions = { ... }`; the client uses `<form method="POST" use:enhance>` with `enhance` imported from `$app/forms` for progressive enhancement. A client-only JSON `POST` that bypasses the form-action surface is forbidden — it would skip SvelteKit's built-in CSRF Origin check (frontend RULE-SEC-001).

#### 5.14.7 Auth route group

- [ ] `(auth)/login/+page.svelte` + `+page.server.ts` form action (RULE-SK-FORMS-001 — form actions + `use:enhance`; the login mutation must be a `<form method="POST" use:enhance>` driven by `actions = { default: ... }` in the server module, not a client-side `fetch('/login', { method: 'POST' })`); OIDC provider buttons; trusted-header banner.
- [ ] `(auth)/+layout.svelte` minimal centered card layout.

### 5.15 Phase 15 — Frontend setup wizard

- [ ] `(setup)/+layout.svelte` minimal layout that links to `/setup` and never shows the app shell.
- [ ] `(setup)/+page.svelte` claim screen prompting for the bootstrap token; submits to `/api/setup/claim` with the CSRF-exempt fetch path; shows next step after success.
- [ ] `(setup)/boundary/+page.svelte` four-step HTTP boundary verification UI implementing the test-driven configuration affordance: observed → proposed → testing → committed/rejected (PRD §25 + Glossary).
- [ ] `(setup)/admin/+page.svelte` admin account creation form with password strength indicator and denylist enforcement message; submits to `/api/setup/admin`.
- [ ] On success, navigate to `(app)/` and replace the setup-claim cookie (already cleared server-side).

### 5.16 Phase 16 — Frontend dashboard

- [ ] `(app)/+page.svelte` dashboard with: rotation heartbeat status card, sync progress per connector, search throughput, budget consumption, recent activity feed; each card consumes a typed slice of the BFF payload (RULE-RUNES-001 / RULE-RUNES-002 — `$state` for component-local reactivity, `$derived` for computed slices, no legacy `let`-based stores). **All `+page.svelte` files consume `data` via `let { data } = $props()`; `export let data` is forbidden (RULE-RUNES-001, ANTI-SVELTE4-002).** **ANTI-EFFECT-001** — never use `$effect` to derive state from other state (use `$derived`); **ANTI-EFFECT-002** — never use `$effect` to chain reactive writes back into the same dependency graph (the cycle warning is a defect, not a noise to silence). `$effect` is reserved for genuine lifecycle side-effects (DOM measurement, EventSource wiring, subscription teardown).
- [ ] `+page.server.ts` calls `GET /api/views/dashboard` (RULE-SK-LOAD-001 — dashboard data is session-scoped and reads `event.locals` / authenticated cookies, so it lives in the server load, not `+page.ts`; RULE-SK-FETCH-001 — uses `event.fetch`, not global `fetch`).
- [ ] `src/lib/state/sse.svelte.ts` class-based store wrapping `EventSource('/api/events/stream')`; reconnect with backoff; exposes `events` reactive list and per-event `subscribe` callbacks (RULE-RUNES-003 / RULE-RUNES-004 — class-based stores using `$state` over module-level let bindings; `$effect` for lifecycle wiring **only**, not for derivations — see ANTI-EFFECT-001 / ANTI-EFFECT-002 above). The SSE store is browser-only; importing it from any `+*.server.ts`, `+server.ts`, or `hooks.server.ts` is forbidden (RULE-RUNES-004 + **ANTI-SEC-003** — module-top-level `$state` on the server leaks data between users). Add a top-of-file comment to `src/lib/state/sse.svelte.ts` calling out the browser-only constraint and add an ast-grep rule under `tools/lint/ast-grep/no-server-sse-store.yml` (the rule definition is scheduled in §5.23 "Anti-pattern lint gates"). Typed event names are imported from a shared TypeScript module generated from `comradarr/core/events.py` (the cross-stack registry declared in §5.0.5) so a backend rename surfaces as a frontend type error at `bun run check` time, never at runtime — string literals at SSE call sites are forbidden by code review.
- [ ] On every applicable SSE event, call `invalidate('app:dashboard')` so SvelteKit re-runs the load.
- [ ] Tint-on-change wraps every counter; numerals render `font-mono`.
- [ ] Hero area carries the subtle aurora gradient wash (PRD §25).

### 5.17 Phase 17 — Frontend content browser

- [ ] `(app)/content/+page.svelte` with virtual scrolling via TanStack Virtual; `$state.raw()` for the row list (PRD §25 content browser at scale).
- [ ] `+page.server.ts` reads `?cursor=&q=&filter=&sort=&size=` from URL, calls `GET /api/views/content`.
- [ ] Search input debounced 300ms before pushing to URL params.
- [ ] Density-tight surface override of `--spacing-local`.
- [ ] No aurora wash in the data grid.
- [ ] Mobile breakpoint collapses to one-line rows.

### 5.18 Phase 18 — Frontend connectors / settings / audit log / API keys / OIDC / notifications / sessions

> **Phase-wide rule citations.** Every component in §5.18.1–§5.18.6 follows: **RULE-RUNES-001/002/003/004** (`$state` / `$derived` / class-stores / `$effect` for lifecycle only), **ANTI-EFFECT-001/002** (no derivations and no reactive write-loops in `$effect`), **RULE-SNIPPETS-001** (`{#snippet}` + `{@render}` for slotting — no `<slot />` / `<svelte:fragment slot>` in new code on a Svelte 5 target), **RULE-EVENTS-001** (lowercase HTML event attributes — `onclick={...}`, never `on:click={...}`), **RULE-SK-FILES-001** (route file conventions: `+page.svelte` / `+page.ts` universal / `+page.server.ts` server-only / `+layout.*` / `+server.ts` endpoints / `+error.svelte`; `src/lib/server/` for server-only modules), **RULE-SK-LOAD-001** (server load functions for protected or secret-reading data — every Settings / API-keys / OIDC / sessions / audit-log surface lives in `+page.server.ts`), **RULE-SK-SERVERONLY-001** (private env, DB clients, secret handlers reachable only from `$lib/server/` or `*.server.ts`), **RULE-SK-FETCH-001** (load functions use `event.fetch`, not global `fetch`), **RULE-SK-FORMS-001** (mutations are form actions + `use:enhance`, not client-only JSON POSTs), **RULE-OAPI-001/002** (typed paths via the openapi-typescript-generated `schema.d.ts` — never hand-edited), and **RULE-AUTHZ-MATCH-001** (exact-string allowlists for any path/origin/role check; no permissive defaults on auth-adjacent comparisons). Cited once here so individual section bullets can reference behaviour without re-citing the rule on every line.

#### 5.18.1 Connectors

- [ ] List page with status badges (healthy / degraded / unreachable) sourced from SSE health events.
- [ ] Add/edit form with TLS toggles and live test button (test runs through the test-driven configuration affordance).
- [ ] Per-connector detail with sync status, last error, recent commands.

#### 5.18.2 Settings

- [ ] HTTP boundary editor with the same affordance used in the wizard (observed/proposed/testing/committed) — shared component lives at `src/lib/components/TestDrivenField.svelte`.
- [ ] OIDC providers list/edit; secret rotation flows.
- [ ] **Trusted-header settings page.** Implements the PRD §15 trusted-header authentication surface:
  - Enable/disable toggle, header-name picker (presets for authelia/authentik/traefik ForwardAuth/nginx-ingress + custom), optional companion email header field, provisioning policy selector (auto-provision vs. strict-match), and a `logout_url` field.
  - **Typed-out confirmation modal** when adding or changing entries in the trusted-proxy IP allowlist. The modal renders the literal PRD §15 copy: "Adding this IP or range grants permission to log in as any user by setting an HTTP header. Only proceed if you control every host in this range and every process on it. Do you want to continue?" The operator must type a confirmation phrase verbatim (a click-through is not sufficient — PRD §15 mandates typed confirmation). **Exact phrase to type: the literal IP or CIDR being added** (e.g. typing `10.0.0.5` to confirm adding `10.0.0.5`, or typing `192.168.1.0/24` to confirm adding that range). Content-binding the typed string to the value being added defeats muscle-memorisation across multiple ranges and forces the operator to look at the IP/CIDR they are about to grant header-auth to. The validation is server-side (§5.4.3) so a tampered front end cannot bypass it.
  - **Warning banner** rendered prominently on the trusted-header settings page whenever the trusted-header provider is enabled and the `logout_url` field is empty (per PRD §15: "When the trusted-header provider is enabled, the settings UI flags a missing logout URL as a warning").
  - Form-level validation rejects invalid IP/CIDR entries with a specific error.
  - Audit log entries surface both the authenticating user and the trusted-proxy IP that attached the identity header.
- [ ] Connection policy selector (default / strict / permissive) with explanatory copy and a "this is destructive" warning when permissive is chosen.
- [ ] Theme + locale + timezone preferences.
- [ ] **Install name editor** (PRD §15 + §30 + §3 resolution): edit the `install_name` row in `app_config`; default `comradarr`. Used in snapshot filenames.

#### 5.18.3 Audit log

- [ ] Paginated, filterable list (action, actor, time range).
- [ ] Detail drawer rendering structured context with secret values redacted.
- [ ] Export to JSON-lines via streamed download.

#### 5.18.4 API keys

- [ ] List page with prefix + last_four + last_used_at.
- [ ] Create modal with optional scope picker; **one-time plaintext reveal contract (pinned, PRD §15 / §26):** the plaintext token is rendered exactly once in a copy-to-clipboard reveal panel inside the same response that created the row; the panel cannot be reopened or re-rendered for any subsequent navigation, refresh, or refetch — closing the dialog (or any route change) tears the plaintext out of component state and `$effect` cleanup zeroes the underlying `$state` reference. The plaintext is **never** placed in `+page.server.ts` `data`, in the `actions` returned object that survives across navigations, in `localStorage`, in `sessionStorage`, in URL query/hash, or in the audit log; it lives in a **server load-action return that is consumed once** and a transient client-side `$state` slot that is explicitly cleared on dialog close. The list page renders prefix + `last_four` only — verifying a returning request's API key uses Argon2id `verify` against the persisted hash with constant-time comparison (per **RULE-SEC-001** + the rate-limit machinery in §5.4.7), never plaintext or prefix-only matching. A copy of the documentation banner ("save this now — Comradarr will never show it again") is shown above the reveal panel and tested by the snapshot UI tests in §6.
- [ ] Revoke confirmation dialog.

#### 5.18.5 Notifications

- [ ] Channels list + create wizard supporting the apprise URL pattern (with a guided SMTP `mailtos://` builder per PRD Glossary) and the webhook (URL/method/headers/body) bundle.
- [ ] Routes matrix UI: rows = event types, columns = channels, cells = enabled toggle.
- [ ] Templates editor per `(event_type, channel_kind)` showing built-in default + override field; warns when `{{variable}}` placeholders are dropped.
- [ ] Test send button per channel.

#### 5.18.6 Sessions

- [ ] Sessions list page (PRD §15 mandates this UI affordance) showing every active session for the current user — creation time, last-seen, source IP, user-agent, authenticating provider (local / trusted-header / oidc:&lt;provider&gt;), and a marker for the current session.
- [ ] Per-row "revoke" action.
- [ ] **"Revoke all other sessions" button** that revokes every session for the current user except the one making the request. Confirmation dialog warns this signs out every other browser/device.
- [ ] Audit-log entries on every revocation.
- [ ] Reflect SSE-driven updates so a session revoked elsewhere disappears live.

### 5.19 Phase 19 — i18n + accessibility

#### 5.19.1 Backend i18n

- [ ] Add gettext infrastructure under `comradarr/core/i18n.py`; load `.po` catalogs at startup.
- [ ] Wrap every user-facing error message; substitute context values into the translated template.
- [ ] Notification template defaults registered as gettext message keys.
- [ ] Dev-CLI command `dev_cli i18n extract` updates source catalogs.

#### 5.19.2 Frontend i18n

- [ ] Adopt **Paraglide (`@inlang/paraglide-js-adapter-sveltekit`)** per the §3 resolution and configure JSON catalogs by feature area under `frontend/messages/`. The compiled message functions are Svelte-5-Runes-friendly and tree-shake per-route.
- [ ] Wire SSR-time locale resolution from `event.locals.user.locale` (authenticated) or `Accept-Language` (unauthenticated), output to the html `lang` attribute.
- [ ] Locale selector in user preferences; **default-off "show incomplete translations" toggle** (`user_preferences.show_incomplete_translations`, defaulting to `false`) gates locales whose translation completeness is below 90 % so a casual user does not land in a partially-translated UI by accident. The threshold is a code constant; Weblate's exported per-locale completeness percentages are consumed at build time and shipped as a static `locales.json` next to the message catalogs. When the toggle is off, the locale picker shows only "complete" locales (≥ 90 %) and a single "show all" affordance that flips the toggle for the current user; when on, every locale is offered with a percentage badge so the user is never surprised by an English fallback.

#### 5.19.3 Weblate integration

- [ ] Add `translations/` directory with backend `.po` and frontend JSON; document the polling configuration on the Weblate side.
- [ ] CI step extracting strings on every PR and committing the diff for translators.

#### 5.19.4 Accessibility

- [ ] Add `axe-core` to the component test harness; fail on AA violations.
- [ ] Confirm shadcn-svelte components inherit Bits UI a11y; replace any custom-built widgets with shadcn primitives where possible.
- [ ] Implement keyboard-only navigation flows: tab order, focus-trap dialogs that release on close, escape-to-close menus, arrow-key navigation in the sidebar.
- [ ] Use `<label>` with for/id pairing on every input; `aria-describedby` for inline help; live regions for SSE-driven announcements.
- [ ] Verify color contrast across `light` and `dark` themes via the automated contrast check in the test suite.
- [ ] Responsive layout from 360px upward.

### 5.20 Phase 20 — Observability

#### 5.20.1 Logging finalization

> **Audit log vs structured log — separation of concerns (PRD §15 + §20).** The `audit_log` database table and the structlog stream are **two separate surfaces with two separate retention models**. Audit log: durable, role-separated DB privileges (write via app role, vacuum via audit-admin role only — §5.2.3 / §5.3.3), exhaustive enum of operator-visible actions (`bootstrap_token_generated`, `connector_added`, `password_changed`, …), filterable from the admin UI (§5.18.3), exportable as JSON-lines, retained until the configured cap. Structured log: ephemeral container stdout/stderr stream consumed by the operator's log collector, request-completion events + service-tick summaries + tracebacks + WARN/ERROR signal, never the operator's source of truth for "did X happen". A given event may emit to both surfaces (e.g. `auth.login_success` → audit-log row AND structlog `auth.login.success` event), but neither surface ever shadows the other and the structured-log stream is never queried as evidence of a privileged operation.

- [ ] Implement structlog configuration switching `console`/`json` per `COMRADARR_LOG_FORMAT` (PRD §20).
- [ ] **Single source of truth for the cross-stack event taxonomy** lives at `comradarr/core/events.py` (declared in §5.0.5 and consumed via the SSE bridge in §5.16). The structured-log event names (`sync.*`, `rotation.*`, `connector.*`, `auth.*`, `notification.*`) are **derived from the same enum**, never hand-typed at log call sites; structlog binds the enum value directly so a renamed event surfaces as a type error at `basedpyright` time. The previously duplicated taxonomy bullet here was redundant with §5.0.5 — the registry lives there; this phase only enforces the typing contract on log emit sites.
- [ ] Implement request logging policy: completion event with method, path (query values stripped), status, size, timing, resolved IP; never log request or response bodies; redact sensitive headers (PRD §20).
- [ ] Implement traceback hygiene: for unhandled exceptions, log type/message/relevant frame/fingerprint without locals (PRD §20).
- [ ] Implement deduplication processor for repeated ERROR events (PRD §20 log volume controls).

#### 5.20.2 Health endpoint final

- [ ] `/health` does DB connectivity and (optional) connector health probe; minimal response; no auth (PRD §20).

#### 5.20.3 Prometheus

- [ ] `/metrics` opt-in via `app_config` (`prometheus_metrics_enabled`, default `false`); when disabled the route is unregistered (returns 404, not 401/403, to avoid leaking the feature's existence). PRD §22 mandates this surface live behind an **independent IP allowlist distinct from the auth gate** — `/metrics` must be reachable by Prometheus scrapers that do not have an admin session and must not be reachable by the open internet even after auth is configured.
- [ ] **Allowlist enforcement mechanism (pinned).** A dedicated **route guard on the `/metrics` controller** runs *before* the auth/permission middleware short-circuits and consults a separate config row (`metrics_allowed_ips` in `app_config`, list of IP/CIDR strings, default `[]` = all-deny). The guard:
  - reads the **resolved client IP from the trusted-proxy chain** stamped on request state by §5.6.1 — never raw `X-Forwarded-For`, never the socket peer when behind a trusted proxy, exactly the same source the auth middleware uses;
  - matches the resolved IP against `metrics_allowed_ips` using `ipaddress.ip_address(...) in ipaddress.ip_network(cidr)` for every entry (loopback/private ranges are NOT auto-allowed — operators must list them explicitly so a misconfiguration fails closed);
  - on miss returns **HTTP 403 with empty body and no headers beyond the security-header baseline** (no Problem Details — Prometheus scrapers do not parse problem+json and the structured body would help reconnaissance);
  - on hit, hands off to the metrics renderer **bypassing the auth/CSRF/permission middleware** entirely — the IP allowlist is the only authentication on this route.
- [ ] **Why a route guard, not the auth gate or a reverse-proxy contract.** PRD §22 requires the allowlist to be enforced *inside the application* so a misconfigured reverse proxy cannot accidentally expose `/metrics` to the public internet (the auth gate blocks unauthenticated users in general but `/metrics` must be reachable without auth — the guard is the only layer that enforces "no auth AND specific IPs only"). A reverse-proxy-only contract was rejected because it ties the security posture to operator-managed infrastructure outside this codebase's control.
- [ ] Expose: HTTP request counts/latencies (per route + status), sync duration per connector, rotation dispatch counts per tick, command tracking latencies, budget consumption per connector, active session count, DB pool saturation, Python process metrics (PRD §29).
- [ ] No user-identifying labels.
- [ ] Acceptance test: a request to `/metrics` from an IP not in `metrics_allowed_ips` returns 403 with empty body even when the request bears a valid admin session cookie; a request from an allowed IP without any session returns the metrics text format with status 200.

#### 5.20.4 OpenTelemetry

- [ ] Opt-in OTLP-HTTP exporter; spans cover request lifecycle + background ticks + outbound HTTP; span attributes never include user identity (PRD §29).

### 5.21 Phase 21 — Import / export

#### 5.21.1 Snapshot format

- [ ] Define inner JSON schema with a **schema version integer** in the envelope (advances on every breaking structural change); populate exactly the fields enumerated in PRD §30 (and exclude every excluded item — mirror tables, schedule, planned commands, sync state, sessions, rate limit state, audit log).
- [ ] **Snapshot file binary header layout (pinned, big-endian, all multi-byte integers network order).** The header is an unencrypted, GCM-authenticated prefix; every field below is included verbatim in the AES-GCM **AAD** for the ciphertext that follows it (so any tamper of the header invalidates the auth tag and the import refuses):
  ```
  Offset  Size  Field                       Notes
  ------  ----  --------------------------  --------------------------------------
  0x00    4     magic_bytes                 ASCII "CRSN" (Comradarr SNapshot)
  0x04    2     format_version              uint16; v1 = 0x0001 (changes on
                                            crypto-primitive breaks only — NOT on
                                            inner JSON schema bumps; that lives in
                                            the encrypted payload's `schema_version`)
  0x06    2     header_length               uint16 byte length of the full header
                                            (including this field, excluding tag)
  0x08    1     kdf_id                      uint8; 0x01 = Argon2id (only value
                                            defined for v1)
  0x09    4     argon2_memory_kib           uint32 KiB; v1 default = 1048576 (1 GiB)
  0x0D    4     argon2_iterations           uint32; v1 default = 4
  0x0E    1     argon2_lanes                uint8; v1 default = 4
  0x0F    1     salt_length                 uint8; v1 fixed = 16
  0x10    16    salt                        random per export
  0x20    1     cipher_id                   uint8; 0x01 = AES-256-GCM
                                            (only value defined for v1)
  0x21    1     nonce_length                uint8; v1 fixed = 12
  0x22    12    gcm_nonce                   96-bit random per export
  0x2E    8     plaintext_length            uint64 byte length of the plaintext
                                            JSON document (sanity-check the
                                            decrypted size matches before parsing)
  0x36    32    install_name_hash           SHA-256 of the install_name string at
                                            export time; informational only — not a
                                            secret, used to display "exported from
                                            <name>" in the import preview
  0x56    ...   reserved/extension_tlv      remaining bytes up to header_length;
                                            reserved for forward-compat TLV blobs
                                            (type:uint8, length:uint16, value:bytes)
  N       16    gcm_auth_tag                128-bit AES-GCM tag binding header AAD
                                            + ciphertext
  N+16    ...   ciphertext                  AES-256-GCM-encrypted JSON document
  ```
  - **AAD scheme:** the entire byte range `[0x00 .. 0x00+header_length)` is fed to the GCM AAD before any plaintext bytes; the auth tag is verified before any decrypted byte is exposed to the JSON parser. Any header field tamper (including `format_version`, KDF parameter cranking, or salt swap) invalidates the tag and the import refuses with `SnapshotIntegrityError`.
  - **Magic bytes** make the file type identifiable to `file(1)` and to defensive checks at import (refuse files that do not start with `CRSN`).
  - **Format version is independent of inner JSON schema version.** `format_version` advances only when cryptographic primitives change (e.g. swapping AES-256-GCM for ChaCha20-Poly1305, or Argon2id for Argon2id-with-different-defaults). Inner schema changes (added/removed JSON fields) bump only the `schema_version` integer inside the encrypted payload — the file's binary frame stays at format_version=1 across many schema-version bumps.
  - **Reserved TLV region** lets future versions add fields (e.g. an HKDF-Extract context, a key-version pointer) without bumping `format_version` — readers that see an unknown TLV type ignore it; readers that require an unknown TLV type bump `format_version`.
- [ ] Decryption code for old format versions is retained indefinitely (snapshot files in the wild cannot be retroactively re-encrypted, per PRD §30).
- [ ] Inner schema imports support one major version behind current (per PRD §30); older snapshots are rejected with a structured error directing the operator to import incrementally.

#### 5.21.2 Export endpoint

- [ ] `POST /api/snapshots/export` accepts a passphrase + confirm field; produces an in-memory plaintext document.
- [ ] **Passphrase KDF parameters (pinned).** Argon2id with **memory = 1 GiB**, **iterations = 4**, **lanes = 4**, **salt = 16 bytes random per export**. These are intentionally heavier than interactive password hashing because snapshots are offline attack targets (PRD §30: "higher than the interactive-authentication parameters used for password hashing, because snapshot decryption is a rare operation and can tolerate a longer derivation step"). Parameters are embedded in the header so future tightening does not break old snapshots.
- [ ] **File-level encryption (pinned).** **AES-256-GCM** over the serialized JSON document, with a 96-bit random nonce per export and the standard 128-bit auth tag. Same primitive as at-rest field encryption (PRD §15) but applied to the whole document.
- [ ] **Plaintext document never written to disk.** Encryption happens in-memory only; the plaintext bytes are zeroed/cleared immediately after the GCM seal call returns. Only the encrypted blob touches the filesystem (and only as the response stream — no temporary file). Plaintext is never logged, never included in tracebacks, never passed through any path that could leak it (PRD §30).
- [ ] Returns `application/octet-stream` with `.comradarr-snapshot` extension; filename is `<install_name>-<ISO timestamp>.comradarr-snapshot` where `install_name` is read from `app_config` (default `comradarr`).
- [ ] Audit-log entry with the high-level summary (connector count, user count, OIDC provider count, etc.) + download size; passphrase never logged.
- [ ] Wizard enforces minimum passphrase length and rejects passphrases on the local-password denylist (PRD §30).

#### 5.21.3 Import wizard

- [ ] Frontend `(app)/settings/import/+page.svelte` with file upload + passphrase + dangerous-operation confirmation; preview screen showing what would change.
- [ ] **Conflict policy selector (per-table choice).** `replace` (snapshot wins; default — matches the "I am restoring from a backup" case per PRD §30), `merge` (snapshot fields that are set replace current fields; unset fields preserve current state), `skip` (current install rows preserved; conflicting snapshot entries discarded). The selector is per-table so an operator can, for example, replace connectors but merge OIDC providers.
- [ ] `POST /api/snapshots/import` validates the schema version against the supported range; applies the snapshot in a single database transaction; re-encrypts every secret field with the target instance's `COMRADARR_SECRET_KEY` (so no re-entry of secrets is required after import — PRD §30).
- [ ] On schema-version mismatch (older than one major behind, or newer than current), refuse import with a structured error.
- [ ] Audit log on success and on every failure (with error kind: wrong-passphrase, corrupted-file, version-mismatch — never the passphrase).

### 5.22 Phase 22 — Testing matrix

#### 5.22.1 Unit + property-based

- [ ] `tests/unit/` covering planner, differ, tier classifier, cursor codec, budget computation, URL classifier, HTTP boundary validators, error code → URI mapping, template engine.
- [ ] Hypothesis property tests per PRD §22 invariants (planner cover-all, differ correctness, cursor concat-equals-fullset).
- [ ] Suite must run in <1s on CI.

#### 5.22.2 Integration with real Postgres

- [ ] `tests/integration/` using a session-scoped DB created with the migration role; per-test transaction-rollback isolation; `PYTEST_XDIST_WORKER` per-worker schemas (RULE-TEST-002). **Every async fixture sets `loop_scope='session'` explicitly** (`@pytest_asyncio.fixture(loop_scope='session')`) so a fixture cannot accidentally fall back to a per-function loop and tear down the engine between tests; this matches the project-level `asyncio_default_fixture_loop_scope = "session"` in §5.0.2 and is enforced by a project-local lint that flags any `@pytest_asyncio.fixture` lacking the explicit kwarg.
- [ ] Repository tests for every repository.
- [ ] Audit-log permission test: an UPDATE/DELETE on `audit_log` from the application role connection raises a `ProgrammingError`.

#### 5.22.3 Fixture-based connector tests

- [ ] `tests/connectors/` replaying recorded fixtures via `httpx.MockTransport`.
- [ ] One scenario per connector method.
- [ ] Nightly canary workflow runs a small subset against demo upstream; on diff, opens an issue automatically.
- [ ] **DNS-rebinding regression test (PRD §15.4).** A dedicated test under `tests/connectors/test_ssrf_dns_rebind.py` constructs a stub DNS resolver that returns a public IP on the first lookup of `attacker.example` (passing the URL classifier at validation time) and `127.0.0.1` on every subsequent lookup. Inject it via `httpx.AsyncClient(transport=httpx.AsyncHTTPTransport(local_address=...))` with a custom resolver hook so the SSRF-defended client (§5.7.1) sees the rebound result on the actual GET request. Assert: (a) the request raises `UrlClassificationError` (private IP rejection) — never reaches the upstream socket; (b) the per-connector hostile-response counter does NOT increment (rebinding is a URL-policy reject, not a hostile response); (c) **a 302 response is itself refused** before any redirect hop is followed — the test injects a stub server that returns `302 Location: http://attacker.example/v3/series` and asserts the call raises `ConnectorRedirectError` (target stripped from message), `connector.redirect_refused` is logged exactly once, and httpx's redirect machinery is never invoked. The per-hop IP reclassification path is exercised by a separate test where the redirect policy is hypothetically permissive — kept as a defence-in-depth fixture, but the production posture is "redirects are never followed". Run on every CI build (not just nightly) — DNS rebind is the highest-impact SSRF regression class.

#### 5.22.4 API tests

- [ ] `tests/api/` using Litestar's `AsyncTestClient` with the app factory + test settings; cover every error code declared in `comradarr/errors/`.
- [ ] Cover CSRF: state-changing requests without a token return 403; setup claim is the only exception.
- [ ] Cover allowed-hosts: 421 on disallowed Host header.
- [ ] Cover CORS: pre-flight with disallowed origin returns no `Access-Control-Allow-Origin`.

#### 5.22.5 Frontend tests

- [ ] Vitest + browser-mode for Svelte 5 components (no jsdom).
- [ ] `axe-core` runs on every component-rendering test; fails on AA violations (PRD §22 / §28).
- [ ] Tests for: theme SSR resolution, tint-on-change atomicity, reduced-motion guards, sidebar collapse, virtual scroll behavior, content browser URL state round-trip.

#### 5.22.6 Coverage

- [ ] Track coverage with `coverage.py` as a diagnostic, not a gate (PRD §22).

### 5.23 Phase 23 — Supply chain hardening

- [ ] CI: `uv sync --frozen` + `uv pip audit` on every PR; nightly scheduled scan against main with auto-open issues.
- [ ] CI: `bun install --frozen-lockfile`.
- [ ] CI: `prek run --all-files`.
- [ ] CI: a job that runs `dev_cli regen-types` and fails on diff with the committed `schema.d.ts`.
- [ ] Renovate config separating security updates (auto-PR) from routine bumps (manual review).
- [ ] Pin every GitHub Action to a tag; document the tag-pinning posture (PRD §23).
- [ ] Add `bunx biome ci` step; integrate `svelte-check --threshold warning` and `tsc --noEmit` per PRD §23.
- [ ] **`Secret[T].expose()` audit gate.** A pre-commit + CI lint enumerates every `.expose()` call site in backend code and fails the build when a new call site appears outside an explicit allowlist (`comradarr/connectors/factory.py`, `comradarr/services/auth/oidc.py`, `comradarr/services/notifications/dispatcher.py`, `comradarr/services/snapshots/export.py`, etc. — every legitimate consumer recorded with a one-line justification). The intent is "every `.expose()` is an audited boundary crossing" — a new call site requires a PR-level review and a justification line, not silent addition. Implementation: a `dev_cli check expose-audit` subcommand that walks the AST, collects call sites, and diffs against `tools/expose_allowlist.toml`.
- [ ] **`{@html}` ban on connector-sourced fields** (PRD §7 prd:361 — `{@html}` bypasses Svelte's default escaping and would let a hostile *arr response write executable HTML into the DOM). An ast-grep / Biome custom rule rejects every `{@html ...}` occurrence in `frontend/src/**/*.svelte` outside an explicit allowlist file at `frontend/tools/html_escape_allowlist.toml`; the v1 allowlist is **empty** (no shipping page uses `{@html}`). The rule runs in `prek` and in CI (`bun run lint:html-escape`) and fails the build on any new occurrence. The PR template includes a checkbox confirming no new `{@html}` site was introduced; reviewers reject PRs that flip the checkbox without a corresponding allowlist entry plus a security-review sign-off comment. Cross-reference PRD §7 hostile-response defenses.

#### 5.23.1 Anti-pattern lint gates

> **Author the lint rule definitions under `tools/lint/ast-grep/`, `tools/lint/ruff_custom/`, and `biome.json`/`prek.toml` as referenced by each task.** Rule files themselves are scoped to a separate task list (out of scope for this plan section); the tasks below schedule their authoring and wire each rule into pre-commit (`prek`) AND CI (`.github/workflows/ci.yaml`) so author-time and merge-time both catch regressions. Each entry pins the lint mechanism + the rule-definition location.
>
> **Cross-cite to existing tasks:** the OpenAPI generated-types drift gate (§5.14.3 / RULE-OAPI-002), the `Secret[T].expose()` audit gate (§5.23 above), and the `{@html}` ban (§5.23 above) are already scheduled separately and are not duplicated below.

- [ ] **No `op.batch_alter_table` in PG migrations** (RULE-MIGR-001, ANTI-020, ANTI-128). Pre-commit (`prek`) + CI lint scans `migrations/versions/*.py` and rejects any `op.batch_alter_table(...)` call site — batch-alter is a SQLite workaround and corrupts PG migration semantics. Mechanism: ast-grep. Rule definition: `tools/lint/ast-grep/no-batch-alter-table.yml`. CI step: `prek run --all-files` plus a dedicated `bun run lint:migrations` job that re-runs the rule independently of `prek` for fail-fast feedback.
- [ ] **Banned Python imports** (RULE-HTTP-001, ANTI-009 / ANTI-113; PRD §15 python-jose ban). Block at import time via `[tool.ruff.lint.flake8-tidy-imports.banned-api]` in `backend/pyproject.toml`: `requests`, `urllib3`, `psycopg2`, `psycopg`, `uvicorn`, `pydantic.BaseModel`, `fastapi`, `flask`, `django`, `jose` (the `python-jose` import root). Mechanism: ruff `TID` (already in §5.0.2's selection). Rule definition: `[tool.ruff.lint.flake8-tidy-imports.banned-api]` in `pyproject.toml`. CI step: `uv run ruff check` (already gated in §5.23 prek hooks).
- [ ] **No `tailwindcss*` packages in `frontend/package.json`** (RULE-UNO-002, ANTI-TW-001). CI scans `frontend/package.json` `dependencies` and `devDependencies` keys and fails on any `tailwindcss`, `@tailwindcss/vite`, `@tailwindcss/postcss`, `@tailwindcss/typography`, etc. The empty `tailwind.config.js` stub for shadcn-svelte CLI compatibility (RULE-SHADCN-002) is permitted but the package itself is not. Mechanism: a small Bun script at `frontend/tools/lint/no-tailwind.ts` invoked from `prek` and CI. Rule definition: same file. CI step: `bun run lint:no-tailwind`.
- [ ] **No `@apply` in `*.svelte` `<style>` blocks** (ANTI-TW-002). `@apply` is non-portable across UnoCSS modes; the recommended replacement is UnoCSS `shortcuts` declared in `uno.config.ts`. Mechanism: Biome regex rule (project-local) or ast-grep — ast-grep preferred for accurate `<style>` block scoping. Rule definition: `tools/lint/ast-grep/no-apply-in-svelte-style.yml`. The rule message suggests adding a UnoCSS `shortcuts` entry instead. CI step: `bun run lint:ast-grep` (umbrella) plus `prek` hook.
- [ ] **Svelte 4 holdovers — ast-grep on `frontend/src/**/*.svelte`** (ANTI-SVELTE4-001 .. ANTI-SVELTE4-006). One ast-grep rule file per anti-pattern under `tools/lint/ast-grep/`: `no-on-directive.yml` (rejects any `on:` event-directive — `on:click=`, `on:input=`, `on:submit=`, etc. — RULE-EVENTS-001 / ANTI-SVELTE4-003; the rule message points to the lowercase HTML attribute form `onclick={...}` per RULE-EVENTS-001); `no-svelte-slot.yml` (rejects `<slot ...>` / `<slot name="...">` — ANTI-SVELTE4-005); `no-create-event-dispatcher.yml` (rejects `createEventDispatcher` import + call — ANTI-SVELTE4-004); `no-export-let.yml` (rejects `export let` prop declarations — ANTI-SVELTE4-002); `no-dollar-reactive-label.yml` (rejects `$:` reactive labels — ANTI-SVELTE4-001); `no-store-default.yml` (rejects `writable(...)` / `readable(...)` from `svelte/store` as a default shared-state mechanism — ANTI-SVELTE4-006; the rule's allowlist is `src/lib/third-party-interop/*` for legitimate library glue only). Mechanism: ast-grep. CI step: a single `bun run lint:svelte4-holdovers` rolls up all six rules; both `prek` and CI invoke it.
- [ ] **No `throw error()` / `throw redirect()` in SK 2 server modules** (RULE-SK-ERROR-001, ANTI-SK1-001). ast-grep blocks `throw error(...)` and `throw redirect(...)` patterns in `+page.server.ts`, `+layout.server.ts`, and `+server.ts` files; the rule message instructs the developer to drop the `throw` keyword and use `return error(...)` / `return redirect(...)` per SK 2 semantics (the functions return/throw internally; calling them is enough). Mechanism: ast-grep. Rule definition: `tools/lint/ast-grep/no-throw-error-redirect.yml`. CI step: `bun run lint:sk-error-redirect` plus `prek` hook.
- [ ] **No `from '$app/stores'` import** (RULE-SK-STATE-001, ANTI-SK1-002). ast-grep blocks `import ... from '$app/stores'` anywhere in `frontend/src/**/*.{ts,svelte}`; rule message points to `$app/state` (read `page`, `navigating`, `updated` as plain properties on SK ≥ 2.12 + Svelte 5). Mechanism: ast-grep. Rule definition: `tools/lint/ast-grep/no-app-stores-import.yml`. CI step: `bun run lint:sk-state-import` plus `prek` hook.
- [ ] **No `Depends()` as default-arg in any Litestar controller / handler** (ANTI-002, ANTI-101). `Depends()` is the FastAPI DI pattern; Litestar uses `Provide()` wired via the `dependencies={...}` kwarg on the controller / router / app. ast-grep blocks any function-parameter default of the form `param: T = Depends(...)` or any `from fastapi import Depends` (also caught by the banned-imports rule above; this rule is the structural backstop). Mechanism: ast-grep. Rule definition: `tools/lint/ast-grep/no-depends-default-arg.yml`. CI step: `bun run lint:ast-grep` umbrella plus `prek` hook.
- [ ] **No `datetime.utcnow()` and no naive datetimes** (ANTI-133). Enable ruff `DTZ` selection in `[tool.ruff.lint.select]` in `backend/pyproject.toml`; the `DTZ` group flags `datetime.utcnow()` (DTZ003) and every constructor that produces a naive datetime (DTZ001 / DTZ005 / DTZ006 / DTZ007). The replacement is `datetime.now(UTC)` everywhere. Mechanism: ruff `DTZ` group (configuration change to §5.0.2). CI step: `uv run ruff check` (already gated).
- [ ] **Async-test anti-patterns** (RULE-TEST-001, ANTI-013 / ANTI-015 / ANTI-126). Two related blocks: (a) ast-grep rejects `class _(unittest.IsolatedAsyncioTestCase)` (and bare `IsolatedAsyncioTestCase` references) in `tests/**/*.py` — replacement is `async def test_…` with `pytest-asyncio`; (b) a pytest-collection plugin or ast-grep rule rejects `@pytest.fixture` decorators applied to `async def` functions — the decorator must be `@pytest_asyncio.fixture` instead. Mechanism: ast-grep for both. Rule definitions: `tools/lint/ast-grep/no-isolated-asyncio-test-case.yml` and `tools/lint/ast-grep/no-sync-fixture-on-async.yml`. CI step: `bun run lint:async-tests` umbrella plus `prek` hook.
- [ ] **`async_sessionmaker(...)` requires `expire_on_commit=False`** (RULE-DB-001, ANTI-112). Every `async_sessionmaker(...)` call site in `backend/src/**/*.py` must pass `expire_on_commit=False` as a keyword argument; omitting the keyword causes detached-instance bugs after commit. Mechanism: ast-grep with a structural pattern matching `async_sessionmaker(...)` and asserting the `expire_on_commit` kwarg is present and truthy-equal-to `False`. Rule definition: `tools/lint/ast-grep/sessionmaker-expire-on-commit.yml`. (A ruff custom plugin is an acceptable alternative if the project later adopts `tools/lint/ruff_custom/` infrastructure; ast-grep is the v1 mechanism.) CI step: `bun run lint:db-sessionmaker` plus `prek` hook.
- [ ] **`httpx.AsyncClient(...)` constructor outside SSRF-defended client + notification channels** (RULE-HTTP-003, **ANTI-016** — `httpx.AsyncClient()` constructed inside a handler is a defect; the fix is "app-scoped client injected via DI"). One app-scoped client per external-service domain is the contract; ad-hoc `httpx.AsyncClient(...)` constructors elsewhere bypass the SSRF / hostile-response posture from §5.7.1 and the redirect-refusal contract from §5.12.1. ast-grep blocks every `httpx.AsyncClient(...)` call site outside an explicit allowlist of files: `comradarr/connectors/http.py` (the SSRF-defended factory) and `comradarr/services/notifications/channels/*.py` (the webhook + apprise channel modules — apprise wraps its own client but the webhook channel constructs its own). Mechanism: ast-grep with file-glob allowlist. Rule definition: `tools/lint/ast-grep/no-ad-hoc-async-client.yml`. CI step: `bun run lint:httpx-allowlist` plus `prek` hook.
- [ ] **Mandatory explicit `httpx.Timeout(...)` and forbidden `.retries = n` attribute** (**ANTI-115** — `AsyncClient(timeout=None)` is an unbounded-hang defect; **ANTI-116** — `AsyncClient.retries = n` is not an API and silently does nothing). ast-grep rejects any `httpx.AsyncClient(...)` (or `httpx.AsyncClient(...).post(...)` / `.get(...)` site) constructed without an explicit `timeout=` keyword whose value is an `httpx.Timeout(...)` instance — `timeout=None` and bare-omission both fail. A second ast-grep rule rejects any attribute assignment to `.retries` on an `httpx.AsyncClient` (or anything-typed) instance and steers the developer to the correct pattern: `httpx.AsyncTransport(retries=n)` for connect-level retry plus `tenacity` for 5xx-driven retry per RECIPE-TENACITY. Mechanism: two ast-grep rules. Rule definitions: `tools/lint/ast-grep/httpx-explicit-timeout.yml` and `tools/lint/ast-grep/no-async-client-retries-attr.yml`. CI step: `bun run lint:httpx-misuse` plus `prek` hook.
- [ ] **No `logging.getLogger` and no bare `print(` outside `__main__.py`** (ANTI-117, ANTI-118). structlog is the only sanctioned logging surface (RULE-LOG-001). ast-grep blocks `logging.getLogger(...)` (and `import logging` outside the structlog bridge) anywhere in `backend/src/comradarr/**/*.py`; ast-grep blocks bare `print(...)` calls in the same tree with an allowlist for `comradarr/__main__.py` (the bootstrap-token banner intentionally writes to stdout via `print` so container log collectors capture it without a structured-log dependency at boot). Mechanism: two ast-grep rules. Rule definitions: `tools/lint/ast-grep/no-stdlib-logging.yml` and `tools/lint/ast-grep/no-bare-print.yml`. CI step: `bun run lint:logging` umbrella plus `prek` hook.

### 5.24 Phase 24 — Deployment artifacts

#### 5.24.1 Docker image

- [ ] Multi-stage Dockerfile based on `python:3.14-slim-bookworm` plus PostgreSQL 16; build the SvelteKit frontend with `svelte-adapter-bun` in a Bun stage and copy the build into the final image.
- [ ] Run application as a non-root user; bundled PostgreSQL as `postgres` system user with the data directory mounted from a single operator volume (PRD §24).
- [ ] Configure the bundled PG to listen on a Unix socket only (no TCP) and conservative defaults.
- [ ] Init script: if `DATABASE_URL` is unset → start bundled PG, wait for ready, run migrations, exec Granian; else → skip bundled PG, run migrations against external DB, exec Granian.
- [ ] Granian launch: single worker, single threaded, uvloop, 6h worker lifetime, respawn on failure (PRD §24).
- [ ] **Bundled SvelteKit Bun-runtime supervision (PRD §24).** The frontend is shipped as a `svelte-adapter-bun` build that runs inside the same container as Granian. The init script supervises **two long-running processes** plus bundled PG: (a) Granian → ASGI on a Unix socket; (b) `bun run build/index.js` → SvelteKit Bun adapter on a separate Unix socket; (c) bundled PostgreSQL on its own socket. A reverse-proxy stub (caddy or a tiny Bun HTTP front) inside the image fans `/api/*`, `/health`, `/metrics`, `/setup/claim`, `/api/events/stream` to Granian and everything else to the SvelteKit Bun process; both backend sockets are reachable only from inside the container. The supervisor is a small `tini`-fronted shell script that exits non-zero (and the container with it) when **any** of the three processes terminates — there is no "frontend down, backend up" partial-availability mode in v1; an operator restart resolves either failure class. Health checks probe all three sockets before reporting `ready`.

#### 5.24.2 Image tagging

- [ ] Publish under `0.1.0`, `0.1`, `0`, `latest`, plus per-build SHA tag (PRD §23).
- [ ] Multi-arch (amd64 + arm64) build via buildx.
- [ ] Generate SBOM and attach to the release.

#### 5.24.3 Dev CLI (`dev_cli/`)

- [ ] uv-managed Python package with subcommands: `check`, `format`, `lint`, `typecheck`, `test`, `test-fast`, `db-up`, `db-down`, `migrate`, `pg`, `regen-types`, `i18n extract`, `serve`, `record-fixture`, `replay-canary`, `snapshot-export`, `snapshot-import`.
- [ ] Mirrors CI exactly so `dev_cli check` passing locally implies CI passing (PRD §23).
- [ ] Publishes a single console-script entry point.

#### 5.24.4 Compose example

- [ ] `compose.example.yaml` with a single service, one volume mount, one env var (`COMRADARR_SECRET_KEY`), no secrets in the file.
- [ ] Document the external-DB override path in `README.md`.

### 5.25 Phase 25 — Release prep

- [ ] Ensure every Python source file's license header references AGPL-3.0.
- [ ] Generate API reference docs from the OpenAPI spec; publish as part of the docs site.
- [ ] Author CONTRIBUTING.md covering: AGPL inbound-equals-outbound, dependency license matrix, fixture recording, prek setup.
- [ ] **Dependency license matrix (pinned scope; PRD §14 "Permitted licenses").** Generate `docs/license-matrix.md` and link from CONTRIBUTING.md and the docs site:
  - **(a) Backend deps.** Run `uv tree --format=json` (or `uv pip compile --resolution=lowest && uv pip licenses`) to enumerate every transitive Python dependency, then auto-render a table of `name | version | license | source URL` sorted by name. Reject the build when any row's license is not in the AGPL-3.0-compatible allowlist `{MIT, BSD-2-Clause, BSD-3-Clause, Apache-2.0, MPL-2.0, ISC, PSF-2.0, AGPL-3.0, LGPL-3.0-or-later}`; PRD §14 names BSD-2-Clause for apprise as the v1 reference allowlist seed. Unknown / unparseable licenses fail the gate, not just non-allowlisted ones.
  - **(b) Frontend deps.** Same pattern via `bun pm ls --all --json` plus a Bun script that resolves each package's `LICENSE` field against the same allowlist.
  - **(c) Bundled binaries.** Document the runtime dependencies that ship inside the Docker image but are not Python/Bun packages — bundled PostgreSQL 16 (PostgreSQL License), Granian (BSD-3-Clause), `tini` (MIT), the Bun runtime (MIT), and the `python:3.14-slim-bookworm` base image (PSF + Debian). Each entry carries license + upstream link.
  - **(d) Theme + UI assets.** Northern Lights theme tokens from tweakcn (capture license from the tweakcn distribution), shadcn-svelte components (MIT), Lucide icons (ISC), self-hosted IBM Plex / JetBrains Mono fonts (OFL).
  - **(e) Update gate.** A CI step regenerates the matrix on every dependency-bump PR and fails the build when the regenerated table differs from the committed copy without a corresponding `docs/license-matrix.md` update — the matrix is machine-owned, the PR author is responsible for re-running and committing.
- [ ] **Glossary alignment pass.** Reconcile the Comradarr glossary in `docs/glossary.md` (or as an appendix of the PRD) to match the v0.1.0 implementation: every term defined in PRD §Glossary that this plan refines (test-driven configuration affordance, hostile-response defenses, tier 0/1/2/3, continuous rotation, three-credential bootstrap, audit log vs structured log) gets a single canonical definition with a cross-reference to the matching §5 task; remove any glossary entry that referred to deferred-to-backlog features (command palette, hash-chain audit, partial import, multi-role assignment UI, custom icons). PRD-only wording for "RFC 7807" is retained but annotated `(superseded by RFC 9457 — same wire shape; this plan and RULE-API-002 cite RFC 9457)`.
- [ ] Author CHANGELOG.md with v0.1.0 entry.
- [ ] CI release workflow: on tag push matching `^[0-9]+\.[0-9]+\.[0-9]+$`, build multi-arch image, push, attach SBOM, publish GitHub Release with `v` prefix in title (PRD §23).
- [ ] Confirm release-cadence policy in CONTRIBUTING.md (no schedule, releases when ready).
- [ ] **Upgrade-path documentation** (PRD §27 explicitly requires this deliverable). Author `docs/upgrades.md` covering:
  - **(a) Alembic migration ordering** for v0.1.0 → v0.2.0. v0.2.0 is a hypothetical placeholder for v0.1.0 release; the doc lays out the template (forward-only migrations, run order during init, what to do on a failed migration → restore the pre-upgrade DB backup per PRD §27 "Downgrades"). Update this section on every minor version bump.
  - **(b) Snapshot export/import as a migration safety net.** Document the recommended pattern of "export a snapshot before any minor-version upgrade, then verify the snapshot decrypts on the target version before relying on the live database." Cross-reference §5.21.
  - **(c) Master-key rotation procedure.** Document the `COMRADARR_SECRET_KEY_V2_FILE` (or equivalent next-version variable name) flow: how key versions are referenced by the four-column ciphertext layout (PRD §15), the staged rotation sequence (deploy with both keys → re-encrypt rows in the background → remove the old key after every row's `key_version` has advanced), and how to verify completion.
  - **(d) Env-var inventory checklist.** Enumerate every `COMRADARR_*` environment variable the operator should review on each upgrade — `COMRADARR_SECRET_KEY`, `COMRADARR_SECRET_KEY_FILE`, `COMRADARR_RECOVERY_MODE`, `COMRADARR_DISABLE_LOCAL_LOGIN`, `COMRADARR_INSECURE_COOKIES`, `COMRADARR_CSP_REPORT_ONLY`, `COMRADARR_LOG_LEVEL`, `COMRADARR_LOG_FORMAT`, `COMRADARR_OIDC_<NAME>_*`, `DATABASE_URL` — with notes on which were added/removed/renamed in each release. Cross-reference PRD §27 "The Upgrade Path".
  - Linked from CHANGELOG.md and from the README's upgrade section.

---

## 6. Testing and Validation Tasks

### 6.1 Backend test gates

- [ ] Unit suite (`uv run pytest tests/unit -n auto`) completes in <1s.
- [ ] Property tests pass for: planner cover-all invariant, differ correctness, cursor pagination concat-equals-fullset, URL classifier policies, tier classifier idempotence.
- [ ] Integration suite (`uv run pytest tests/integration -n auto`) passes against PostgreSQL service container.
- [ ] Role-permission tests: confirm UPDATE / DELETE on `audit_log` from the application role raises `ProgrammingError`; confirm DELETE from audit-admin role succeeds; confirm DDL from application role fails.
- [ ] Connector fixture suite passes deterministically; recording tool round-trips a captured fixture without drift.
- [ ] API suite covers every Problem Details code declared in `comradarr/errors/` with at least one provoking test (PRD §22).
- [ ] CSRF / CORS / allowed-hosts behavior covered end-to-end.
- [ ] Setup-wizard end-to-end test: bootstrap claim → boundary phases → admin account creation; subsequent requests routed normally.
- [ ] Auth: local login + lockout, trusted-header trust matrix, OIDC happy path + invalid `nonce` + expired `iat` + invalid issuer + invalid audience + JWKS rotation, session idle/absolute timeout, API key permission scoping.
- [ ] **Hostile-response degradation thresholds (PRD §7 / §5.7.1).** Regression test that drives the per-connector consecutive-hostile-response counter against a `httpx.MockTransport` returning malformed JSON: assert (a) at exactly 5 consecutive hostile responses the connector flips to `degraded` and the SSE feed emits `connector.health.degraded`; (b) at exactly 20 consecutive hostile responses it flips to `unhealthy` and rotation dispatch stops; (c) a single successful response decrements the counter and a return to zero restores `healthy`; (d) the counter does NOT increment on a 5xx upstream error (transport-level failure) — only on hostile-payload signals (oversized, malformed JSON, unexpected content-type, msgspec validation failure, decompression-bomb ratio exceeded).
- [ ] **System-vs-user notification scope routing (PRD §13 / §14 / §5.11.2 + §5.12.2).** End-to-end test driving two SSE clients — one admin and one non-admin — that asserts: (a) `connector.health.degraded` (system scope) is delivered to the admin client only; (b) `priority_search.completed` for user X (user scope) is delivered to user X only; (c) `notification.delivery.failed` for user X's webhook is delivered to user X and to admins; (d) the default routing-profile seeding inserts the right `(event_type, channel)` rows on a user's first channel creation and does NOT re-seed on the second channel.

### 6.2 Frontend test gates

- [ ] Vitest browser tests for every component under `src/lib/components/ui/` plus surface-specific components.
- [ ] Axe-core passes on every component test; AA violations fail the build.
- [ ] Theme SSR test: cookie-driven and DB-driven branches paint correctly without flash.
- [ ] Reduced-motion test: heartbeat, tint-on-change, page-load cascade collapse to atomic state swaps.
- [ ] Content-browser URL state round-trip test.
- [ ] Form-action tests for setup wizard and HTTP boundary settings, with the test-driven configuration component covering observed / proposed / testing / committed / rejected transitions.
- [ ] Generated types in sync: CI step regenerates `schema.d.ts` and fails on diff.
- [ ] Biome `check`, `svelte-check`, `tsc --noEmit` green.

### 6.3 Cross-cutting validation

- [ ] HTTP request paths under load: SSE backpressure, content browser virtual scroll at 500k rows, sync of a connector with 100k+ episodes, rotation under daily 100-command default.
- [ ] Snapshot round-trip: export → import in a fresh instance restores connectors, OIDC, HTTP boundary, users, API keys without re-entering secrets.
- [ ] Bootstrap denylist: starting with a known-bad `COMRADARR_SECRET_KEY` exits non-zero with a structured error.
- [ ] Logging redaction: an injected log call attempting to emit a `Secret[bytes]` renders as the marker; injected sensitive headers are redacted.
- [ ] Recovery: after `kill -9`, restart resumes rotation from `last_searched_at`, sync coordinator detects stale timestamps, planned commands are re-polled.
- [ ] DNS rebinding test: a connector hostname that resolves to a public IP at validation time and `127.0.0.1` at request time is rejected on every request.

### 6.4 Static gates

- [ ] `prek run --all-files` clean.
- [ ] `uv run basedpyright` clean in recommended mode.
- [ ] `uv run ruff check` clean (no `# noqa` without justification).
- [ ] `uv run pip-audit` finds no high-severity findings (CI gate; failure blocks merge).
- [ ] `bun audit` (bun ≥ 1.3) finds no high-severity findings on the frontend dependency tree (CI gate; the frontend equivalent of pip-audit, run alongside the backend gate).
- [ ] `bunx biome ci` clean.
- [ ] `bunx svelte-check --threshold warning` clean.
- [ ] `bunx tsc --noEmit` clean.
- [ ] **No-7807 acceptance check (RULE-API-002 / ANTI-API-002):** a CI grep / ast-grep step asserts that no Python source file under `comradarr/` cites RFC 7807 in code, comments, error-handler docstrings, or `application/problem+json` rendering paths — every Problem Details surface must cite **RFC 9457** and emit `application/problem+json` with the §5.1.3 error class hierarchy. The gate runs against committed source only (the docs intentionally retain a single annotated "RFC 7807 → 9457" pointer in PRD §17 / §21 / Glossary).

### 6.5 Edge cases

- [ ] Sync: a series that disappears upstream is pruned from mirror tables and from `search_schedule` in the same transaction.
- [ ] Rotation: a connector whose Prowlarr health falls to "all indexers disabled" is skipped without raising; resumes when health returns.
- [ ] Notifications: 20 simultaneous indexer flips coalesce to one operational-health notification within the 60s window; security events in the same window do not coalesce.
- [ ] OIDC: id_token with `alg=none` is rejected; expired `iat` (outside replay window) is rejected; missing `nonce` is rejected.
- [ ] Frontend: theme cookie missing on first visit triggers the synchronous inline script and writes the cookie before stylesheet parse.
- [ ] Setup gate: a request to `/api/connectors` while `setup_completed=false` returns 401 (API) and `/api/connectors` is not reachable.
- [ ] CSRF: `/setup/claim` accepts a missing Origin header; every other state-changing endpoint rejects it.
- [ ] Audit log retention: when configured cap is reached, the audit-admin role vacuums oldest rows; the application role cannot.

---

## 7. Risks, Dependencies, and Rollout Considerations

### 7.1 Technical risks

- [ ] **Free-threaded Python (no-GIL).** Backend rules DECIDE-NOGIL: default GIL build for v1; revisit only if a measured GIL-bound hotspot appears and every C-ext wheel is `cp314t`.
- [ ] **OpenAPI / TypeScript drift.** Mitigated by CI gate + dev-CLI `regen-types`. Risk: silently outdated types if developers skip the regen step.
- [ ] **Bundled PostgreSQL conflict with operator-managed Postgres.** Documented by the `DATABASE_URL` override path; risk is operator confusion. Mitigation: single sentence in `README.md` stating the override behavior.
- [ ] **Fixture rot.** Mitigated by canary workflow; residual risk that demo instances are unavailable. Mitigation: opt-in self-hosted canary.
- [ ] **shadcn-svelte CLI depending on Tailwind config.** Mitigated by empty stub; risk is CLI evolution. Track upstream and revisit `RULE-SHADCN-002`.
- [ ] **Setup-wizard test endpoints reachable pre-completion.** Mitigated by setup-gate allowlist; risk of allowlist regression. Test cases enforce.
- [ ] **Bootstrap token leakage.** Token printed to stdout is also written to a file inside the container; risk if the file is mounted to a shared volume. Mitigation: file lives under `/var/lib/comradarr/bootstrap` (not under the operator's data volume).
- [ ] **CSRF Origin/Referer validation + SameSite + CSP trade-offs.** Risk that an aggressive CSP blocks the inline theme script. Mitigation: nonce-based CSP for the inline theme script, documented.
- [ ] **Argon2id parameter selection.** Need separate parameter sets for password vs. snapshot key derivation. Risk: under-parameterized snapshot key derivation. Mitigation: snapshot params set well above interactive thresholds (e.g., 1 GiB, 4 iters, 4 lanes) per PRD §30.
- [ ] **OIDC clock skew.** Risk: token validation fails on slightly-skewed clocks. Mitigation: tolerate 60s skew on `iat` / `exp`.
- [ ] **PostgreSQL major version drift between bundled and external.** Risk: SQL behavior differs on older operator-managed Postgres. Mitigation: README states minimum 16.x; init script aborts on older.
- [ ] **Apprise dependency churn.** Risk of breaking changes in apprise URL syntax. Mitigation: pin minor version; nightly canary covers SMTP and at least one apprise scheme.

### 7.2 Dependencies

- [ ] External: Sonarr, Radarr, Prowlarr instances reachable at configured URLs. Sonarr v3+, Radarr v4+, Prowlarr v1+.
- [ ] Network: bundled deployment requires the container to reach the *arr instances and any OIDC provider; no inbound connectivity beyond the operator's reverse proxy.
- [ ] Cryptography: `cryptography` library for AES-256-GCM; `argon2-cffi` for Argon2id.
- [ ] Translation: Weblate instance polling the repo's `translations/` directory.
- [ ] Container registry for image publishing.
- [ ] PyPI advisory database + OSV for `pip-audit`.

### 7.3 Sequencing constraints

- [ ] Phase 4 (auth) depends on Phase 3 (crypto + Secret).
- [ ] Phase 5 (setup wizard) depends on Phase 4 + Phase 6 (HTTP boundary middleware).
- [ ] Phase 7 (connector subsystem) depends on Phase 1 (HTTP client lifespan) + Phase 3 (crypto).
- [ ] Phase 9 (sync) depends on Phase 7 + Phase 8 (clients).
- [ ] Phase 10 (rotation) depends on Phase 9.
- [ ] Phase 11 (event bus + SSE) is independent and can land in parallel with Phase 9–10.
- [ ] Phase 12 (notifications) depends on Phase 11.
- [ ] Phase 13 (API layer) depends on Phase 9–12.
- [ ] Phase 14 (frontend foundations) depends on Phase 13's OpenAPI surface.
- [ ] Phases 15–18 depend on Phase 14 + Phase 13 endpoints they consume.
- [ ] Phase 21 (import/export) depends on Phase 3 + Phase 13.
- [ ] Phase 24 (deployment) depends on every functional phase.

### 7.4 Rollout

- [ ] Pre-1.0 is 0.x semver; minor-version bumps may carry breaking changes per PRD §23.
- [ ] First public release: v0.1.0; release notes call out bootstrap flow, three auth providers, single-image deployment.
- [ ] Image tag policy: `0.1.0`, `0.1`, `0`, `latest` all published; document the operator's choice.
- [ ] Forward-only migrations; document recovery via PG restore.
- [ ] Backup reminders surface in container logs at startup whenever a pending migration is detected (PRD §27).
- [ ] No telemetry by default. Operators opt in to `/metrics` and OTLP through the post-setup UI.
- [ ] Provide an upgrade-path doc per PRD §27.

### 7.5 Operational and security considerations

- [ ] Document key management for `COMRADARR_SECRET_KEY` in README and import/export guide.
- [ ] Document recovery scenarios: lost master key, lost passphrase, lost database.
- [ ] Document the `_FILE` env-suffix pattern for every secret-bearing variable.
- [ ] Document the `COMRADARR_DISABLE_LOCAL_LOGIN` and `COMRADARR_RECOVERY_MODE` break-glass toggles.
- [ ] Document the bundled-vs-external Postgres decision and the migration path between them (operator-driven `pg_dump`/`pg_restore`).

---

## 8. Definition of Done

A workstream is done only when **every** item below is true.

- [ ] All checkboxes in §5 are completed.
- [ ] `prek run --all-files` is green on a clean checkout.
- [ ] `uv run basedpyright` reports zero issues in `recommended` mode.
- [ ] `uv run ruff check` and `uv run ruff format --check` are clean; every `# noqa` carries a justified comment.
- [ ] `uv run pytest -n auto` is green, including unit, integration, fixture-based connector, and API suites.
- [ ] `uv run pip-audit` reports no findings above the configured severity threshold.
- [ ] `bunx biome ci`, `bunx svelte-check --threshold warning`, `bunx tsc --noEmit` are clean.
- [ ] `bun test` (browser mode for Svelte 5) is green; axe-core finds zero AA violations on rendered components.
- [ ] OpenAPI spec served by Litestar matches the committed `schema.d.ts` (CI gate green).
- [ ] All endpoints declared in PRD §17 are reachable and authenticated/authorized correctly.
- [ ] Setup wizard end-to-end (claim → HTTP boundary verification × 4 → admin) succeeds against a fresh container; `setup_completed` flips to true.
- [ ] Bootstrap token denylist + master-key denylist refusals exit with structured errors and non-zero status.
- [ ] CSRF, CORS, allowed-hosts, security headers, and CSP behave per PRD §16; report-only and insecure-cookies modes log the warning and behave correctly.
- [ ] Audit log entries exist for every action enum value (verified by API tests provoking each).
- [ ] Snapshot export → import round-trip restores connectors, OIDC, HTTP boundary, users, API keys without re-entering secrets.
- [ ] Recorded-fixture canary runs nightly and opens GitHub issues on drift.
- [ ] Docker image builds for amd64 + arm64; SBOM attached; multi-tag publishing works.
- [ ] Bundled PostgreSQL deployment boots with one env var (`COMRADARR_SECRET_KEY`) and reaches the setup wizard at `/setup`.
- [ ] External-PostgreSQL override path boots, runs migrations, and reaches the setup wizard.
- [ ] Translation catalogs (`translations/`) are emitted; Weblate config in repo; backend and frontend resolve locale per user preference and `Accept-Language` fallback.
- [ ] WCAG 2.2 AA verified on every shipping page via axe-core; manual keyboard-only smoke test passes.
- [ ] Frontend never flashes wrong theme on first paint (verified with cookie-set, cookie-absent, authenticated-with-DB-pref, authenticated-with-system, unauthenticated cases).
- [ ] All numerals representing counts/timings/percentages render in `font-mono`; SSE-driven swaps are atomic.
- [ ] Heartbeat indicator reflects rotation engine state; static when idle.
- [ ] `prefers-reduced-motion: reduce` collapses every animation universally.
- [ ] Health endpoint reachable without auth; metrics + OTLP reachable only when opted in.
- [ ] Logs in production render as JSON lines; secret values render as redaction markers; tracebacks omit frame locals.
- [ ] CHANGELOG.md, CONTRIBUTING.md, and README.md document v0.1.0 surface.
- [ ] License headers present in every source file; AGPL-3.0 LICENSE at root.
- [ ] All open questions in §3 are resolved with the maintainer or moved to a tracked backlog item.
